import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { CardinalityVerifier } from "../../src/modules/semantic/cardinality-verifier.js";
import { IntentSlots } from "@text2sql/contracts";

describe("Sprint 5 - Task 5: Join Cardinality, Fanout & Duplicate Row Detector (US-11)", () => {
    const verifier = new CardinalityVerifier();

    const parseSql = (sql: string) => {
        const statements = parse(sql);
        return statements[0];
    };

    describe("Happy Path Safe Joins", () => {
        it("passes single-table queries without joins", () => {
            const ast = parseSql("SELECT id, total_amount FROM orders WHERE status = 'completed'");
            const intent: IntentSlots = {
                rawQuestion: "List orders",
                metric: "order_count",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
            assert.deepEqual(result.joinedTables, ["orders"]);
        });

        it("passes 1:N join when parent table is counted with COUNT(DISTINCT ...)", () => {
            const ast = parseSql(`
                SELECT c.name, COUNT(DISTINCT o.id) AS order_count
                FROM customers c
                JOIN orders o ON c.id = o.customer_id
                JOIN order_items oi ON o.id = oi.order_id
                GROUP BY c.name
            `);
            const intent: IntentSlots = {
                rawQuestion: "How many orders did each customer place?",
                metric: "order_count",
                aggregation: "COUNT_DISTINCT",
                dimensions: ["customers.name"],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
        });

        it("passes when aggregates operate strictly on child line item table", () => {
            const ast = parseSql(`
                SELECT o.id, SUM(oi.quantity * oi.unit_price) AS line_revenue
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                GROUP BY o.id
            `);
            const intent: IntentSlots = {
                rawQuestion: "Calculate line total by order",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: ["orders.id"],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
        });
    });

    describe("Rule 1: Cartesian Product / Cross Joins", () => {
        it("flags CRITICAL finding when join uses CROSS JOIN", () => {
            const ast = parseSql("SELECT * FROM customers CROSS JOIN orders");
            const intent: IntentSlots = {
                rawQuestion: "Show customers and orders",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);
            
            const finding = result.findings.find((f) => f.code === "JOIN_FANOUT_DUPLICATION");
            assert.ok(finding);
            assert.equal(finding.severity, "CRITICAL");
            assert.ok(finding.message.includes("Cartesian"));
        });
    });

    describe("Rule 2: Parent Aggregate Fanout Duplication", () => {
        it("flags CRITICAL finding when counting parent orders without DISTINCT over order_items", () => {
            const ast = parseSql(`
                SELECT c.name, COUNT(o.id) AS inflated_order_count
                FROM customers c
                JOIN orders o ON c.id = o.customer_id
                JOIN order_items oi ON o.id = oi.order_id
                GROUP BY c.name
            `);
            const intent: IntentSlots = {
                rawQuestion: "Count total orders by customer",
                metric: "order_count",
                aggregation: "COUNT",
                dimensions: ["customers.name"],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);

            const finding = result.findings.find((f) => f.code === "JOIN_FANOUT_DUPLICATION");
            assert.ok(finding);
            assert.equal(finding.severity, "CRITICAL");
            assert.ok(finding.message.includes("multiplies values by child rows"));
            assert.equal(finding.field, "orders.id");
        });

        it("flags CRITICAL finding when summing parent total_amount over child order_items", () => {
            const ast = parseSql(`
                SELECT SUM(o.total_amount) AS multiplied_revenue
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
            `);
            const intent: IntentSlots = {
                rawQuestion: "Total order revenue",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);

            const finding = result.findings.find((f) => f.code === "JOIN_FANOUT_DUPLICATION");
            assert.ok(finding);
            assert.equal(finding.severity, "CRITICAL");
            assert.equal(finding.field, "orders.total_amount");
        });

        it("flags WARNING when intent requests order count but query joins order_items with COUNT(*)", () => {
            const ast = parseSql(`
                SELECT COUNT(*) 
                FROM orders o 
                JOIN order_items oi ON o.id = oi.order_id
            `);
            const intent: IntentSlots = {
                rawQuestion: "How many orders were placed?",
                metric: "order_count",
                aggregation: "COUNT",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);

            const finding = result.findings.find((f) => f.code === "JOIN_FANOUT_DUPLICATION");
            assert.ok(finding);
            assert.equal(finding.severity, "WARNING");
            assert.ok(finding.message.includes("may inflate count"));
        });
    });
});
