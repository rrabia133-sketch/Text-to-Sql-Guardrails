import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { MetricVerifier } from "../../src/modules/semantic/metric-verifier.js";
import { IntentSlots } from "@text2sql/contracts";

describe("Sprint 5 - Task 3: Metric Definition & Aggregation Verifier (US-11)", () => {
    const verifier = new MetricVerifier();

    const parseSql = (sql: string) => {
        const statements = parse(sql);
        return statements[0];
    };

    describe("Happy Path Valid Aggregations", () => {
        it("accepts SUM aggregation when question requests total revenue", () => {
            const ast = parseSql("SELECT SUM(quantity * unit_price) AS total_revenue FROM order_items");
            const intent: IntentSlots = {
                rawQuestion: "What is the total revenue?",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
            assert.ok(result.detectedAggregations.includes("SUM"));
        });

        it("accepts AVG aggregation when question requests average order value", () => {
            const ast = parseSql("SELECT AVG(total_amount) AS aov FROM orders");
            const intent: IntentSlots = {
                rawQuestion: "What is the average order value?",
                metric: "average_order_value",
                aggregation: "AVG",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
            assert.ok(result.detectedAggregations.includes("AVG"));
        });

        it("accepts COUNT(DISTINCT ...) for unique counts", () => {
            const ast = parseSql("SELECT COUNT(DISTINCT customer_id) FROM orders");
            const intent: IntentSlots = {
                rawQuestion: "Show unique customers who placed an order",
                metric: "customer_count",
                aggregation: "COUNT_DISTINCT",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
            assert.ok(result.detectedAggregations.includes("COUNT_DISTINCT"));
        });
    });

    describe("Aggregation Mismatch (AVG vs SUM)", () => {
        it("detects SUM used instead of AVG when average was requested", () => {
            const ast = parseSql("SELECT SUM(total_amount) AS revenue FROM orders");
            const intent: IntentSlots = {
                rawQuestion: "What is the average order value?",
                metric: "average_order_value",
                aggregation: "AVG",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);
            assert.equal(result.findings.length, 1);
            assert.equal(result.findings[0].code, "WRONG_AGGREGATION");
            assert.equal(result.findings[0].severity, "CRITICAL");
            assert.equal(result.findings[0].actual, "SUM");
            assert.equal(result.findings[0].expected, "AVG");
        });

        it("detects AVG used instead of SUM when total was requested", () => {
            const ast = parseSql("SELECT AVG(quantity * unit_price) FROM order_items");
            const intent: IntentSlots = {
                rawQuestion: "What is the total revenue?",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "WRONG_AGGREGATION");
            assert.equal(result.findings[0].severity, "CRITICAL");
            assert.equal(result.findings[0].actual, "AVG");
            assert.equal(result.findings[0].expected, "SUM");
        });
    });

    describe("Missing Aggregations", () => {
        it("flags unaggregated projection when SUM was requested", () => {
            const ast = parseSql("SELECT quantity, unit_price FROM order_items");
            const intent: IntentSlots = {
                rawQuestion: "Total spending",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "WRONG_AGGREGATION");
            assert.equal(result.findings[0].actual, "NONE");
        });

        it("flags GROUP BY query with zero aggregate functions", () => {
            const ast = parseSql("SELECT status FROM orders GROUP BY status");
            const intent: IntentSlots = {
                rawQuestion: "Order count per status",
                metric: "order_count",
                aggregation: "COUNT",
                dimensions: ["orders.status"],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "WRONG_AGGREGATION");
            assert.equal(result.hasGroupBy, true);
        });
    });

    describe("Distinct vs Non-Distinct Count", () => {
        it("warns when plain COUNT is used for unique customer query", () => {
            const ast = parseSql("SELECT COUNT(customer_id) FROM orders");
            const intent: IntentSlots = {
                rawQuestion: "Number of unique customers",
                metric: "customer_count",
                aggregation: "COUNT_DISTINCT",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "WRONG_AGGREGATION");
            assert.equal(result.findings[0].severity, "WARNING");
            assert.equal(result.findings[0].expected, "COUNT_DISTINCT");
            assert.equal(result.findings[0].actual, "COUNT");
        });
    });

    describe("Aggregation Inversion (MAX vs MIN)", () => {
        it("flags MIN when question asked for maximum / highest", () => {
            const ast = parseSql("SELECT MIN(total_amount) FROM orders");
            const intent: IntentSlots = {
                rawQuestion: "Maximum order amount",
                metric: "price",
                aggregation: "MAX",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "WRONG_AGGREGATION");
            assert.equal(result.findings[0].severity, "CRITICAL");
            assert.equal(result.findings[0].actual, "MIN");
            assert.equal(result.findings[0].expected, "MAX");
        });

        it("flags MAX when question asked for minimum / lowest", () => {
            const ast = parseSql("SELECT MAX(unit_price) FROM products");
            const intent: IntentSlots = {
                rawQuestion: "Cheapest product price",
                metric: "price",
                aggregation: "MIN",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "WRONG_AGGREGATION");
            assert.equal(result.findings[0].actual, "MAX");
            assert.equal(result.findings[0].expected, "MIN");
        });
    });

    describe("CTE (WITH) Queries", () => {
        it("correctly traverses root SELECT inside a WITH statement", () => {
            const ast = parseSql(
                "WITH monthly_sales AS (SELECT * FROM orders) SELECT SUM(total_amount) FROM monthly_sales"
            );
            const intent: IntentSlots = {
                rawQuestion: "Total monthly revenue",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, true);
            assert.ok(result.detectedAggregations.includes("SUM"));
        });
    });
});
