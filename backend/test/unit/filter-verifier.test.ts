import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { FilterVerifier } from "../../src/modules/semantic/filter-verifier.js";
import { IntentSlots } from "@text2sql/contracts";

describe("Sprint 5 - Task 4: Filter, Status & Temporal Boundary Validator (US-11)", () => {
    const verifier = new FilterVerifier();

    const parseSql = (sql: string) => {
        const statements = parse(sql);
        return statements[0];
    };

    describe("Rule 1: Revenue Status Filter (UNHANDLED_ORDER_STATUS)", () => {
        it("flags CRITICAL finding when revenue query lacks orders.status = 'completed'", () => {
            const ast = parseSql("SELECT SUM(total_amount) AS revenue FROM orders");
            const intent: IntentSlots = {
                rawQuestion: "What is the total revenue?",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);
            assert.equal(result.hasStatusFilter, false);

            const finding = result.findings.find((f) => f.code === "UNHANDLED_ORDER_STATUS");
            assert.ok(finding);
            assert.equal(finding.severity, "CRITICAL");
            assert.equal(finding.repairable, true);
        });

        it("passes when revenue query explicitly includes status = 'completed'", () => {
            const ast = parseSql("SELECT SUM(total_amount) FROM orders WHERE status = 'completed'");
            const intent: IntentSlots = {
                rawQuestion: "What is the total revenue?",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, true);
            assert.equal(result.hasStatusFilter, true);
            assert.equal(result.findings.length, 0);
        });

        it("passes when table-qualified orders.status = 'completed' is present", () => {
            const ast = parseSql("SELECT SUM(total_amount) FROM orders WHERE orders.status = 'completed'");
            const intent: IntentSlots = {
                rawQuestion: "Calculate total revenue by customer",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: ["customers.name"],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, true);
            assert.equal(result.hasStatusFilter, true);
        });

        it("does not demand status filter for non-revenue questions", () => {
            const ast = parseSql("SELECT id, name, email FROM customers WHERE state = 'CA'");
            const intent: IntentSlots = {
                rawQuestion: "List all customers in California",
                metric: "customer_count",
                dimensions: ["customers.id"],
                filters: [
                    { column: "customers.state", operator: "eq", value: "CA", rawText: "in California" },
                ],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, true);
            assert.equal(result.findings.some((f) => f.code === "UNHANDLED_ORDER_STATUS"), false);
        });
    });

    describe("Rule 2: Temporal Boundary Filter (MISSING_DATE_FILTER)", () => {
        it("flags CRITICAL finding when question has temporal intent but SQL lacks date filter", () => {
            const ast = parseSql("SELECT SUM(total_amount) FROM orders WHERE status = 'completed'");
            const intent: IntentSlots = {
                rawQuestion: "Show sales for last month",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: [],
                filters: [],
                temporal: {
                    startDate: "2024-09-01",
                    endDate: "2024-09-30",
                    rawExpression: "last month",
                },
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);
            assert.equal(result.hasDateFilter, false);

            const finding = result.findings.find((f) => f.code === "MISSING_DATE_FILTER");
            assert.ok(finding);
            assert.equal(finding.severity, "CRITICAL");
        });

        it("passes when date filter on created_at is present", () => {
            const ast = parseSql(
                "SELECT SUM(total_amount) FROM orders WHERE status = 'completed' AND created_at >= '2024-09-01'"
            );
            const intent: IntentSlots = {
                rawQuestion: "Show sales for last month",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: [],
                filters: [],
                temporal: {
                    startDate: "2024-09-01",
                    endDate: "2024-09-30",
                    rawExpression: "last month",
                },
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, true);
            assert.equal(result.hasDateFilter, true);
            assert.equal(result.findings.length, 0);
        });
    });

    describe("Rule 3: Intent Filter Slot Alignment (UNRESOLVED_INTENT_SLOT)", () => {
        it("flags WARNING when intent filter is omitted from WHERE clause", () => {
            const ast = parseSql("SELECT name FROM customers");
            const intent: IntentSlots = {
                rawQuestion: "Find customers in California",
                dimensions: ["customers.name"],
                filters: [
                    { column: "customers.state", operator: "eq", value: "CA", rawText: "in California" },
                ],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);

            const finding = result.findings.find((f) => f.code === "UNRESOLVED_INTENT_SLOT");
            assert.ok(finding);
            assert.equal(finding.severity, "WARNING");
            assert.equal(finding.field, "customers.state");
        });

        it("passes when intent filter matches short column name in WHERE", () => {
            const ast = parseSql("SELECT name FROM customers WHERE state = 'CA'");
            const intent: IntentSlots = {
                rawQuestion: "Find customers in California",
                dimensions: ["customers.name"],
                filters: [
                    { column: "customers.state", operator: "eq", value: "CA", rawText: "in California" },
                ],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
        });
    });

    describe("Compound Expressions & CTEs", () => {
        it("correctly extracts predicates from CTE / WITH queries", () => {
            const ast = parseSql(`
                WITH completed_orders AS (
                    SELECT * FROM orders
                )
                SELECT SUM(total_amount) FROM completed_orders 
                WHERE status = 'completed' AND created_at >= '2024-01-01'
            `);
            const intent: IntentSlots = {
                rawQuestion: "Show 2024 revenue",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: [],
                filters: [],
                temporal: {
                    startDate: "2024-01-01",
                    rawExpression: "2024",
                },
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, true);
            assert.equal(result.hasStatusFilter, true);
            assert.equal(result.hasDateFilter, true);
            assert.equal(result.findings.length, 0);
        });
    });
});
