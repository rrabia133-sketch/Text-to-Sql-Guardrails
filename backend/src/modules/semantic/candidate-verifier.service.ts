import { parse } from "pgsql-ast-parser";
import type { IntentSlots, SemanticFinding, ProviderType } from "@text2sql/contracts";
import type { ProviderRouter } from "../providers/provider.router.js";
import type { PromptBuilder } from "../generation/prompts/prompt-builder.js";
import type { ILLMProvider, ProviderRawResponse } from "../providers/provider.interface.js";
import { ProviderTimeoutError, ProviderQuotaError } from "../providers/base.provider.js";

// Strict time budgets for local vs cloud execution
export const CANDIDATE_TIMEOUT_LOCAL_MS = 10_000; // 10s local
export const CANDIDATE_TIMEOUT_CLOUD_MS = 5_000;  // 5s cloud
export const VERIFIER_TIMEOUT_LOCAL_MS = 10_000;  // 10s local
export const VERIFIER_TIMEOUT_CLOUD_MS = 5_000;   // 5s cloud

export interface CandidateStabilityMetrics {
    projectionSimilarity: number;
    tableJoinSimilarity: number;
    predicateSimilarity: number;
}

export interface CandidateStabilityResult {
    score: number; // 0.0 to 1.0 (weighted contribution to confidence is 15%)
    available: boolean;
    unavailable: boolean;
    reasonUnavailable?: string;
    evidenceSummary: string;
    secondarySql?: string;
    metrics?: CandidateStabilityMetrics;
}

export interface VerifierResult {
    score: number; // 0.0 to 1.0 (weighted contribution to confidence is 20%)
    available: boolean;
    unavailable: boolean;
    reasonUnavailable?: string;
    evidenceSummary: string;
    agrees?: boolean;
    discrepancies?: string[];
}

export interface CandidateVerifierServiceOptions {
    providerRouter?: ProviderRouter;
    promptBuilder?: PromptBuilder;
}

export const VERIFIER_SYSTEM_PROMPT = `You are a high-assurance SQL semantic verifier for an enterprise Text-to-SQL system.
Your job is to strictly verify whether a generated PostgreSQL query semantically matches the user's analytical question and intent slots.
You must return only a valid JSON object with no additional text or markdown formatting:
{
  "agrees": true,
  "score": 1.0,
  "explanation": "Brief explanation of agreement or discrepancies.",
  "discrepancies": []
}
Evaluation Criteria:
1. Metric & Aggregation: Does the query compute the requested metric using the proper aggregation function (e.g. SUM, AVG, COUNT, MIN, MAX)?
2. Filters & Status: Are mandatory business filters included (e.g. completed order status for revenue queries)?
3. Temporal Boundaries: Does the WHERE clause correctly enforce any requested date/time bounds?
4. Join & Grouping: Are table joins correct without row duplication or accidental Cartesian products?
Score must be a floating point number between 0.0 and 1.0. If there are critical discrepancies, agrees must be false and score <= 0.5.`;

export class CandidateVerifierService {
    private readonly providerRouter?: ProviderRouter;
    private readonly promptBuilder?: PromptBuilder;

    constructor(options?: CandidateVerifierServiceOptions) {
        this.providerRouter = options?.providerRouter;
        this.promptBuilder = options?.promptBuilder;
    }

    /**
     * Evaluates structural equivalence between primary SQL and a secondary candidate AST.
     * Evaluates projection columns (40%), table joins (40%), and predicate filters (20%).
     */
    public evaluateEquivalence(primaryAst: any, secondaryAst: any, secondarySql?: string): CandidateStabilityResult {
        if (!primaryAst || !secondaryAst) {
            return {
                score: 0.0,
                available: false,
                unavailable: true,
                reasonUnavailable: "Unable to parse primary or secondary AST for stability comparison.",
                evidenceSummary: "AST parsing failure during stability analysis.",
            };
        }

        const primarySelect = this.findRootSelect(primaryAst);
        const secondarySelect = this.findRootSelect(secondaryAst);

        if (!primarySelect || !secondarySelect) {
            return {
                score: 0.0,
                available: false,
                unavailable: true,
                reasonUnavailable: "Root SELECT statement missing in one or both candidates.",
                evidenceSummary: "Non-SELECT statement encountered during stability evaluation.",
            };
        }

        // 1. Projection Similarity (40%)
        const primaryCols = this.extractColumnNames(primarySelect.columns);
        const secondaryCols = this.extractColumnNames(secondarySelect.columns);
        const projectionSimilarity = this.computeJaccard(primaryCols, secondaryCols);

        // 2. Table Join Similarity (40%)
        const primaryTables = this.extractTableNames(primarySelect.from);
        const secondaryTables = this.extractTableNames(secondarySelect.from);
        const tableJoinSimilarity = this.computeJaccard(primaryTables, secondaryTables);

        // 3. Predicate Similarity (20%)
        const primaryPredCols = this.extractPredicateColumns(primarySelect.where);
        const secondaryPredCols = this.extractPredicateColumns(secondarySelect.where);
        const predicateSimilarity = (primaryPredCols.length === 0 && secondaryPredCols.length === 0)
            ? 1.0
            : this.computeJaccard(primaryPredCols, secondaryPredCols);

        // Weighted stability score
        const score = Math.round(
            (0.4 * projectionSimilarity + 0.4 * tableJoinSimilarity + 0.2 * predicateSimilarity) * 100
        ) / 100;

        let evidenceSummary: string;
        if (score >= 0.85) {
            evidenceSummary = "High structural consensus between primary and secondary generation candidates.";
        } else if (score >= 0.60) {
            evidenceSummary = "Moderate candidate agreement; minor structural differences in projection or filtering.";
        } else {
            evidenceSummary = "Low consensus; primary and secondary generation candidates diverged significantly.";
        }

        return {
            score,
            available: true,
            unavailable: false,
            evidenceSummary,
            secondarySql,
            metrics: {
                projectionSimilarity,
                tableJoinSimilarity,
                predicateSimilarity,
            },
        };
    }

    /**
     * Generates an independent secondary candidate under strict time budget (10s local, 5s cloud).
     * Uses secondary seed / prompt variation WITHOUT exposing the primary SQL.
     */
    public async generateSecondaryCandidate(
        question: string,
        options?: {
            provider?: ILLMProvider;
            userPreference?: ProviderType;
            timeoutMs?: number;
            promptVariation?: string;
        }
    ): Promise<{
        sql?: string;
        available: boolean;
        unavailable: boolean;
        reasonUnavailable?: string;
        rawResponse?: ProviderRawResponse;
    }> {
        // 1. Resolve Provider
        let provider = options?.provider;
        if (!provider && this.providerRouter) {
            try {
                provider = await this.providerRouter.resolveProvider(options?.userPreference);
            } catch (err: any) {
                return {
                    available: false,
                    unavailable: true,
                    reasonUnavailable: `Provider resolution failed: ${err.message}`,
                };
            }
        }

        if (!provider) {
            return {
                available: false,
                unavailable: true,
                reasonUnavailable: "No LLM provider available for secondary candidate generation.",
            };
        }

        // 2. Budget Check for Cloud Providers
        const modelInfo = provider.getModelInfo();
        if (!modelInfo.isLocal && this.providerRouter) {
            try {
                const budgetStatus = await this.providerRouter.getBudgetService().getBudgetStatus();
                if (budgetStatus.isCapReached) {
                    return {
                        available: false,
                        unavailable: true,
                        reasonUnavailable: `Cloud provider budget cap reached ($${budgetStatus.spentTodayUsd.toFixed(2)} USD spent of $${budgetStatus.budgetLimitUsd.toFixed(2)} USD limit).`,
                    };
                }
            } catch {
                // Ignore budget check errors and proceed to provider
            }
        }

        // 3. Time Budget Resolution (10s local, 5s cloud)
        const timeoutMs = options?.timeoutMs ?? (modelInfo.isLocal ? CANDIDATE_TIMEOUT_LOCAL_MS : CANDIDATE_TIMEOUT_CLOUD_MS);

        // 4. Construct Prompt Variation without exposing primary SQL
        let candidatePrompt: string;
        const variationDirective = options?.promptVariation ??
            "### Candidate Generation Directive\nFormulate an independent SQL query answering this question. Use explicit column aliases, standard PostgreSQL syntax, and explicit table joins.";

        if (this.promptBuilder) {
            const promptCtx = await this.promptBuilder.buildPrompt(question);
            candidatePrompt = `${promptCtx.completePrompt}\n\n${variationDirective}`;
        } else {
            candidatePrompt = `User Question: "${question.trim()}"\n\n${variationDirective}\n\nOutput only valid SQL or JSON with "sql" field:`;
        }

        // 5. Execute with Secondary Seed / Temperature variation
        try {
            const response = await provider.generate(candidatePrompt, {
                timeoutMs,
                temperature: 0.3, // Secondary variation
            });

            const extractedSql = this.extractSqlFromRaw(response.rawText);
            if (!extractedSql) {
                return {
                    available: false,
                    unavailable: true,
                    reasonUnavailable: "Secondary candidate generation did not produce extractable SQL.",
                    rawResponse: response,
                };
            }

            return {
                sql: extractedSql,
                available: true,
                unavailable: false,
                rawResponse: response,
            };
        } catch (err: any) {
            if (err instanceof ProviderTimeoutError || err.name === "AbortError" || err.message?.includes("timed out")) {
                return {
                    available: false,
                    unavailable: true,
                    reasonUnavailable: `Secondary candidate generation timed out under strict latency budget (${timeoutMs}ms).`,
                };
            }

            if (err instanceof ProviderQuotaError) {
                return {
                    available: false,
                    unavailable: true,
                    reasonUnavailable: "Provider budget or rate quota exceeded during candidate generation.",
                };
            }

            return {
                available: false,
                unavailable: true,
                reasonUnavailable: `Secondary candidate generation failed: ${err.message}`,
            };
        }
    }

    /**
     * Evaluates stability against an optional secondary candidate SQL or generates one independently.
     * If candidate generation times out or provider is at budget limit, marks unavailable: true without failing query.
     */
    public async evaluateStability(
        primarySql: string,
        question: string,
        options?: {
            secondarySql?: string;
            provider?: ILLMProvider;
            userPreference?: ProviderType;
            timeoutMs?: number;
            promptVariation?: string;
        }
    ): Promise<CandidateStabilityResult> {
        let secondarySql = options?.secondarySql;

        // If secondary SQL was not provided, attempt independent generation
        if (!secondarySql) {
            const genResult = await this.generateSecondaryCandidate(question, options);
            if (!genResult.available || !genResult.sql) {
                return {
                    score: 0.0,
                    available: false,
                    unavailable: true,
                    reasonUnavailable: genResult.reasonUnavailable ?? "Secondary candidate generation skipped or unavailable.",
                    evidenceSummary: "Candidate stability evidence not available (contributes 0 to score; explicitly marked).",
                };
            }
            secondarySql = genResult.sql;
        }

        try {
            const primaryAst = parse(primarySql)[0];
            const secondaryAst = parse(secondarySql)[0];
            return this.evaluateEquivalence(primaryAst, secondaryAst, secondarySql);
        } catch (err) {
            return {
                score: 0.0,
                available: false,
                unavailable: true,
                reasonUnavailable: `Failed to parse SQL candidate AST: ${(err as Error).message}`,
                evidenceSummary: "Secondary candidate SQL parsing failed.",
                secondarySql,
            };
        }
    }

    /**
     * Evaluates semantic agreement between intent and primary SQL using a bounded verifier prompt.
     * Strict time budget: 10s local, 5s cloud.
     * If verifier times out or provider is unavailable/budget-limited, returns unavailable: true without failing query.
     */
    public async verifySemanticAgreement(
        primarySql: string,
        question: string,
        intent: IntentSlots,
        options?: {
            provider?: ILLMProvider;
            userPreference?: ProviderType;
            timeoutMs?: number;
            semanticFindings?: SemanticFinding[];
        }
    ): Promise<VerifierResult> {
        // 1. Resolve Provider
        let provider = options?.provider;
        if (!provider && this.providerRouter) {
            try {
                provider = await this.providerRouter.resolveProvider(options?.userPreference);
            } catch {
                provider = undefined;
            }
        }

        // If no provider is available, check if deterministic verification from findings can be computed
        if (!provider) {
            if (options?.semanticFindings) {
                return this.evaluateDeterministicVerifier(options.semanticFindings);
            }
            return {
                score: 0.0,
                available: false,
                unavailable: true,
                reasonUnavailable: "No LLM provider available for bounded verifier evaluation.",
                evidenceSummary: "Verifier evidence unavailable (contributes 0 to score; explicitly marked).",
            };
        }

        // 2. Budget Check for Cloud Providers
        const modelInfo = provider.getModelInfo();
        if (!modelInfo.isLocal && this.providerRouter) {
            try {
                const budgetStatus = await this.providerRouter.getBudgetService().getBudgetStatus();
                if (budgetStatus.isCapReached) {
                    if (options?.semanticFindings) {
                        return this.evaluateDeterministicVerifier(options.semanticFindings);
                    }
                    return {
                        score: 0.0,
                        available: false,
                        unavailable: true,
                        reasonUnavailable: `Cloud provider budget cap reached ($${budgetStatus.spentTodayUsd.toFixed(2)} USD spent of $${budgetStatus.budgetLimitUsd.toFixed(2)} USD limit).`,
                        evidenceSummary: "Bounded verifier skipped due to cloud budget limit.",
                    };
                }
            } catch {
                // Ignore budget check errors and proceed
            }
        }

        // 3. Time Budget Resolution (10s local, 5s cloud)
        const timeoutMs = options?.timeoutMs ?? (modelInfo.isLocal ? VERIFIER_TIMEOUT_LOCAL_MS : VERIFIER_TIMEOUT_CLOUD_MS);

        // 4. Build Bounded Verifier Prompt
        const prompt = this.buildVerifierPrompt(question, primarySql, intent);

        // 5. Execute Verifier with temperature 0.0
        try {
            const response = await provider.generate(prompt, {
                timeoutMs,
                temperature: 0.0,
                systemPrompt: VERIFIER_SYSTEM_PROMPT,
            });

            const parsedScorecard = this.extractVerifierResponse(response.rawText);
            if (!parsedScorecard) {
                if (options?.semanticFindings) {
                    return this.evaluateDeterministicVerifier(options.semanticFindings);
                }
                return {
                    score: 0.0,
                    available: false,
                    unavailable: true,
                    reasonUnavailable: "Verifier returned unparseable JSON response.",
                    evidenceSummary: "Bounded verifier response parsing failed.",
                };
            }

            return {
                score: parsedScorecard.score,
                available: true,
                unavailable: false,
                agrees: parsedScorecard.agrees,
                discrepancies: parsedScorecard.discrepancies,
                evidenceSummary: parsedScorecard.explanation,
            };
        } catch (err: any) {
            if (options?.semanticFindings) {
                // Fall back gracefully to deterministic verification if LLM fails
                return this.evaluateDeterministicVerifier(options.semanticFindings);
            }

            if (err instanceof ProviderTimeoutError || err.name === "AbortError" || err.message?.includes("timed out")) {
                return {
                    score: 0.0,
                    available: false,
                    unavailable: true,
                    reasonUnavailable: `Verifier evaluation timed out under strict latency budget (${timeoutMs}ms).`,
                    evidenceSummary: "Bounded verifier timed out.",
                };
            }

            if (err instanceof ProviderQuotaError) {
                return {
                    score: 0.0,
                    available: false,
                    unavailable: true,
                    reasonUnavailable: "Provider budget or rate quota exceeded during verifier evaluation.",
                    evidenceSummary: "Verifier skipped due to provider quota.",
                };
            }

            return {
                score: 0.0,
                available: false,
                unavailable: true,
                reasonUnavailable: `Verifier evaluation failed: ${err.message}`,
                evidenceSummary: "Bounded verifier evaluation failed.",
            };
        }
    }

    /**
     * Computes deterministic verifier consensus based on AST semantic validation findings.
     */
    public evaluateDeterministicVerifier(findings: SemanticFinding[]): VerifierResult {
        const hasCritical = findings.some((f) => f.severity === "CRITICAL");
        const hasWarning = findings.some((f) => f.severity === "WARNING");
        const score = hasCritical ? 0.0 : (hasWarning ? 0.75 : 1.0);
        const discrepancies = findings.map((f) => f.message);

        let evidenceSummary: string;
        if (hasCritical) {
            const criticalCount = findings.filter((f) => f.severity === "CRITICAL").length;
            evidenceSummary = `Deterministic verification identified ${criticalCount} critical semantic violation(s).`;
        } else if (hasWarning) {
            evidenceSummary = "Deterministic verification identified advisory warnings; query is structurally sound.";
        } else {
            evidenceSummary = "Full semantic consensus with AST and glossary rules.";
        }

        return {
            score,
            available: true,
            unavailable: false,
            agrees: !hasCritical,
            discrepancies,
            evidenceSummary,
        };
    }

    /**
     * Evaluates both candidate stability and verifier consensus in a unified call.
     */
    public async evaluateBoth(
        primarySql: string,
        question: string,
        intent: IntentSlots,
        options?: {
            secondarySql?: string;
            provider?: ILLMProvider;
            userPreference?: ProviderType;
            candidateTimeoutMs?: number;
            verifierTimeoutMs?: number;
            semanticFindings?: SemanticFinding[];
            promptVariation?: string;
        }
    ): Promise<{
        stability: CandidateStabilityResult;
        verifier: VerifierResult;
    }> {
        const [stability, verifier] = await Promise.all([
            this.evaluateStability(primarySql, question, {
                secondarySql: options?.secondarySql,
                provider: options?.provider,
                userPreference: options?.userPreference,
                timeoutMs: options?.candidateTimeoutMs,
                promptVariation: options?.promptVariation,
            }),
            this.verifySemanticAgreement(primarySql, question, intent, {
                provider: options?.provider,
                userPreference: options?.userPreference,
                timeoutMs: options?.verifierTimeoutMs,
                semanticFindings: options?.semanticFindings,
            }),
        ]);

        return { stability, verifier };
    }

    /**
     * Robust extraction of SQL statement from raw LLM output (JSON or code fences).
     */
    public extractSqlFromRaw(rawText: string): string | null {
        if (!rawText || typeof rawText !== "string") return null;
        const trimmed = rawText.trim();

        // 1. Try parsing as JSON object with 'sql' property
        try {
            const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
            const jsonText = jsonMatch ? jsonMatch[1].trim() : trimmed;
            const parsed = JSON.parse(jsonText);
            if (parsed && typeof parsed === "object" && typeof parsed.sql === "string") {
                return parsed.sql.trim();
            }
        } catch {
            // Not pure JSON, proceed to fence / regex extraction
        }

        // 2. Try extracting from ```sql ... ``` code block
        const sqlMatch = trimmed.match(/```(?:sql)?\s*([\s\S]*?)\s*```/i);
        if (sqlMatch && sqlMatch[1]) {
            const candidate = sqlMatch[1].trim();
            if (/^(SELECT|WITH)\b/i.test(candidate)) {
                return candidate;
            }
        }

        // 3. Try direct SELECT or WITH query
        if (/^(SELECT|WITH)\b/i.test(trimmed)) {
            return trimmed;
        }

        // 4. Try matching statement beginning inside text
        const match = trimmed.match(/\b(SELECT|WITH)\b[\s\S]+/i);
        if (match) {
            return match[0].trim();
        }

        return null;
    }

    /**
     * Parses verifier JSON response.
     */
    public extractVerifierResponse(rawText: string): {
        agrees: boolean;
        score: number;
        explanation: string;
        discrepancies: string[];
    } | null {
        if (!rawText) return null;
        let cleaned = rawText.trim();

        // Extract from markdown code fence if wrapped
        const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (jsonMatch) {
            cleaned = jsonMatch[1].trim();
        }

        // Find outermost JSON object
        const firstBrace = cleaned.indexOf("{");
        const lastBrace = cleaned.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            cleaned = cleaned.substring(firstBrace, lastBrace + 1);
        }

        try {
            const parsed = JSON.parse(cleaned);
            const agrees = Boolean(parsed.agrees);
            let score = typeof parsed.score === "number" ? parsed.score : (agrees ? 1.0 : 0.0);
            score = Math.max(0.0, Math.min(1.0, Math.round(score * 100) / 100));
            const explanation = typeof parsed.explanation === "string" ? parsed.explanation : "Verifier assessment completed.";
            const discrepancies = Array.isArray(parsed.discrepancies) ? parsed.discrepancies.map(String) : [];

            return { agrees, score, explanation, discrepancies };
        } catch {
            return null;
        }
    }

    private buildVerifierPrompt(question: string, primarySql: string, intent: IntentSlots): string {
        const slotsSummary = [
            `- Metric: ${intent.metric || "None"}`,
            `- Aggregation: ${intent.aggregation || "NONE"}`,
            `- Dimensions / Grouping: ${intent.dimensions.length > 0 ? intent.dimensions.join(", ") : "None"}`,
            `- Filters: ${intent.filters.length > 0 ? intent.filters.map((f) => `${f.column} ${f.operator} ${JSON.stringify(f.value)}`).join("; ") : "None"}`,
            `- Temporal Bounds: ${intent.temporal ? `${intent.temporal.startDate || "*"} to ${intent.temporal.endDate || "*"}` : "None"}`,
            `- Sort / Limit: ${intent.sort ? `${intent.sort.column} ${intent.sort.direction}` : "None"}${intent.rowLimit ? `, Limit: ${intent.rowLimit}` : ""}`,
        ].join("\n");

        return `### Verification Task
User Analytical Question:
"${question.trim()}"

Extracted Intent Slots:
${slotsSummary}

Primary SQL Query Under Verification:
\`\`\`sql
${primarySql.trim()}
\`\`\`

Verify semantic agreement and output the strict JSON scorecard:`;
    }

    private findRootSelect(ast: any): any {
        if (!ast) return null;
        if (ast.type === "select") return ast;
        if (ast.type === "with" && ast.in) return ast.in;
        return null;
    }

    private extractColumnNames(columns: any[]): string[] {
        if (!Array.isArray(columns)) return [];
        const cols: string[] = [];

        for (const col of columns) {
            if (col.alias?.name) {
                cols.push(String(col.alias.name).toLowerCase());
            }
            if (col.expr?.name) {
                cols.push(String(col.expr.name).toLowerCase());
            }
            if (col.expr?.function?.name) {
                cols.push(String(col.expr.function.name).toLowerCase());
            }
            // If call expression with args, inspect args for column names
            if (col.expr?.type === "call" && Array.isArray(col.expr.args)) {
                for (const arg of col.expr.args) {
                    if (arg.name) cols.push(String(arg.name).toLowerCase());
                    if (arg.left?.name) cols.push(String(arg.left.name).toLowerCase());
                    if (arg.right?.name) cols.push(String(arg.right.name).toLowerCase());
                }
            }
        }
        return Array.from(new Set(cols));
    }

    private extractTableNames(fromNodes: any[]): string[] {
        if (!Array.isArray(fromNodes)) return [];
        const tables: string[] = [];

        for (const item of fromNodes) {
            if (item.type === "table" && item.name?.name) {
                tables.push(String(item.name.name).toLowerCase());
            }
            if (item.join) {
                const joins = Array.isArray(item.join) ? item.join : [item.join];
                for (const j of joins) {
                    if (j.type?.table?.name) {
                        tables.push(String(j.type.table.name).toLowerCase());
                    } else if (j.table?.name) {
                        tables.push(String(j.table.name).toLowerCase());
                    }
                }
            }
        }
        return Array.from(new Set(tables));
    }

    private extractPredicateColumns(whereNode: any): string[] {
        if (!whereNode) return [];
        const cols: string[] = [];

        const walk = (node: any) => {
            if (!node || typeof node !== "object") return;
            if (node.type === "ref" && node.name) {
                cols.push(String(node.name).toLowerCase());
            }
            for (const key of Object.keys(node)) {
                if (typeof node[key] === "object") walk(node[key]);
            }
        };

        walk(whereNode);
        return Array.from(new Set(cols));
    }

    private computeJaccard(a: string[], b: string[]): number {
        if (a.length === 0 && b.length === 0) return 1.0;
        const setA = new Set(a);
        const setB = new Set(b);

        const intersectionSize = Array.from(setA).filter((x) => setB.has(x)).length;
        const unionSize = new Set([...a, ...b]).size;

        if (unionSize === 0) return 1.0;
        return Math.round((intersectionSize / unionSize) * 100) / 100;
    }
}
