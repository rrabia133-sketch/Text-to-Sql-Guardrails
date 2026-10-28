import {
    type IntentSlots,
    type SemanticFinding,
    type FilterSlot,
} from "@text2sql/contracts";

export interface ExtractedPredicate {
    column: string;
    operator: string;
    value?: unknown;
    rawText: string;
}

export interface FilterVerificationResult {
    ok: boolean;
    findings: SemanticFinding[];
    predicates: ExtractedPredicate[];
    hasStatusFilter: boolean;
    hasDateFilter: boolean;
}

export class FilterVerifier {
    /**
     * Verifies that the SQL WHERE clause satisfies required status, temporal, and intent filters.
     * @param ast The parsed AST (SelectStatement or WithStatement)
     * @param intentSlots The intent slots extracted from user question
     */
    public verify(ast: any, intentSlots: IntentSlots): FilterVerificationResult {
        const findings: SemanticFinding[] = [];

        // 1. Locate the root SELECT
        const select = this.findRootSelect(ast);
        if (!select) {
            return {
                ok: true,
                findings: [],
                predicates: [],
                hasStatusFilter: false,
                hasDateFilter: false,
            };
        }

        // 2. Extract all predicates from WHERE clause
        const predicates = this.extractPredicates(select.where);
        const hasStatusFilter = this.checkStatusFilter(predicates);
        const hasDateFilter = this.checkDateFilter(predicates);

        // 3. Rule 1: Mandatory Completed Status for Revenue Questions
        this.verifyRevenueStatusRule(intentSlots, hasStatusFilter, findings);

        // 4. Rule 2: Mandatory Date Filter for Temporal Questions
        this.verifyTemporalFilterRule(intentSlots, hasDateFilter, findings);

        // 5. Rule 3: Intent Filter Alignment (Categories, States, etc.)
        this.verifyIntentFilters(intentSlots, predicates, findings);

        return {
            ok: findings.length === 0,
            findings,
            predicates,
            hasStatusFilter,
            hasDateFilter,
        };
    }

    private findRootSelect(ast: any): any {
        if (!ast) return null;
        if (ast.type === "select") return ast;
        if (ast.type === "with" && ast.in) return ast.in;
        return null;
    }

    /**
     * Recursively traverses WHERE clause expression tree to collect binary comparison predicates.
     */
    private extractPredicates(whereNode: any): ExtractedPredicate[] {
        if (!whereNode) return [];
        const predicates: ExtractedPredicate[] = [];

        const walk = (node: any) => {
            if (!node || typeof node !== "object") return;

            // Handle binary expressions: col = 'value', col >= 'value'
            if (node.type === "binary") {
                const op = String(node.op).toUpperCase();
                const colName = this.extractColumnName(node.left) || this.extractColumnName(node.right);
                const literalVal = this.extractLiteralValue(node.right) ?? this.extractLiteralValue(node.left);

                if (colName) {
                    predicates.push({
                        column: colName.toLowerCase(),
                        operator: op,
                        value: literalVal,
                        rawText: `${colName} ${op} ${literalVal !== undefined ? String(literalVal) : ""}`.trim(),
                    });
                }
            }

            // Recurse children (handles AND, OR, parentheses)
            for (const key of Object.keys(node)) {
                if (typeof node[key] === "object") {
                    walk(node[key]);
                }
            }
        };

        walk(whereNode);
        return predicates;
    }

    private extractColumnName(node: any): string | null {
        if (!node) return null;
        if (node.type === "ref") {
            if (node.table?.name) {
                return `${node.table.name}.${node.name}`;
            }
            return String(node.name);
        }
        return null;
    }

    private extractLiteralValue(node: any): unknown {
        if (!node) return undefined;
        if (node.type === "string") return String(node.value);
        if (node.type === "integer" || node.type === "numeric") return Number(node.value);
        if (node.type === "boolean") return Boolean(node.value);
        return undefined;
    }

    /**
     * Checks if predicates contain status = 'completed'.
     */
    private checkStatusFilter(predicates: ExtractedPredicate[]): boolean {
        return predicates.some((p) => {
            const isStatusCol = p.column === "status" || p.column.endsWith(".status");
            const isCompletedVal = String(p.value).toLowerCase() === "completed";
            return isStatusCol && (p.operator === "=" || p.operator === "ILIKE" || p.operator === "LIKE") && isCompletedVal;
        });
    }

    /**
     * Checks if predicates contain a date/timestamp comparison.
     */
    private checkDateFilter(predicates: ExtractedPredicate[]): boolean {
        const dateKeywords = ["created_at", "order_date", "updated_at", "date"];
        const comparisonOps = [">=", ">", "<=", "<", "=", "BETWEEN"];

        return predicates.some((p) => {
            const isDateCol = dateKeywords.some((k) => p.column.includes(k));
            const isCompOp = comparisonOps.includes(p.operator);
            return isDateCol && isCompOp;
        });
    }

    /**
     * Rule 1: Revenue queries must restrict to completed orders per business glossary.
     */
    private verifyRevenueStatusRule(intent: IntentSlots, hasStatusFilter: boolean, findings: SemanticFinding[]): void {
        const isRevenue = intent.metric === "revenue" || intent.metric === "average_order_value" || /\b(revenue|sales|spend)\b/i.test(intent.rawQuestion);

        if (isRevenue && !hasStatusFilter) {
            findings.push({
                code: "UNHANDLED_ORDER_STATUS",
                severity: "CRITICAL",
                message: "Revenue calculations must filter completed orders (orders.status = 'completed') to prevent counting unfulfilled or canceled orders.",
                field: "orders.status",
                expected: "completed",
                actual: "none",
                repairable: true,
                suggestion: "Add `WHERE orders.status = 'completed'` to query.",
            });
        }
    }

    /**
     * Rule 2: If the question specifies a time period, the query must project a date comparison.
     */
    private verifyTemporalFilterRule(intent: IntentSlots, hasDateFilter: boolean, findings: SemanticFinding[]): void {
        const hasTemporalIntent = Boolean(intent.temporal?.startDate || intent.temporal?.endDate || intent.temporal?.rawExpression);

        if (hasTemporalIntent && !hasDateFilter) {
            findings.push({
                code: "MISSING_DATE_FILTER",
                severity: "CRITICAL",
                message: `Question specifies a time range (${intent.temporal?.rawExpression || "date period"}), but no date filter was found in the WHERE clause.`,
                field: "orders.created_at",
                expected: intent.temporal?.rawExpression || "temporal boundary",
                actual: "none",
                repairable: true,
                suggestion: "Add date comparison filters on `created_at` matching the requested period.",
            });
        }
    }

    /**
     * Rule 3: Matches explicit intent filters (e.g. state, category) against WHERE predicates.
     */
    private verifyIntentFilters(intent: IntentSlots, predicates: ExtractedPredicate[], findings: SemanticFinding[]): void {
        for (const filter of intent.filters) {
            // Skip status since Rule 1 handles it with dedicated code
            if (filter.column === "orders.status") continue;

            const filterBase = filter.column.split(".").pop()?.toLowerCase();
            const matched = predicates.some((p) => {
                const pBase = p.column.split(".").pop()?.toLowerCase();
                const colMatch = p.column === filter.column.toLowerCase() || Boolean(filterBase && pBase === filterBase);
                const valMatch = String(p.value).toLowerCase() === String(filter.value).toLowerCase();
                return Boolean(colMatch && valMatch);
            });

            if (!matched) {
                findings.push({
                    code: "UNRESOLVED_INTENT_SLOT",
                    severity: "WARNING",
                    message: `Question includes filter on ${filter.column} = '${String(filter.value)}', but predicate was not found in WHERE clause.`,
                    field: filter.column,
                    expected: String(filter.value),
                    actual: "missing",
                    repairable: true,
                    suggestion: `Add predicate: ${filter.column} = '${String(filter.value)}'.`,
                });
            }
        }
    }
}
