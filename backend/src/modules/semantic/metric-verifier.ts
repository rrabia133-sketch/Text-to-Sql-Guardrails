import {
    type IntentSlots,
    type SemanticFinding,
    type AggregationType,
} from "@text2sql/contracts";

export interface MetricVerificationResult {
    ok: boolean;
    findings: SemanticFinding[];
    detectedAggregations: AggregationType[];
    hasGroupBy: boolean;
    projectedColumns: string[];
}

export class MetricVerifier {
    /**
     * Verifies that the SQL AST projection matches the question's metric and aggregation intent.
     * @param ast The parsed AST from pgsql-ast-parser (SelectStatement or WithStatement)
     * @param intentSlots The intent slots extracted from the user question
     */
    public verify(ast: any, intentSlots: IntentSlots): MetricVerificationResult {
        const findings: SemanticFinding[] = [];

        // 1. Locate the root SELECT statement
        const select = this.findRootSelect(ast);
        if (!select) {
            return {
                ok: true,
                findings: [],
                detectedAggregations: [],
                hasGroupBy: false,
                projectedColumns: [],
            };
        }

        // 2. Inspect projections and GROUP BY
        const detectedAggregations = this.collectAggregations(select.columns);
        const projectedColumns = this.collectProjectedColumns(select.columns);
        const hasGroupBy = Boolean(select.groupBy && select.groupBy.length > 0);

        // 3. Compare detected aggregations against intentSlots.aggregation
        this.validateAggregationMatch(intentSlots, detectedAggregations, hasGroupBy, findings);

        return {
            ok: findings.length === 0,
            findings,
            detectedAggregations,
            hasGroupBy,
            projectedColumns,
        };
    }

    /**
     * Extracts the root SELECT block from either a SELECT or WITH ... SELECT statement.
     */
    private findRootSelect(ast: any): any {
        if (!ast) return null;
        if (ast.type === "select") return ast;
        if (ast.type === "with" && ast.in) return ast.in;
        return null;
    }

    /**
     * Traverses projected columns to find aggregate function calls.
     */
    private collectAggregations(columns: any[]): AggregationType[] {
        if (!Array.isArray(columns)) return [];
        const aggs = new Set<AggregationType>();

        const walk = (node: any) => {
            if (!node || typeof node !== "object") return;

            if (node.type === "call" && node.function?.name) {
                const fnName = String(node.function.name).toUpperCase();
                if (fnName === "COUNT") {
                    if (node.distinct === "distinct" || node.distinct === true) {
                        aggs.add("COUNT_DISTINCT");
                    } else {
                        aggs.add("COUNT");
                    }
                } else if (fnName === "SUM") {
                    aggs.add("SUM");
                } else if (fnName === "AVG") {
                    aggs.add("AVG");
                } else if (fnName === "MAX") {
                    aggs.add("MAX");
                } else if (fnName === "MIN") {
                    aggs.add("MIN");
                }
            }

            for (const key of Object.keys(node)) {
                if (key !== "function" && typeof node[key] === "object") {
                    walk(node[key]);
                }
            }
        };

        for (const col of columns) {
            if (col.expr) {
                walk(col.expr);
            }
        }

        return Array.from(aggs);
    }

    /**
     * Collects column names or aliases projected by the query.
     */
    private collectProjectedColumns(columns: any[]): string[] {
        if (!Array.isArray(columns)) return [];
        const cols: string[] = [];

        for (const col of columns) {
            if (col.alias?.name) {
                cols.push(col.alias.name);
            } else if (col.expr?.type === "ref" && col.expr.name) {
                cols.push(col.expr.name);
            }
        }

        return cols;
    }

    /**
     * Compares intent expectations against detected SQL aggregations.
     */
    private validateAggregationMatch(
        intent: IntentSlots,
        detectedAggs: AggregationType[],
        hasGroupBy: boolean,
        findings: SemanticFinding[]
    ): void {
        const expected = intent.aggregation;

        // Rule 1: Question requested AVG, but SQL used SUM or has no AVG
        if (expected === "AVG") {
            if (detectedAggs.includes("SUM") && !detectedAggs.includes("AVG")) {
                findings.push({
                    code: "WRONG_AGGREGATION",
                    severity: "CRITICAL",
                    message: `Question requested average (${intent.metric || "value"}), but query computed SUM instead of AVG.`,
                    field: "aggregation",
                    expected: "AVG",
                    actual: "SUM",
                    repairable: true,
                    suggestion: "Replace SUM(...) with AVG(...) in projected expression.",
                });
                return;
            }
            if (!detectedAggs.includes("AVG")) {
                findings.push({
                    code: "WRONG_AGGREGATION",
                    severity: "CRITICAL",
                    message: `Question requested average (${intent.metric || "value"}), but no AVG aggregation was found.`,
                    field: "aggregation",
                    expected: "AVG",
                    actual: detectedAggs.join(", ") || "NONE",
                    repairable: true,
                    suggestion: "Add AVG(...) aggregate function.",
                });
                return;
            }
        }

        // Rule 2: Question requested SUM, but SQL used AVG or has no SUM
        if (expected === "SUM") {
            if (detectedAggs.includes("AVG") && !detectedAggs.includes("SUM")) {
                findings.push({
                    code: "WRONG_AGGREGATION",
                    severity: "CRITICAL",
                    message: `Question requested total (${intent.metric || "value"}), but query computed AVG instead of SUM.`,
                    field: "aggregation",
                    expected: "SUM",
                    actual: "AVG",
                    repairable: true,
                    suggestion: "Replace AVG(...) with SUM(...) in projected expression.",
                });
                return;
            }
            if (detectedAggs.length === 0) {
                findings.push({
                    code: "WRONG_AGGREGATION",
                    severity: "CRITICAL",
                    message: `Question requested total (${intent.metric || "value"}), but query projected unaggregated values.`,
                    field: "aggregation",
                    expected: "SUM",
                    actual: "NONE",
                    repairable: true,
                    suggestion: "Wrap expression in SUM(...).",
                });
                return;
            }
        }

        // Rule 3: Question requested COUNT_DISTINCT (unique/distinct), but SQL used plain COUNT
        if (expected === "COUNT_DISTINCT" && detectedAggs.includes("COUNT") && !detectedAggs.includes("COUNT_DISTINCT")) {
            findings.push({
                code: "WRONG_AGGREGATION",
                severity: "WARNING",
                message: "Question requested unique/distinct counts, but query used plain COUNT() without DISTINCT.",
                field: "aggregation",
                expected: "COUNT_DISTINCT",
                actual: "COUNT",
                repairable: true,
                suggestion: "Use COUNT(DISTINCT ...) to prevent counting duplicate rows.",
            });
            return;
        }

        // Rule 4: Grouped query with dimensions, but zero aggregation function
        if (hasGroupBy && detectedAggs.length === 0 && intent.aggregation !== "NONE") {
            findings.push({
                code: "WRONG_AGGREGATION",
                severity: "CRITICAL",
                message: "Query specifies GROUP BY clause but contains no aggregate function in projection.",
                field: "aggregation",
                expected: expected !== "NONE" ? expected : "AGGREGATE_FUNCTION",
                actual: "NONE",
                repairable: true,
                suggestion: "Add an aggregate function (e.g. SUM, COUNT, AVG) to projected columns.",
            });
            return;
        }

        // Rule 5: Aggregation Inversion (MAX vs MIN)
        if (expected === "MAX" && detectedAggs.includes("MIN") && !detectedAggs.includes("MAX")) {
            findings.push({
                code: "WRONG_AGGREGATION",
                severity: "CRITICAL",
                message: "Question requested maximum / peak value, but query used MIN().",
                field: "aggregation",
                expected: "MAX",
                actual: "MIN",
                repairable: true,
                suggestion: "Replace MIN() with MAX().",
            });
            return;
        }

        if (expected === "MIN" && detectedAggs.includes("MAX") && !detectedAggs.includes("MIN")) {
            findings.push({
                code: "WRONG_AGGREGATION",
                severity: "CRITICAL",
                message: "Question requested minimum / lowest value, but query used MAX().",
                field: "aggregation",
                expected: "MIN",
                actual: "MAX",
                repairable: true,
                suggestion: "Replace MAX() with MIN().",
            });
        }
    }
}
