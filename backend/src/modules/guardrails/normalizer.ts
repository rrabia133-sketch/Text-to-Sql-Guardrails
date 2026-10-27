import { parse, toSql } from "pgsql-ast-parser";
import { NormalizedSqlResult, GuardrailFinding } from "@text2sql/contracts";

export interface NormalizerOptions {
    defaultLimit?: number;  // Defaults to 50
    maxLimit?: number;      // Defaults to 100
    maxOffset?: number;     // Defaults to 1000
}

export interface NormalizerOutput {
    ok: boolean;
    result: NormalizedSqlResult;
    findings: GuardrailFinding[];
}

export class SqlNormalizer {
    private defaultLimit: number;
    private maxLimit: number;
    private maxOffset: number;

    constructor(options?: NormalizerOptions) {
        this.defaultLimit = options?.defaultLimit ?? 50;
        this.maxLimit = options?.maxLimit ?? 100;
        this.maxOffset = options?.maxOffset ?? 1000;
    }

    /**
     * Normalizes a raw SQL string and enforces row caps & offset bounds.
     * Enforces an explicit LIMIT clause, bounds OFFSET, serializes to canonical dialect syntax,
     * and performs a post-transform revalidation pass.
     */
    public normalize(sql: string): NormalizerOutput {
        // 1. Fail closed on empty or whitespace queries
        if (!sql || !sql.trim()) {
            return {
                ok: false,
                result: {
                    originalSql: sql,
                    normalizedSql: "",
                    astModified: false,
                },
                findings: [
                    {
                        code: "SYNTAX_ERROR",
                        severity: "CRITICAL",
                        message: "SQL string cannot be empty.",
                    },
                ],
            };
        }

        const trimmedSql = sql.trim();
        let astList: any[];

        // 2. Parse initial AST
        try {
            astList = parse(trimmedSql);
        } catch (err: any) {
            return {
                ok: false,
                result: {
                    originalSql: sql,
                    normalizedSql: "",
                    astModified: false,
                },
                findings: [
                    {
                        code: "SYNTAX_ERROR",
                        severity: "CRITICAL",
                        message: `Failed to parse SQL: ${err.message}`,
                    },
                ],
            };
        }

        if (!astList || astList.length === 0) {
            return {
                ok: false,
                result: {
                    originalSql: sql,
                    normalizedSql: "",
                    astModified: false,
                },
                findings: [
                    {
                        code: "SYNTAX_ERROR",
                        severity: "CRITICAL",
                        message: "No executable SQL statements found in query.",
                    },
                ],
            };
        }

        const rootAst = astList[0];
        let astModified = false;
        let injectedLimit: number | undefined;
        let clampedLimit: number | undefined;

        // 3. Locate target statement where LIMIT/OFFSET should be enforced
        let targetStmt: any = rootAst;
        if (rootAst.type === "with" && rootAst.in) {
            targetStmt = rootAst.in;
        }

        // 4. Enforce LIMIT row-cap
        if (!targetStmt.limit) {
            targetStmt.limit = {
                limit: {
                    type: "integer",
                    value: this.defaultLimit,
                },
            };
            injectedLimit = this.defaultLimit;
            astModified = true;
        } else {
            // If limit object exists but limit value is absent
            if (!targetStmt.limit.limit) {
                targetStmt.limit.limit = {
                    type: "integer",
                    value: this.defaultLimit,
                };
                injectedLimit = this.defaultLimit;
                astModified = true;
            } else {
                const currentLimitVal = targetStmt.limit.limit.value;
                if (typeof currentLimitVal === "number" && currentLimitVal > this.maxLimit) {
                    targetStmt.limit.limit.value = this.maxLimit;
                    clampedLimit = this.maxLimit;
                    astModified = true;
                }
            }

            // Enforce OFFSET bound
            if (targetStmt.limit.offset) {
                const currentOffsetVal = targetStmt.limit.offset.value;
                if (typeof currentOffsetVal === "number" && currentOffsetVal > this.maxOffset) {
                    targetStmt.limit.offset.value = this.maxOffset;
                    astModified = true;
                }
            }
        }

        // 5. Serialize AST to canonical SQL dialect
        let normalizedSql: string;
        try {
            normalizedSql = toSql.statement(rootAst);
        } catch (err: any) {
            return {
                ok: false,
                result: {
                    originalSql: sql,
                    normalizedSql: "",
                    astModified,
                },
                findings: [
                    {
                        code: "SYNTAX_ERROR",
                        severity: "CRITICAL",
                        message: `Failed to serialize normalized SQL: ${err.message}`,
                    },
                ],
            };
        }

        // 6. Post-transform revalidation pass
        try {
            const recheckList = parse(normalizedSql);
            if (recheckList.length !== 1) {
                return {
                    ok: false,
                    result: {
                        originalSql: sql,
                        normalizedSql,
                        injectedLimit,
                        clampedLimit,
                        astModified,
                    },
                    findings: [
                        {
                            code: "SYNTAX_ERROR",
                            severity: "CRITICAL",
                            message: "Normalized SQL resulted in multiple statements.",
                        },
                    ],
                };
            }
        } catch (err: any) {
            return {
                ok: false,
                result: {
                    originalSql: sql,
                    normalizedSql,
                    injectedLimit,
                    clampedLimit,
                    astModified,
                },
                findings: [
                    {
                        code: "SYNTAX_ERROR",
                        severity: "CRITICAL",
                        message: `Post-transform revalidation failed: ${err.message}`,
                    },
                ],
            };
        }

        return {
            ok: true,
            result: {
                originalSql: sql,
                normalizedSql,
                injectedLimit,
                clampedLimit,
                astModified,
            },
            findings: [],
        };
    }
}
