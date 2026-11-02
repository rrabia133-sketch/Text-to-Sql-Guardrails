import { parse } from "pgsql-ast-parser";
import {
    type IntentSlots,
    type SemanticFinding,
    type SemanticValidationResult,
    type SemanticRepairAttempt,
    type SemanticViolationCode,
    SemanticRepairAttemptSchema,
    type GuardrailValidationResult,
    type ProviderType,
} from "@text2sql/contracts";
import { GuardrailsService } from "../guardrails/guardrails.service.js";
import { SemanticValidatorService } from "./semantic-validator.service.js";
import { SchemaService } from "../schema/schema.service.js";
import type { ProviderRouter } from "../providers/provider.router.js";
import type { ILLMProvider } from "../providers/provider.interface.js";
import { ProviderTimeoutError, ProviderQuotaError } from "../providers/base.provider.js";

export const MAX_REPAIR_ATTEMPTS = 1;

export const REPAIRABLE_VIOLATION_CODES: Set<SemanticViolationCode> = new Set([
    "WRONG_AGGREGATION",
    "MISSING_DATE_FILTER",
    "UNHANDLED_ORDER_STATUS",
    "GLOSSARY_FORMULA_MISMATCH",
    "UNRESOLVED_INTENT_SLOT",
    "INVALID_DATE_BOUNDS",
]);

export interface RepairEngineOptions {
    guardrailsService?: GuardrailsService;
    semanticValidator?: SemanticValidatorService;
    schemaService?: SchemaService;
    providerRouter?: ProviderRouter;
}

export interface RepairEngineResult {
    success: boolean;
    attempt: SemanticRepairAttempt;
    normalizedSql?: string;
    semanticResult?: SemanticValidationResult;
    guardrailResult?: GuardrailValidationResult;
    error?: string;
}

export const REPAIR_SYSTEM_PROMPT = `You are a high-assurance SQL repair assistant for an enterprise PostgreSQL database.
Your task is to fix specific semantic violations in an analytical SQL query while strictly preserving read-only SELECT security.
You must return only a valid JSON object matching the format:
{
  "sql": "SELECT ...",
  "explanation": "Brief explanation of the fixes applied."
}
Rules:
1. ONLY produce a single read-only SELECT query. Non-SELECT statements are strictly forbidden.
2. Address the reported semantic issues (e.g., correct aggregation function, add required status filter, add temporal boundaries).
3. Do NOT reference unapproved tables or system catalogs.
4. Keep all valid parts of the original query intact.`;

export class RepairEngineService {
    private readonly guardrailsService: GuardrailsService;
    private readonly semanticValidator: SemanticValidatorService;
    private readonly schemaService: SchemaService;
    private readonly providerRouter?: ProviderRouter;

    constructor(options?: RepairEngineOptions) {
        this.guardrailsService = options?.guardrailsService ?? new GuardrailsService();
        this.semanticValidator = options?.semanticValidator ?? new SemanticValidatorService();
        this.schemaService = options?.schemaService ?? new SchemaService();
        this.providerRouter = options?.providerRouter;
    }

    /**
     * Filters findings to identify repairable semantic violations.
     */
    public identifyRepairableFindings(findings: SemanticFinding[]): SemanticFinding[] {
        return findings.filter((f) => f.repairable || REPAIRABLE_VIOLATION_CODES.has(f.code));
    }

    /**
     * Constructs a targeted repair prompt containing only:
     * 1. Schema context
     * 2. Original question
     * 3. Faulty SQL
     * 4. Specific semantic findings to correct
     */
    public buildRepairPrompt(
        question: string,
        faultySql: string,
        findings: SemanticFinding[],
        schemaContext: string
    ): string {
        const errorDetails = findings
            .map(
                (f, i) =>
                    `${i + 1}. [${f.code}] ${f.message}\n   - Expected: ${f.expected || "N/A"}\n   - Suggestion: ${f.suggestion || "N/A"}`
            )
            .join("\n\n");

        return `### Database Schema Context
${schemaContext}

### User Natural Language Question
"${question.trim()}"

### Faulty SQL Query to Repair
\`\`\`sql
${faultySql.trim()}
\`\`\`

### Detected Semantic Defects
${errorDetails}

### Task Instructions
Correct the SQL query to resolve all detected semantic defects above.
Keep the query strictly read-only SELECT and adhere to the schema and business glossary.
Respond strictly in JSON format:
{
  "sql": "SELECT ...",
  "explanation": "concise explanation of repair"
}`;
    }

    /**
     * Executes bounded automated repair (maximum 1 repair attempt).
     * If repaired query still has critical semantic findings or violates guardrails, it fails closed.
     */
    public async repair(
        originalSql: string,
        question: string,
        intent: IntentSlots,
        initialSemanticResult: SemanticValidationResult,
        options?: {
            provider?: ILLMProvider;
            userPreference?: ProviderType;
            timeoutMs?: number;
        }
    ): Promise<RepairEngineResult> {
        // 1. If original query is already valid, no repair needed
        if (initialSemanticResult.isValid) {
            const attempt = SemanticRepairAttemptSchema.parse({
                attemptNumber: 1,
                originalSql,
                repairedSql: originalSql,
                resolvedCodes: [],
                remainingFindings: initialSemanticResult.findings,
                success: true,
            });
            return {
                success: true,
                attempt,
                normalizedSql: originalSql,
                semanticResult: initialSemanticResult,
            };
        }

        // 2. Identify repairable semantic findings
        const repairableFindings = this.identifyRepairableFindings(initialSemanticResult.findings);
        if (repairableFindings.length === 0) {
            const attempt = SemanticRepairAttemptSchema.parse({
                attemptNumber: 1,
                originalSql,
                repairedSql: originalSql,
                resolvedCodes: [],
                remainingFindings: initialSemanticResult.findings,
                success: false,
            });
            return {
                success: false,
                attempt,
                semanticResult: initialSemanticResult,
                error: "No repairable semantic findings detected; query requires manual clarification.",
            };
        }

        // 3. Resolve LLM Provider
        let provider = options?.provider;
        if (!provider && this.providerRouter) {
            try {
                provider = await this.providerRouter.resolveProvider(options?.userPreference);
            } catch (err: any) {
                const attempt = SemanticRepairAttemptSchema.parse({
                    attemptNumber: 1,
                    originalSql,
                    repairedSql: originalSql,
                    resolvedCodes: [],
                    remainingFindings: initialSemanticResult.findings,
                    success: false,
                });
                return {
                    success: false,
                    attempt,
                    semanticResult: initialSemanticResult,
                    error: `Provider resolution failed for repair: ${err.message}`,
                };
            }
        }

        if (!provider) {
            const attempt = SemanticRepairAttemptSchema.parse({
                attemptNumber: 1,
                originalSql,
                repairedSql: originalSql,
                resolvedCodes: [],
                remainingFindings: initialSemanticResult.findings,
                success: false,
            });
            return {
                success: false,
                attempt,
                semanticResult: initialSemanticResult,
                error: "No LLM provider available to execute automated semantic repair.",
            };
        }

        // 4. Budget Check for Cloud Provider
        const modelInfo = provider.getModelInfo();
        if (!modelInfo.isLocal && this.providerRouter) {
            try {
                const budget = await this.providerRouter.getBudgetService().getBudgetStatus();
                if (budget.isCapReached) {
                    const attempt = SemanticRepairAttemptSchema.parse({
                        attemptNumber: 1,
                        originalSql,
                        repairedSql: originalSql,
                        resolvedCodes: [],
                        remainingFindings: initialSemanticResult.findings,
                        success: false,
                    });
                    return {
                        success: false,
                        attempt,
                        semanticResult: initialSemanticResult,
                        error: "Automated repair skipped; cloud provider daily budget cap reached.",
                    };
                }
            } catch {
                // Ignore budget check errors
            }
        }

        // 5. Construct Targeted Repair Prompt
        const catalog = await this.schemaService.getSanitizedCatalog();
        const schemaContext = this.schemaService.formatForPrompt(catalog);
        const prompt = this.buildRepairPrompt(question, originalSql, repairableFindings, schemaContext);

        // Time budget: 10s local, 5s cloud (or custom timeoutMs)
        const timeoutMs = options?.timeoutMs ?? (modelInfo.isLocal ? 10_000 : 5_000);

        let repairedRawSql: string;
        try {
            const response = await provider.generate(prompt, {
                timeoutMs,
                temperature: 0.0,
                systemPrompt: REPAIR_SYSTEM_PROMPT,
            });

            const extracted = this.extractSql(response.rawText);
            if (!extracted) {
                const attempt = SemanticRepairAttemptSchema.parse({
                    attemptNumber: 1,
                    originalSql,
                    repairedSql: originalSql,
                    resolvedCodes: [],
                    remainingFindings: initialSemanticResult.findings,
                    success: false,
                });
                return {
                    success: false,
                    attempt,
                    semanticResult: initialSemanticResult,
                    error: "Model repair response did not contain extractable SQL.",
                };
            }
            repairedRawSql = extracted;
        } catch (err: any) {
            const attempt = SemanticRepairAttemptSchema.parse({
                attemptNumber: 1,
                originalSql,
                repairedSql: originalSql,
                resolvedCodes: [],
                remainingFindings: initialSemanticResult.findings,
                success: false,
            });

            const errorMsg =
                err instanceof ProviderTimeoutError
                    ? "Automated repair timed out under strict latency budget."
                    : err instanceof ProviderQuotaError
                      ? "Automated repair aborted due to provider quota limit."
                      : `Automated repair generation failed: ${err.message}`;

            return {
                success: false,
                attempt,
                semanticResult: initialSemanticResult,
                error: errorMsg,
            };
        }

        // 6. Subject Repaired SQL to the Entire Validation Pipeline (Steps 1 to 5: Guardrails)
        const guardrailResult = await this.guardrailsService.validate(repairedRawSql);
        if (!guardrailResult.valid) {
            // Repair failed security guardrails! FAIL CLOSED!
            const attempt = SemanticRepairAttemptSchema.parse({
                attemptNumber: 1,
                originalSql,
                repairedSql: repairedRawSql,
                resolvedCodes: [],
                remainingFindings: initialSemanticResult.findings,
                success: false,
            });
            return {
                success: false,
                attempt,
                guardrailResult,
                error: `Repaired query violated security guardrails: ${guardrailResult.violations.map((v) => v.message).join("; ")}`,
            };
        }

        // 7. Re-Validate Normalized AST with SemanticValidatorService
        const normalizedSql = guardrailResult.normalizedSql || repairedRawSql;
        let repairedAst: any;
        try {
            const parsed = parse(normalizedSql);
            repairedAst = parsed[0];
        } catch (err: any) {
            const attempt = SemanticRepairAttemptSchema.parse({
                attemptNumber: 1,
                originalSql,
                repairedSql: normalizedSql,
                resolvedCodes: [],
                remainingFindings: initialSemanticResult.findings,
                success: false,
            });
            return {
                success: false,
                attempt,
                guardrailResult,
                error: `Failed to parse normalized repaired SQL AST: ${err.message}`,
            };
        }

        const newSemanticResult = this.semanticValidator.validate(repairedAst, intent);

        // 8. Track Resolved Semantic Codes
        const initialCodes = initialSemanticResult.findings.map((f) => f.code);
        const remainingCodes = new Set(newSemanticResult.findings.map((f) => f.code));
        const resolvedCodes = Array.from(new Set(initialCodes.filter((c) => !remainingCodes.has(c))));

        const success = newSemanticResult.isValid;

        const attempt = SemanticRepairAttemptSchema.parse({
            attemptNumber: 1,
            originalSql,
            repairedSql: normalizedSql,
            resolvedCodes,
            remainingFindings: newSemanticResult.findings,
            success,
        });

        return {
            success,
            attempt,
            normalizedSql,
            semanticResult: newSemanticResult,
            guardrailResult,
            error: success
                ? undefined
                : `Repaired query still contains ${newSemanticResult.criticalCount} critical violation(s). Single repair attempt exhausted.`,
        };
    }

    /**
     * Extracts SQL from JSON, markdown fences, or raw text.
     */
    public extractSql(rawText: string): string | null {
        if (!rawText || typeof rawText !== "string") return null;
        const trimmed = rawText.trim();

        // 1. JSON parse
        try {
            const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
            const jsonText = jsonMatch ? jsonMatch[1].trim() : trimmed;
            const parsed = JSON.parse(jsonText);
            if (parsed && typeof parsed === "object" && typeof parsed.sql === "string") {
                return parsed.sql.trim();
            }
        } catch {
            // Not JSON
        }

        // 2. Markdown ```sql ... ```
        const sqlMatch = trimmed.match(/```(?:sql)?\s*([\s\S]*?)\s*```/i);
        if (sqlMatch && sqlMatch[1]) {
            const candidate = sqlMatch[1].trim();
            if (/^(SELECT|WITH)\b/i.test(candidate)) {
                return candidate;
            }
        }

        // 3. Direct SELECT or WITH
        if (/^(SELECT|WITH)\b/i.test(trimmed)) {
            return trimmed;
        }

        // 4. Embedded SELECT / WITH
        const match = trimmed.match(/\b(SELECT|WITH)\b[\s\S]+/i);
        if (match) {
            return match[0].trim();
        }

        return null;
    }
}

