import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { GlossaryVerifier } from "../../src/modules/semantic/glossary-verifier.js";
import { IntentSlots } from "@text2sql/contracts";

describe("Sprint 5 - Task 6: Glossary Business Rule & Formula Alignment Checker (US-11)", () => {
    const verifier = new GlossaryVerifier();

    const parseSql = (sql: string) => {
        const statements = parse(sql);
        return statements[0];
    };

    describe("Happy Path Glossary Formulas", () => {
        it("accepts recognized revenue when multiplying quantity * unit_price on order_items", () => {
            const ast = parseSql(`
                SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                WHERE o.status = 'completed'
            `);
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
            assert.equal(result.matchedMetricId, "revenue");
        });

        it("accepts AOV when formula divides revenue by orders", () => {
            const ast = parseSql(`
                SELECT ROUND(SUM(oi.quantity * oi.unit_price) / NULLIF(COUNT(DISTINCT o.id), 0), 2) AS aov
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                WHERE o.status = 'completed'
            `);
            const intent: IntentSlots = {
                rawQuestion: "What is the average order value?",
                metric: "average_order_value",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
            assert.equal(result.matchedMetricId, "average_order_value");
        });

        it("accepts active customer query joining customers and orders", () => {
            const ast = parseSql(`
                SELECT COUNT(DISTINCT c.id) AS active_customers
                FROM customers c
                JOIN orders o ON c.id = o.customer_id
                WHERE o.status = 'completed'
            `);
            const intent: IntentSlots = {
                rawQuestion: "Count active customers",
                metric: "active_customer",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
            assert.equal(result.matchedMetricId, "active_customer");
        });
    });

    describe("Glossary Formula Deviations (GLOSSARY_FORMULA_MISMATCH)", () => {
        it("flags CRITICAL finding when revenue query over order_items sums bare unit_price without quantity", () => {
            const ast = parseSql(`
                SELECT SUM(oi.unit_price) AS flawed_revenue
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                WHERE o.status = 'completed'
            `);
            const intent: IntentSlots = {
                rawQuestion: "Show total sales revenue",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);

            const finding = result.findings.find((f) => f.code === "GLOSSARY_FORMULA_MISMATCH");
            assert.ok(finding);
            assert.equal(finding.severity, "CRITICAL");
            assert.ok(finding.message.includes("SUM(quantity * unit_price)"));
        });

        it("flags CRITICAL finding when AOV query lacks ratio division", () => {
            const ast = parseSql(`
                SELECT SUM(total_amount) AS aov
                FROM orders
                WHERE status = 'completed'
            `);
            const intent: IntentSlots = {
                rawQuestion: "What is the average order value?",
                metric: "average_order_value",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);

            const finding = result.findings.find((f) => f.code === "GLOSSARY_FORMULA_MISMATCH");
            assert.ok(finding);
            assert.equal(finding.severity, "CRITICAL");
            assert.ok(finding.message.includes("dividing total revenue"));
        });

        it("flags CRITICAL finding when active customer question does not join orders", () => {
            const ast = parseSql("SELECT COUNT(id) FROM customers");
            const intent: IntentSlots = {
                rawQuestion: "Show active customers",
                metric: "active_customer",
                dimensions: [],
                filters: [],
            };

            const result = verifier.verify(ast, intent);
            assert.equal(result.ok, false);

            const finding = result.findings.find((f) => f.code === "GLOSSARY_FORMULA_MISMATCH");
            assert.ok(finding);
            assert.equal(finding.severity, "CRITICAL");
            assert.ok(finding.message.includes("joining 'customers' with 'orders'"));
        });
    });
});
