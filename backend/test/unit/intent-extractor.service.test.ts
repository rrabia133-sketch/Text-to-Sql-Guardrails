import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { IntentExtractorService } from "../../src/modules/intent/intent-extractor.service.js";

describe("Sprint 5 - Task 2: Intent Extractor Service (US-11)", () => {
    const extractor = new IntentExtractorService();
    // Deterministic anchor date: October 15, 2024 UTC
    const anchorDate = new Date("2024-10-15T12:00:00.000Z");

    describe("Metric & Aggregation Extraction", () => {
        it("extracts revenue and SUM for sales questions", () => {
            const slots = extractor.extract("What is the total revenue for completed orders?", anchorDate);
            assert.equal(slots.metric, "revenue");
            assert.equal(slots.aggregation, "SUM");
        });

        it("extracts average_order_value and AVG", () => {
            const slots = extractor.extract("What is the average order value per customer?", anchorDate);
            assert.equal(slots.metric, "average_order_value");
            assert.equal(slots.aggregation, "AVG");
        });

        it("extracts order_count and COUNT", () => {
            const slots = extractor.extract("How many orders were placed yesterday?", anchorDate);
            assert.equal(slots.metric, "order_count");
            assert.equal(slots.aggregation, "COUNT");
        });

        it("extracts COUNT_DISTINCT for unique customers", () => {
            const slots = extractor.extract("Show distinct customers who bought products", anchorDate);
            assert.equal(slots.aggregation, "COUNT_DISTINCT");
        });

        it("extracts MAX for peak / highest spending", () => {
            const slots = extractor.extract("What was the maximum order spend?", anchorDate);
            assert.equal(slots.aggregation, "MAX");
        });

        it("extracts MIN for lowest price", () => {
            const slots = extractor.extract("What is the minimum unit price?", anchorDate);
            assert.equal(slots.aggregation, "MIN");
        });
    });

    describe("Dimension & Grouping Extraction", () => {
        it("extracts orders.status dimension", () => {
            const slots = extractor.extract("Show order count grouped by order status", anchorDate);
            assert.ok(slots.dimensions.includes("orders.status"));
        });

        it("extracts customers.id dimension for customer queries", () => {
            const slots = extractor.extract("Total spending per customer", anchorDate);
            assert.ok(slots.dimensions.includes("customers.id"));
        });

        it("extracts products.category dimension", () => {
            const slots = extractor.extract("Average revenue by product category", anchorDate);
            assert.ok(slots.dimensions.includes("products.category"));
        });

        it("extracts month dimension for monthly trends", () => {
            const slots = extractor.extract("Monthly revenue for 2024", anchorDate);
            assert.ok(slots.dimensions.includes("month"));
        });
    });

    describe("Filter & Predicate Extraction", () => {
        it("extracts completed status filter", () => {
            const slots = extractor.extract("Total sales for completed orders", anchorDate);
            const statusFilter = slots.filters.find((f) => f.column === "orders.status");
            assert.ok(statusFilter);
            assert.equal(statusFilter?.value, "completed");
        });

        it("extracts pending status filter", () => {
            const slots = extractor.extract("Count pending orders", anchorDate);
            const statusFilter = slots.filters.find((f) => f.column === "orders.status");
            assert.ok(statusFilter);
            assert.equal(statusFilter?.value, "pending");
        });

        it("extracts cancelled status filter", () => {
            const slots = extractor.extract("Show all cancelled orders", anchorDate);
            const statusFilter = slots.filters.find((f) => f.column === "orders.status");
            assert.ok(statusFilter);
            assert.equal(statusFilter?.value, "cancelled");
        });

        it("extracts product category filter", () => {
            const slots = extractor.extract("Total revenue from electronics", anchorDate);
            const catFilter = slots.filters.find((f) => f.column === "products.category");
            assert.ok(catFilter);
            assert.equal(catFilter?.value, "electronics");
        });

        it("extracts customer state filter", () => {
            const slots = extractor.extract("Orders from customers in California", anchorDate);
            const stateFilter = slots.filters.find((f) => f.column === "customers.state");
            assert.ok(stateFilter);
            assert.equal(stateFilter?.value, "CA");
        });
    });

    describe("Temporal Slot Extraction", () => {
        it("extracts deterministic date boundaries for 'yesterday'", () => {
            const slots = extractor.extract("Orders placed yesterday", anchorDate);
            assert.ok(slots.temporal);
            assert.equal(slots.temporal?.rawExpression, "yesterday");
            assert.equal(slots.temporal?.startDate, "2024-10-14T00:00:00.000Z");
            assert.equal(slots.temporal?.endDate, "2024-10-15T00:00:00.000Z");
            assert.equal(slots.temporal?.grain, "day");
        });

        it("extracts month grain for 'last month'", () => {
            const slots = extractor.extract("Total revenue last month", anchorDate);
            assert.ok(slots.temporal);
            assert.equal(slots.temporal?.rawExpression, "last month");
            assert.equal(slots.temporal?.grain, "month");
        });
    });

    describe("Sort & Row Limits (Top-N)", () => {
        it("extracts top 5 limit and DESC direction", () => {
            const slots = extractor.extract("Top 5 products by quantity sold", anchorDate);
            assert.equal(slots.rowLimit, 5);
            assert.equal(slots.sort?.direction, "DESC");
            assert.ok(slots.dimensions.includes("products.id"));
        });

        it("extracts bottom 10 limit and ASC direction", () => {
            const slots = extractor.extract("Bottom 10 customers by revenue", anchorDate);
            assert.equal(slots.rowLimit, 10);
            assert.equal(slots.sort?.direction, "ASC");
        });
    });

    describe("Complex End-to-End Analytical Queries", () => {
        it("extracts all slots from multi-attribute question", () => {
            const question = "Show top 5 customers in California by revenue for completed orders last month";
            const slots = extractor.extract(question, anchorDate);

            assert.equal(slots.metric, "revenue");
            assert.equal(slots.aggregation, "SUM");
            assert.ok(slots.dimensions.includes("customers.id"));
            assert.equal(slots.rowLimit, 5);
            assert.equal(slots.sort?.direction, "DESC");

            // Filters
            const statusFilter = slots.filters.find((f) => f.column === "orders.status");
            assert.equal(statusFilter?.value, "completed");
            const stateFilter = slots.filters.find((f) => f.column === "customers.state");
            assert.equal(stateFilter?.value, "CA");

            // Temporal
            assert.ok(slots.temporal);
            assert.equal(slots.temporal?.grain, "month");
        });
    });
});
