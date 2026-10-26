import { parse, Statement, SelectStatement, WithStatement } from "pgsql-ast-parser";
import {
    GuardrailFinding,
    GuardrailLocation,
} from "@text2sql/contracts";

export interface AstParseSuccess {
    ok: true;
    ast: SelectStatement | WithStatement;
    rawStatements: Statement[];
    findings: [];
}

export interface AstParseFailure {
    ok: false;
    ast?: undefined;
    rawStatements?: Statement[];
    findings: GuardrailFinding[];
}

export type AstParseResult = AstParseSuccess | AstParseFailure;

/**
 * AstParserService wraps pgsql-ast-parser and enforces statement-level security policies:
 * 1. Syntax correctness & non-empty queries
 * 2. Strict single-statement enforcement (no stacked queries or semicolon chaining)
 * 3. Statement type is strictly SELECT or non-modifying WITH ... SELECT
 * 4. Lock clause detection (FOR UPDATE, FOR SHARE, NOWAIT, SKIP LOCKED) across all query blocks
 */
export class AstParserService {
    /**
     * Parses a raw SQL string into an AST and performs statement-level guardrail checks.
     */
    public parse(sql: string): AstParseResult {
        // 1. Reject empty or whitespace-only queries
        if (!sql || !sql.trim()) {
            return {
                ok: false,
                findings: [
                    {
                        code: "SYNTAX_ERROR",
                        severity: "CRITICAL",
                        message: "SQL query string cannot be empty.",
                    },
                ],
            };
        }

        const trimmedSql = sql.trim();
        let astList: Statement[];

        // 2. Parse AST
        try {
            astList = parse(trimmedSql);
        } catch (err: any) {
            const location = this.extractLocationFromError(err.message);
            const cleanMessage = this.extractCleanErrorMessage(err.message);
            return {
                ok: false,
                findings: [
                    {
                        code: "SYNTAX_ERROR",
                        severity: "CRITICAL",
                        message: `Failed to parse SQL: ${cleanMessage}`,
                        location,
                    },
                ],
            };
        }

        // 3. Statement count verification (must be exactly 1)
        if (astList.length === 0) {
            return {
                ok: false,
                findings: [
                    {
                        code: "SYNTAX_ERROR",
                        severity: "CRITICAL",
                        message: "No executable SQL statements found in query.",
                    },
                ],
            };
        }

        if (astList.length > 1) {
            return {
                ok: false,
                rawStatements: astList,
                findings: [
                    {
                        code: "MULTIPLE_STATEMENTS",
                        severity: "CRITICAL",
                        message: `Query contains ${astList.length} statements. Only single SELECT statements are permitted.`,
                    },
                ],
            };
        }

        const stmt = astList[0];

        // 4. Enforce statement type is SELECT or WITH
        const typeFindings: GuardrailFinding[] = [];

        if (stmt.type !== "select" && stmt.type !== "with") {
            return {
                ok: false,
                rawStatements: astList,
                findings: [
                    {
                        code: "FORBIDDEN_STATEMENT_TYPE",
                        severity: "CRITICAL",
                        nodeType: stmt.type,
                        message: `Statement type '${stmt.type}' is strictly forbidden. Only SELECT statements are permitted.`,
                    },
                ],
            };
        }

        // 5. If WITH statement, verify all CTEs and final statement are strictly SELECT
        if (stmt.type === "with") {
            const withStmt = stmt as WithStatement;

            if (withStmt.in.type !== "select") {
                typeFindings.push({
                    code: "FORBIDDEN_STATEMENT_TYPE",
                    severity: "CRITICAL",
                    nodeType: withStmt.in.type,
                    message: `Final query in WITH clause has forbidden statement type '${withStmt.in.type}'. Only SELECT statements are permitted.`,
                });
            }

            if (Array.isArray(withStmt.bind)) {
                for (const cte of withStmt.bind) {
                    if (cte.statement.type !== "select") {
                        typeFindings.push({
                            code: "FORBIDDEN_STATEMENT_TYPE",
                            severity: "CRITICAL",
                            nodeType: cte.statement.type,
                            target: cte.alias?.name,
                            message: `CTE '${cte.alias?.name || "unknown"}' contains forbidden statement type '${cte.statement.type}'. Modifying CTEs (INSERT/UPDATE/DELETE) are strictly prohibited.`,
                        });
                    }
                }
            }
        }

        // 6. Inspect for locking clauses across root query and CTEs
        const lockingFindings = this.detectLockingClauses(stmt);
        const allFindings = [...typeFindings, ...lockingFindings];

        if (allFindings.length > 0) {
            return {
                ok: false,
                rawStatements: astList,
                findings: allFindings,
            };
        }

        return {
            ok: true,
            ast: stmt as SelectStatement | WithStatement,
            rawStatements: astList,
            findings: [],
        };
    }

    /**
     * Recursively traverses an AST node to detect any locking clauses (.for property).
     */
    private detectLockingClauses(node: any): GuardrailFinding[] {
        const findings: GuardrailFinding[] = [];

        const traverse = (current: any) => {
            if (!current || typeof current !== "object") return;

            if (current.for) {
                const lockType = current.for.type ? `FOR ${String(current.for.type).toUpperCase()}` : "LOCKING CLAUSE";
                findings.push({
                    code: "LOCKING_CLAUSE",
                    severity: "CRITICAL",
                    nodeType: "for",
                    target: lockType,
                    message: `Locking clause (${lockType}) is strictly forbidden.`,
                });
            }

            for (const key of Object.keys(current)) {
                const val = current[key];
                if (Array.isArray(val)) {
                    for (const item of val) {
                        traverse(item);
                    }
                } else if (typeof val === "object") {
                    traverse(val);
                }
            }
        };

        traverse(node);
        return findings;
    }

    private extractLocationFromError(message: string): GuardrailLocation | undefined {
        const match = /line (\d+) col (\d+)/i.exec(message);
        if (match) {
            return {
                line: Number(match[1]),
                column: Number(match[2]),
            };
        }
        return undefined;
    }

    private extractCleanErrorMessage(message: string): string {
        const firstLine = message.split("\n")[0];
        return firstLine.replace(/^Error:\s*/i, "").trim();
    }
}
