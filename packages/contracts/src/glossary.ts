import { z } from "zod";

export const GLOSSARY_VERSION = "1.0.0";

export const MetricDefinitionSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    sqlFormula: z.string(),
    requiredJoins: z.array(z.string()),
    filterPredicates: z.array(z.string()),
    caveats: z.array(z.string()).optional(),
});

export type MetricDefinition = z.infer<typeof MetricDefinitionSchema>;

export const BUSINESS_GLOSSARY: Record<string, MetricDefinition> = {
    revenue: {
        id: "revenue",
        name: "Total Recognized Revenue",
        description: "Total gross monetary value recognized from finalized customer orders.",
        sqlFormula: "SUM(oi.quantity * oi.unit_price)",
        requiredJoins: [
            "orders o JOIN order_items oi ON o.id = oi.order_id",
        ],
        filterPredicates: [
            "o.status IN ('completed', 'shipped')",
        ],
        caveats: [
            "Excludes 'cancelled' and 'pending' orders.",
            "Taxes and shipping fees are not modeled in current schema.",
        ],
    },
    completed_order: {
        id: "completed_order",
        name: "Completed / Finalized Order",
        description: "Orders that have reached a settled, fulfilled, or shipped operational status.",
        sqlFormula: "COUNT(DISTINCT o.id)",
        requiredJoins: [
            "orders o",
        ],
        filterPredicates: [
            "o.status IN ('completed', 'shipped')",
        ],
        caveats: [
            "Unsettled ('pending') and voided ('cancelled') orders are strictly excluded.",
        ],
    },
    active_customer: {
        id: "active_customer",
        name: "Active Customer",
        description: "Customer who has placed at least one completed/shipped order within the specified temporal window (default: trailing 90 days).",
        sqlFormula: "COUNT(DISTINCT c.id)",
        requiredJoins: [
            "customers c JOIN orders o ON c.id = o.customer_id",
        ],
        filterPredicates: [
            "o.status IN ('completed', 'shipped')",
            "o.ordered_at >= [START_DATE] AND o.ordered_at < [END_DATE]",
        ],
        caveats: [
            "If no time window is provided, requires clarification or default 90-day window.",
        ],
    },
    average_order_value: {
        id: "average_order_value",
        name: "Average Order Value (AOV)",
        description: "Average gross revenue generated per completed or shipped order.",
        sqlFormula: "ROUND(SUM(oi.quantity * oi.unit_price)::numeric / NULLIF(COUNT(DISTINCT o.id), 0), 2)",
        requiredJoins: [
            "orders o JOIN order_items oi ON o.id = oi.order_id",
        ],
        filterPredicates: [
            "o.status IN ('completed', 'shipped')",
        ],
        caveats: [
            "Must guard against division by zero using NULLIF(COUNT(DISTINCT o.id), 0).",
        ],
    },
};

/**
 * Formats the business glossary into markdown for system prompt injection.
 */
export function formatGlossaryForPrompt(glossary: Record<string, MetricDefinition> = BUSINESS_GLOSSARY): string {
    const lines: string[] = [
        `### Standard Business Glossary & Metric Definitions (Version: ${GLOSSARY_VERSION})`,
        "You MUST adhere strictly to these metric formulas, join paths, and status filters:",
        "",
    ];

    for (const metric of Object.values(glossary)) {
        lines.push(`#### ${metric.name} (\`${metric.id}\`)`);
        lines.push(`- **Definition:** ${metric.description}`);
        lines.push(`- **SQL Formula:** \`${metric.sqlFormula}\``);
        lines.push(`- **Required Joins:** ${metric.requiredJoins.join(", ") || "None"}`);
        lines.push(`- **Filter Predicates:** ${metric.filterPredicates.join(" AND ")}`);
        if (metric.caveats && metric.caveats.length > 0) {
            lines.push(`- **Rules & Caveats:** ${metric.caveats.join(" ")}`);
        }
        lines.push("");
    }

    return lines.join("\n");
}
