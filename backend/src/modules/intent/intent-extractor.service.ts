import {
    type IntentSlots,
    type AggregationType,
    type FilterSlot,
    type TemporalSlot,
    type SortSlot,
    IntentSlotsSchema,
} from "@text2sql/contracts";
import { DateResolver } from "./date-resolver.js";

export class IntentExtractorService {
    private dateResolver: DateResolver;

    constructor(dateResolver?: DateResolver) {
        this.dateResolver = dateResolver ?? new DateResolver();
    }

    /**
     * Extracts structured analytical intent slots from a natural language question.
     * @param question The user's query prompt
     * @param anchorDate Optional reference anchor date for deterministic temporal testing
     */
    public extract(question: string, anchorDate?: Date): IntentSlots {
        const normalized = question.trim();
        const lower = normalized.toLowerCase();

        const metric = this.extractMetric(lower);
        const aggregation = this.extractAggregation(lower, metric);
        const dimensions = this.extractDimensions(lower);
        const filters = this.extractFilters(lower);
        const temporal = this.extractTemporal(normalized, anchorDate);
        const sort = this.extractSort(lower);
        const rowLimit = this.extractRowLimit(lower);

        return IntentSlotsSchema.parse({
            rawQuestion: normalized,
            metric,
            aggregation,
            dimensions,
            filters,
            temporal,
            sort,
            rowLimit,
        });
    }

    /**
     * 1. Extracts the target business metric from question keywords.
     */
    private extractMetric(lower: string): string | undefined {
        if (/\b(revenue|sales|turnover|spending|spent|total spend)\b/.test(lower)) {
            return "revenue";
        }
        if (/\b(average order value|avg order value|aov|average spend|average order)\b/.test(lower)) {
            return "average_order_value";
        }
        if (/\b(order count|orders count|number of orders|how many orders|total orders)\b/.test(lower)) {
            return "order_count";
        }
        if (/\b(customer count|number of customers|how many customers|total customers)\b/.test(lower)) {
            return "customer_count";
        }
        if (/\b(quantity|units sold|volume|items sold)\b/.test(lower)) {
            return "quantity";
        }
        if (/\b(price|unit price)\b/.test(lower)) {
            return "price";
        }
        return undefined;
    }

    /**
     * 2. Infers the aggregation function based on question phrasing and extracted metric.
     */
    private extractAggregation(lower: string, metric?: string): AggregationType {
        // Average
        if (/\b(average|avg|mean)\b/.test(lower) || metric === "average_order_value") {
            return "AVG";
        }
        // Count Distinct
        if (/\b(unique customers?|distinct customers?|unique orders?|distinct orders?)\b/.test(lower)) {
            return "COUNT_DISTINCT";
        }
        // Count
        if (/\b(count|number of|how many)\b/.test(lower) || metric === "order_count" || metric === "customer_count") {
            return "COUNT";
        }
        // Sum / Total
        if (/\b(total|sum)\b/.test(lower) || metric === "revenue" || metric === "quantity") {
            return "SUM";
        }
        // Max
        if (/\b(max|maximum|highest|most expensive|peak|top spend)\b/.test(lower)) {
            return "MAX";
        }
        // Min
        if (/\b(min|minimum|lowest|cheapest|least)\b/.test(lower)) {
            return "MIN";
        }

        return "NONE";
    }

    /**
     * 3. Extracts dimensions / grouping columns ("by status", "per customer", etc.)
     */
    private extractDimensions(lower: string): string[] {
        const dimensions: string[] = [];

        if (/\b(by|per|for each|grouped by)\s+(order\s+)?status\b/.test(lower)) {
            dimensions.push("orders.status");
        }
        if (/\b(by|per|for each|grouped by)\s+customers?\b/.test(lower) || /\btop\s+\d*\s*customers?\b/.test(lower)) {
            dimensions.push("customers.id");
        }
        if (/\b(by|per|for each|grouped by)\s+products?\b/.test(lower) || /\btop\s+\d*\s*products?\b/.test(lower)) {
            dimensions.push("products.id");
        }
        if (/\b(by|per|for each|grouped by)\s+(product\s+)?categor(y|ies)\b/.test(lower)) {
            dimensions.push("products.category");
        }
        if (/\b(by|per|for each|grouped by)\s+(customer\s+)?state\b/.test(lower)) {
            dimensions.push("customers.state");
        }
        if (/\b(monthly|by month|per month)\b/.test(lower)) {
            dimensions.push("month");
        }
        if (/\b(daily|by day|per day)\b/.test(lower)) {
            dimensions.push("day");
        }

        return dimensions;
    }

    /**
     * 4. Extracts filter predicates and status constraints.
     */
    private extractFilters(lower: string): FilterSlot[] {
        const filters: FilterSlot[] = [];

        // Order status filters
        if (/\b(completed|delivered|finished)\b/.test(lower)) {
            filters.push({
                column: "orders.status",
                operator: "=",
                value: "completed",
                rawExpression: "status completed",
            });
        } else if (/\bpending\b/.test(lower)) {
            filters.push({
                column: "orders.status",
                operator: "=",
                value: "pending",
                rawExpression: "status pending",
            });
        } else if (/\bcancelled\b/.test(lower)) {
            filters.push({
                column: "orders.status",
                operator: "=",
                value: "cancelled",
                rawExpression: "status cancelled",
            });
        }

        // Product category filters
        const categoryMatch = lower.match(/\b(electronics|clothing|apparel|books|home|furniture|toys)\b/);
        if (categoryMatch && !/\b(by|per)\s+categor/.test(lower)) {
            filters.push({
                column: "products.category",
                operator: "=",
                value: categoryMatch[1],
                rawExpression: `category ${categoryMatch[1]}`,
            });
        }

        // Customer state filters (e.g. "in CA" or "in California")
        const stateMatch = lower.match(/\bin\s+(california|ca|new york|ny|texas|tx|florida|fl)\b/);
        if (stateMatch) {
            const raw = stateMatch[1].toUpperCase();
            const state = raw === "CALIFORNIA" ? "CA" : raw === "NEW YORK" ? "NY" : raw === "TEXAS" ? "TX" : raw === "FLORIDA" ? "FL" : raw;
            filters.push({
                column: "customers.state",
                operator: "=",
                value: state,
                rawExpression: `state ${state}`,
            });
        }

        return filters;
    }

    /**
     * 5. Resolves temporal boundaries and time grain using DateResolver.
     */
    private extractTemporal(question: string, anchorDate?: Date): TemporalSlot | undefined {
        const result = this.dateResolver.resolve(question, anchorDate);
        if (!result.hasRelativeDate || result.resolvedRanges.length === 0) {
            return undefined;
        }

        const range = result.resolvedRanges[0];
        const lower = question.toLowerCase();

        let grain: TemporalSlot["grain"] = undefined;
        if (/\b(month|monthly)\b/.test(lower)) {
            grain = "month";
        } else if (/\b(quarter|quarterly|q[1-4])\b/.test(lower)) {
            grain = "quarter";
        } else if (/\b(year|yearly|annual|annually)\b/.test(lower)) {
            grain = "year";
        } else if (/\b(week|weekly)\b/.test(lower)) {
            grain = "week";
        } else if (/\b(day|daily|today|yesterday)\b/.test(lower)) {
            grain = "day";
        }

        return {
            startDate: range.startDate,
            endDate: range.endDate,
            timezone: range.timezone,
            grain,
            rawExpression: range.expression,
        };
    }

    /**
     * 6. Extracts sort direction (top/highest -> DESC, bottom/lowest -> ASC).
     */
    private extractSort(lower: string): SortSlot | undefined {
        const descMatch = /\b(top|highest|most|best|greatest|peak)\b/.test(lower);
        const ascMatch = /\b(bottom|lowest|least|cheapest|worst)\b/.test(lower);

        if (descMatch) {
            return {
                column: "revenue",
                direction: "DESC",
            };
        }
        if (ascMatch) {
            return {
                column: "revenue",
                direction: "ASC",
            };
        }
        return undefined;
    }

    /** * 7. Extracts explicit row limit / Top-N / Bottom-N numbers ("top 5", "bottom 10", "limit 10"). */
    private extractRowLimit(lower: string): number | undefined {
        const match = lower.match(/\b(?:top|first|limit|bottom|lowest|highest)\s+(\d+)\b/);
        if (match) {
            const limit = Number.parseInt(match[1], 10);
            return Number.isNaN(limit) || limit <= 0 ? undefined : limit;
        }
        return undefined;
    }

}
