import {
    type IntentSlots,
    type SemanticFinding,
} from "@text2sql/contracts";

export interface Relationship {
    parentTable: string;
    parentKey: string;
    childTable: string;
    childKey: string;
    cardinality: "1:N";
}

export const CANONICAL_RELATIONSHIPS: Relationship[] = [
    { parentTable: "customers", parentKey: "id", childTable: "orders", childKey: "customer_id", cardinality: "1:N" },
    { parentTable: "orders", parentKey: "id", childTable: "order_items", childKey: "order_id", cardinality: "1:N" },
    { parentTable: "products", parentKey: "id", childTable: "order_items", childKey: "product_id", cardinality: "1:N" },
];

export interface CardinalityVerificationResult {
    ok: boolean;
    findings: SemanticFinding[];
    joinedTables: string[];
    detectedFanoutRisks: string[];
}

export class CardinalityVerifier {
    /**
     * Verifies query joins against schema cardinality rules to trap fanout duplications and Cartesian products.
     */
    public verify(ast: any, intent: IntentSlots): CardinalityVerificationResult {
        const findings: SemanticFinding[] = [];
        const detectedFanoutRisks: string[] = [];

        const select = this.findRootSelect(ast);
        if (!select || !select.from) {
            return {
                ok: true,
                findings: [],
                joinedTables: [],
                detectedFanoutRisks: [],
            };
        }

        // 1. Extract all referenced tables, aliases, and explicit joins
        const { tables, joins, tableAliasMap } = this.extractTablesAndJoins(select.from);

        // 2. Rule 1: Check for Cartesian product / Missing join ON conditions
        this.verifyCartesianJoins(joins, findings);

        // 3. Rule 2: Check for 1:N Fanout Duplication
        this.verifyFanoutDuplication(select, tables, joins, tableAliasMap, intent, findings, detectedFanoutRisks);

        return {
            ok: findings.length === 0,
            findings,
            joinedTables: tables,
            detectedFanoutRisks,
        };
    }

    private findRootSelect(ast: any): any {
        if (!ast) return null;
        if (ast.type === "select") return ast;
        if (ast.type === "with" && ast.in) return ast.in;
        return null;
    }

    private extractTablesAndJoins(fromNodes: any[]): {
        tables: string[];
        joins: any[];
        tableAliasMap: Map<string, string>; // alias -> real table name
    } {
        const tables: string[] = [];
        const joins: any[] = [];
        const tableAliasMap = new Map<string, string>();

        for (const fromItem of fromNodes) {
            if (fromItem.type === "table" && fromItem.name) {
                const tableName = String(fromItem.name.name).toLowerCase();
                tables.push(tableName);
                tableAliasMap.set(tableName, tableName);

                if (fromItem.name.alias) {
                    tableAliasMap.set(String(fromItem.name.alias).toLowerCase(), tableName);
                }

                if (fromItem.join) {
                    if (Array.isArray(fromItem.join)) {
                        joins.push(...fromItem.join);
                    } else {
                        joins.push(fromItem.join);
                    }
                }
            }
        }

        return { tables, joins, tableAliasMap };
    }

    /**
     * Rule 1: Flags Cartesian joins (CROSS JOIN or joins missing ON / USING clauses).
     */
    private verifyCartesianJoins(joins: any[], findings: SemanticFinding[]): void {
        for (const j of joins) {
            const joinType = String(j.type || "").toUpperCase();
            const hasCondition = Boolean(j.on || j.using);

            if (joinType.includes("CROSS") || (!hasCondition && !joinType.includes("NATURAL"))) {
                findings.push({
                    code: "JOIN_FANOUT_DUPLICATION",
                    severity: "CRITICAL",
                    message: "Join lacks an explicit ON condition or uses CROSS JOIN, causing Cartesian product row multiplication.",
                    repairable: true,
                    suggestion: "Add an explicit ON clause joining foreign keys (e.g., `ON orders.id = order_items.order_id`).",
                });
            }
        }
    }

    /**
     * Rule 2: Traps 1:N fanout where child table multiplication corrupts parent table aggregates.
     */
    private verifyFanoutDuplication(
        select: any,
        tables: string[],
        joins: any[],
        tableAliasMap: Map<string, string>,
        intent: IntentSlots,
        findings: SemanticFinding[],
        detectedFanoutRisks: string[]
    ): void {
        // Check if any canonical 1:N relationship is active in the joins
        for (const rel of CANONICAL_RELATIONSHIPS) {
            const hasParent = tables.includes(rel.parentTable);
            const hasChild = tables.includes(rel.childTable);

            if (hasParent && hasChild) {
                // Fanout relationship is present (e.g. orders joined to order_items)
                // Now inspect if parent table is being aggregated without DISTINCT
                this.inspectParentAggregations(select, rel, tableAliasMap, findings, detectedFanoutRisks);
            }
        }

        // Special case: Intent asks to count orders, but order_items child table is joined with non-distinct count
        if (
            intent.metric === "order_count" &&
            tables.includes("orders") &&
            tables.includes("order_items") &&
            !select.columns?.some((c: any) => c.expr?.distinct)
        ) {
            const hasCriticalDuplication = findings.some((f) => f.code === "JOIN_FANOUT_DUPLICATION");
            if (!hasCriticalDuplication) {
                findings.push({
                    code: "JOIN_FANOUT_DUPLICATION",
                    severity: "WARNING",
                    message: "Question asks for order count, but joining 'order_items' may inflate count without COUNT(DISTINCT).",
                    field: "orders.id",
                    expected: "COUNT(DISTINCT orders.id)",
                    actual: "COUNT(*)",
                    repairable: true,
                    suggestion: "Use `COUNT(DISTINCT orders.id)` to count unique orders accurately.",
                });
            }
        }
    }

    private inspectParentAggregations(
        select: any,
        rel: Relationship,
        tableAliasMap: Map<string, string>,
        findings: SemanticFinding[],
        detectedFanoutRisks: string[]
    ): void {
        if (!Array.isArray(select.columns)) return;

        for (const col of select.columns) {
            const expr = col.expr;
            if (!expr || expr.type !== "call") continue;

            const fnName = String(expr.function?.name || "").toUpperCase();
            const isDistinct = Boolean(expr.distinct);

            // Traverse arguments to check if columns originate from parent table
            for (const arg of expr.args || []) {
                const targetTable = this.resolveColumnTable(arg, tableAliasMap);
                const colName = this.resolveColumnName(arg);

                if (targetTable === rel.parentTable && !isDistinct) {
                    // DANGER: Parent table column is being aggregated across child rows without DISTINCT!
                    // e.g., COUNT(orders.id) when joined to order_items
                    // e.g., SUM(orders.total_amount) when joined to order_items
                    const risk = `${fnName}(${rel.parentTable}.${colName}) over ${rel.childTable}`;
                    detectedFanoutRisks.push(risk);

                    findings.push({
                        code: "JOIN_FANOUT_DUPLICATION",
                        severity: "CRITICAL",
                        message: `Aggregating parent table '${rel.parentTable}.${colName}' with '${fnName}' without DISTINCT when joined to '${rel.childTable}' multiplies values by child rows.`,
                        field: `${rel.parentTable}.${colName}`,
                        expected: fnName === "COUNT" ? `COUNT(DISTINCT ${colName})` : "Aggregate on child table or pre-aggregate parent",
                        actual: `${fnName}(${colName})`,
                        repairable: true,
                        suggestion: fnName === "COUNT"
                            ? `Use COUNT(DISTINCT ${rel.parentTable}.${colName}) to avoid counting duplicate rows.`
                            : `Aggregate '${colName}' before joining '${rel.childTable}', or sum child line totals directly.`,
                    });
                }
            }
        }
    }

    private resolveColumnTable(node: any, tableAliasMap: Map<string, string>): string | null {
        if (!node) return null;
        if (node.type === "ref") {
            if (node.table?.name) {
                const prefix = String(node.table.name).toLowerCase();
                return tableAliasMap.get(prefix) || prefix;
            }
        }
        return null;
    }

    private resolveColumnName(node: any): string {
        if (!node) return "*";
        if (node.type === "ref") {
            return String(node.name).toLowerCase();
        }
        return "*";
    }
}
