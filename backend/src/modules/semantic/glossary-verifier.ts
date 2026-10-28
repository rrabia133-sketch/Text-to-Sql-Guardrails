import {
    type IntentSlots,
    type SemanticFinding,
    BUSINESS_GLOSSARY,
    GLOSSARY_VERSION,
} from "@text2sql/contracts";

export interface GlossaryVerificationResult {
    ok: boolean;
    findings: SemanticFinding[];
    matchedMetricId?: string;
    glossaryVersion: string;
}

export class GlossaryVerifier {
    private readonly glossary = BUSINESS_GLOSSARY;
    private readonly version = GLOSSARY_VERSION;

    /**
     * Verifies that the AST aligns with approved corporate metric definitions in the Business Glossary.
     */
    public verify(ast: any, intent: IntentSlots): GlossaryVerificationResult {
        const findings: SemanticFinding[] = [];
        const metricId = this.identifyMetric(intent);

        if (!metricId || !this.glossary[metricId]) {
            return {
                ok: true,
                findings: [],
                glossaryVersion: this.version,
            };
        }

        const select = this.findRootSelect(ast);
        if (!select) {
            return {
                ok: true,
                findings: [],
                matchedMetricId: metricId,
                glossaryVersion: this.version,
            };
        }

        // Rule-specific glossary verifications
        switch (metricId) {
            case "revenue":
                this.verifyRevenueGlossaryFormula(select, findings);
                break;
            case "average_order_value":
                this.verifyAovGlossaryFormula(select, findings);
                break;
            case "active_customer":
                this.verifyActiveCustomerGlossaryFormula(select, findings);
                break;
        }

        return {
            ok: findings.length === 0,
            findings,
            matchedMetricId: metricId,
            glossaryVersion: this.version,
        };
    }

    private findRootSelect(ast: any): any {
        if (!ast) return null;
        if (ast.type === "select") return ast;
        if (ast.type === "with" && ast.in) return ast.in;
        return null;
    }

    private identifyMetric(intent: IntentSlots): string | null {
        if (intent.metric && this.glossary[intent.metric]) {
            return intent.metric;
        }

        const q = intent.rawQuestion.toLowerCase();
        if (/\b(average order value|aov)\b/.test(q)) return "average_order_value";
        if (/\b(active customer|active users)\b/.test(q)) return "active_customer";
        if (/\b(revenue|gross revenue|sales volume)\b/.test(q)) return "revenue";
        if (/\b(completed order|orders delivered)\b/.test(q)) return "completed_order";

        return null;
    }

    /**
     * Glossary Rule: Revenue calculation over line items must multiply quantity * unit_price.
     */
    private verifyRevenueGlossaryFormula(select: any, findings: SemanticFinding[]): void {
        const hasOrderItems = this.hasTableReference(select, "order_items");
        if (!hasOrderItems) return;

        // When order_items is involved, check if quantity * unit_price is being multiplied
        const projections = select.columns || [];
        let hasQuantityTimesPrice = false;
        let usesBareUnitPrice = false;

        for (const col of projections) {
            const expr = col.expr;
            if (!expr || expr.type !== "call") continue;

            const fnName = String(expr.function?.name || "").toUpperCase();
            if (fnName === "SUM") {
                const arg = expr.args?.[0];
                if (arg && arg.type === "binary" && arg.op === "*") {
                    hasQuantityTimesPrice = true;
                } else if (arg && arg.type === "ref" && String(arg.name).toLowerCase() === "unit_price") {
                    usesBareUnitPrice = true;
                }
            }
        }

        if (usesBareUnitPrice && !hasQuantityTimesPrice) {
            findings.push({
                code: "GLOSSARY_FORMULA_MISMATCH",
                severity: "CRITICAL",
                message: "Corporate business glossary defines revenue as SUM(quantity * unit_price). Summing unit_price without multiplying quantity omits item quantities.",
                field: "order_items.quantity",
                expected: "SUM(order_items.quantity * order_items.unit_price)",
                actual: "SUM(order_items.unit_price)",
                repairable: true,
                suggestion: "Use `SUM(order_items.quantity * order_items.unit_price)`.",
            });
        }
    }

    /**
     * Glossary Rule: AOV requires dividing revenue by distinct orders.
     */
    private verifyAovGlossaryFormula(select: any, findings: SemanticFinding[]): void {
        const projections = select.columns || [];
        let hasDivisionOrAvg = false;

        for (const col of projections) {
            const expr = col.expr;
            if (!expr) continue;

            if (expr.type === "binary" && expr.op === "/") {
                hasDivisionOrAvg = true;
            } else if (expr.type === "call") {
                const fnName = String(expr.function?.name || "").toUpperCase();
                if (fnName === "AVG" || fnName === "ROUND") {
                    hasDivisionOrAvg = true;
                }
            }
        }

        if (!hasDivisionOrAvg) {
            findings.push({
                code: "GLOSSARY_FORMULA_MISMATCH",
                severity: "CRITICAL",
                message: "Average Order Value (AOV) requires dividing total revenue by order count (e.g. SUM(...) / COUNT(DISTINCT o.id)).",
                field: "aov",
                expected: "SUM(...) / NULLIF(COUNT(DISTINCT orders.id), 0)",
                actual: "missing ratio division",
                repairable: true,
                suggestion: "Calculate AOV as `ROUND(SUM(oi.quantity * oi.unit_price)::numeric / NULLIF(COUNT(DISTINCT o.id), 0), 2)`.",
            });
        }
    }

    /**
     * Glossary Rule: Active customer requires counting distinct customers who have completed orders.
     */
    private verifyActiveCustomerGlossaryFormula(select: any, findings: SemanticFinding[]): void {
        const hasOrders = this.hasTableReference(select, "orders");
        const hasCustomers = this.hasTableReference(select, "customers");

        if (!hasOrders || !hasCustomers) {
            findings.push({
                code: "GLOSSARY_FORMULA_MISMATCH",
                severity: "CRITICAL",
                message: "Active customer definition requires joining 'customers' with 'orders' to verify completed order activity.",
                field: "customers.id",
                expected: "JOIN orders ON customers.id = orders.customer_id",
                actual: "missing customer-order join",
                repairable: true,
                suggestion: "Join `customers c JOIN orders o ON c.id = o.customer_id` with `o.status = 'completed'`.",
            });
        }
    }

    private hasTableReference(select: any, tableName: string): boolean {
        const target = tableName.toLowerCase();
        if (!Array.isArray(select.from)) return false;

        for (const item of select.from) {
            if (item.type === "table" && item.name) {
                if (String(item.name.name).toLowerCase() === target) return true;
                if (item.join) {
                    const joins = Array.isArray(item.join) ? item.join : [item.join];
                    for (const j of joins) {
                        if (j.type?.table?.name && String(j.type.table.name).toLowerCase() === target) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }
}
