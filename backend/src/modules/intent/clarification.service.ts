import { randomUUID } from "node:crypto";
import type { ClarificationResponse, ClarificationOption } from "@text2sql/contracts";

interface StoredClarificationSession {
    sessionId: string;
    originalQuestion: string;
    reasonCode: ClarificationResponse["reasonCode"];
    options: ClarificationOption[];
    createdAt: number;
}

export class ClarificationService {
    private sessions: Map<string, StoredClarificationSession> = new Map();

    /**
     * Inspects question for out-of-domain requests, ambiguous metrics, or missing timebounds.
     * Returns ClarificationResponse if ambiguous, or null if query is sufficiently grounded.
     */
    evaluateQuestion(question: string): ClarificationResponse | null {
        const lower = question.toLowerCase().trim();

        // 1. Out-of-Domain Detection
        const unsupportedKeywords = [
            "employee",
            "salary",
            "salaries",
            "payroll",
            "warehouse",
            "inventory",
            "stock level",
            "support ticket",
            "server log",
            "hr department",
            "hire date",
        ];

        for (const kw of unsupportedKeywords) {
            if (lower.includes(kw)) {
                const sessionId = randomUUID();
                const refusalResponse: ClarificationResponse = {
                    type: "clarification",
                    question,
                    reasonCode: "UNSUPPORTED_DOMAIN",
                    clarificationSessionId: sessionId,
                    message: `The analytical schema only contains data for Customers, Products, Orders, and Order Items. Questions regarding "${kw}" are not supported.`,
                    options: [
                        {
                            id: "refusal_orders",
                            label: "Analyze Customer Orders Instead",
                            description: "Explore completed orders, revenue, or customer purchases.",
                        },
                        {
                            id: "refusal_products",
                            label: "Analyze Product Catalog Instead",
                            description: "Explore product categories, prices, or sales volume.",
                        },
                    ],
                };
                this.sessions.set(sessionId, {
                    sessionId,
                    originalQuestion: question,
                    reasonCode: "UNSUPPORTED_DOMAIN",
                    options: refusalResponse.options,
                    createdAt: Date.now(),
                });
                return refusalResponse;
            }
        }

        // 2. Ambiguous Superlative Metrics (e.g. "best customers" without defining revenue vs frequency)
        const ambiguousCustomerSuperlatives = [
            "best customer",
            "best customers",
            "top customer",
            "top customers",
            "valuable customer",
            "most valuable customer",
            "most active customer",
        ];

        const hasMetric = lower.includes("revenue") || lower.includes("spend") || lower.includes("order count") || lower.includes("orders");
        if (!hasMetric && ambiguousCustomerSuperlatives.some((term) => lower.includes(term))) {
            const sessionId = randomUUID();
            const response: ClarificationResponse = {
                type: "clarification",
                question,
                reasonCode: "AMBIGUOUS_METRIC",
                clarificationSessionId: sessionId,
                message: "How would you like to define 'best customers'?",
                options: [
                    {
                        id: "metric_revenue",
                        label: "Total Recognized Revenue (Gross Spend)",
                        description: "Rank customers by total SUM(quantity * unit_price) of completed/shipped orders.",
                        suggestedFilter: "revenue",
                    },
                    {
                        id: "metric_order_count",
                        label: "Order Frequency (Number of Orders)",
                        description: "Rank customers by total COUNT of distinct finalized orders.",
                        suggestedFilter: "completed_order",
                    },
                    {
                        id: "metric_aov",
                        label: "Average Order Value (AOV)",
                        description: "Rank customers by highest revenue generated per completed order.",
                        suggestedFilter: "average_order_value",
                    },
                ],
            };
            this.sessions.set(sessionId, {
                sessionId,
                originalQuestion: question,
                reasonCode: "AMBIGUOUS_METRIC",
                options: response.options,
                createdAt: Date.now(),
            });
            return response;
        }

        // 3. Missing Time Bounds on Aggregated Rankings (e.g. "top products" without timeframe)
        const rankingTerms = ["top product", "top products", "best selling product", "best selling products", "sales ranking", "popular product"];
        const hasTimeFrame = [
            "today",
            "yesterday",
            "last week",
            "last month",
            "last quarter",
            "this year",
            "last year",
            "2025",
            "2026",
            "all-time",
            "all time",
            "ytd",
            "30 days",
        ].some((tf) => lower.includes(tf));

        if (!hasTimeFrame && rankingTerms.some((term) => lower.includes(term))) {
            const sessionId = randomUUID();
            const response: ClarificationResponse = {
                type: "clarification",
                question,
                reasonCode: "MISSING_TIME_BOUND",
                clarificationSessionId: sessionId,
                message: "Which time window should be used for product ranking?",
                options: [
                    {
                        id: "time_last_month",
                        label: "Last Month",
                        description: "Full previous calendar month.",
                    },
                    {
                        id: "time_this_year",
                        label: "This Year (2026)",
                        description: "Calendar year from 2026-01-01 to date.",
                    },
                    {
                        id: "time_all_time",
                        label: "All-Time Historical",
                        description: "All recorded orders across full database history.",
                    },
                ],
            };
            this.sessions.set(sessionId, {
                sessionId,
                originalQuestion: question,
                reasonCode: "MISSING_TIME_BOUND",
                options: response.options,
                createdAt: Date.now(),
            });
            return response;
        }

        return null;
    }

    /**
     * Resumes an ambiguous query by merging the original question with user selection.
     */
    resumeClarification(
        sessionId: string,
        selectedOptionId: string
    ): { clarifiedPrompt: string; clarificationContext: string } {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return {
                clarifiedPrompt: selectedOptionId,
                clarificationContext: `Selected Option: ${selectedOptionId}`,
            };
        }

        const option = session.options.find((o) => o.id === selectedOptionId);
        const optionLabel = option ? option.label : selectedOptionId;

        let clarifiedPrompt = session.originalQuestion;
        let clarificationContext = `User clarified: ${optionLabel}.`;

        if (session.reasonCode === "AMBIGUOUS_METRIC") {
            clarifiedPrompt = `${session.originalQuestion} (Ranked by ${optionLabel})`;
            clarificationContext = `The user selected metric: "${optionLabel}". Apply the corresponding business formula and joins.`;
        } else if (session.reasonCode === "MISSING_TIME_BOUND") {
            clarifiedPrompt = `${session.originalQuestion} for ${optionLabel}`;
            clarificationContext = `The user specified time window: "${optionLabel}". Resolve timestamp boundaries accordingly.`;
        }

        return {
            clarifiedPrompt,
            clarificationContext,
        };
    }
}
