import { parse } from "pgsql-ast-parser";
import type { ProviderRouter } from "../providers/provider.router.js";
import type { PromptBuilder } from "../generation/prompts/prompt-builder.js";

export interface CandidateStabilityResult {
    score: number; // 0.0 to 1.0 (weighted contribution to confidence is 15%)
    available: boolean;
    reasonUnavailable?: string;
    evidenceSummary: string;
    secondarySql?: string;
    metrics?: {
        projectionSimilarity: number;
        tableJoinSimilarity: number;
        predicateSimilarity: number;
    };
}

export class CandidateVerifierService {
    private readonly providerRouter?: ProviderRouter;
    private readonly promptBuilder?: PromptBuilder;

    constructor(options?: {
        providerRouter?: ProviderRouter;
        promptBuilder?: PromptBuilder;
    }) {
        this.providerRouter = options?.providerRouter;
        this.promptBuilder = options?.promptBuilder;
    }

    /**
     * Evaluates structural equivalence between primary SQL and a secondary candidate.
     */
    public evaluateEquivalence(primaryAst: any, secondaryAst: any, secondarySql?: string): CandidateStabilityResult {
        if (!primaryAst || !secondaryAst) {
            return {
                score: 0.0,
                available: false,
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
     * Evaluates stability against an optional provided secondary candidate or skips safely.
     */
    public async evaluateStability(
        primarySql: string,
        question: string,
        options?: {
            secondarySql?: string;
        }
    ): Promise<CandidateStabilityResult> {
        // If secondary SQL was explicitly supplied (e.g. from multi-candidate generation or test)
        if (options?.secondarySql) {
            try {
                const primaryAst = parse(primarySql)[0];
                const secondaryAst = parse(options.secondarySql)[0];
                return this.evaluateEquivalence(primaryAst, secondaryAst, options.secondarySql);
            } catch (err) {
                return {
                    score: 0.0,
                    available: false,
                    reasonUnavailable: `Failed to parse SQL candidate: ${(err as Error).message}`,
                    evidenceSummary: "Secondary candidate SQL parsing failed.",
                };
            }
        }

        // If secondary generation is skipped or provider router is unavailable
        return {
            score: 0.0,
            available: false,
            reasonUnavailable: "Secondary candidate generation disabled or skipped under current latency profile.",
            evidenceSummary: "Candidate stability evidence not available (contributes 0 to score; explicitly marked).",
        };
    }

    private findRootSelect(ast: any): any {
        if (!ast) return null;
        if (ast.type === "select") return ast;
        if (ast.type === "with" && ast.in) return ast.in;
        return null;
    }

    private extractColumnNames(columns: any[]): string[] {
        if (!Array.isArray(columns)) return [];
        return columns.map((col) => {
            if (col.alias?.name) return String(col.alias.name).toLowerCase();
            if (col.expr?.name) return String(col.expr.name).toLowerCase();
            if (col.expr?.function?.name) return String(col.expr.function.name).toLowerCase();
            return "*";
        });
    }

    private extractTableNames(fromNodes: any[]): string[] {
        if (!Array.isArray(fromNodes)) return [];
        const tables: string[] = [];

        for (const item of fromNodes) {
            if (item.type === "table" && item.name) {
                tables.push(String(item.name.name).toLowerCase());
                if (item.join) {
                    const joins = Array.isArray(item.join) ? item.join : [item.join];
                    for (const j of joins) {
                        if (j.type?.table?.name) {
                            tables.push(String(j.type.table.name).toLowerCase());
                        }
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
