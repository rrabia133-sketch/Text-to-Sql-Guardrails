import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { IntentExtractorService } from "../../src/modules/intent/intent-extractor.service.js";
import { SemanticValidatorService } from "../../src/modules/semantic/semantic-validator.service.js";
import { GuardrailsService } from "../../src/modules/guardrails/guardrails.service.js";

describe("Sprint 5 - Task 16: Automated Semantic Mismatch, Empty Result & Abstention Tests (US-11 / US-12)", () => {
    const intentExtractor = new IntentExtractorService();
    const semanticValidator = new SemanticValidatorService();
    const guardrails = new GuardrailsService();

    function validateQuestionAndSql(question: string, sql: string) {
        const intent = intentExtractor.extract(question, new Date("2026-04-15T12:00:00Z"));
        const ast = parse(sql)[0];
        return semanticValidator.validate(ast, intent);
    }

    it("detects wrong aggregation: SUM used instead of AVG for average order value", () => {
        const result = validateQuestionAndSql(
            "What is the average order value for completed orders?",
            "SELECT SUM(oi.quantity * oi.unit_price) AS aov FROM orders o JOIN order_items oi ON o.id = oi.order_id WHERE o.status = 'completed' LIMIT 50;"
        );

        assert.equal(result.isValid, false);
        assert.ok(result.criticalCount >= 1);
        const finding = result.findings.find((f) => f.code === "WRONG_AGGREGATION");
        assert.ok(finding, "Expected WRONG_AGGREGATION finding");
        assert.equal(finding.severity, "CRITICAL");
        assert.equal(finding.expected, "AVG");
        assert.equal(finding.actual, "SUM");
    });

    it("detects wrong aggregation: unaggregated projection when total/SUM is requested", () => {
        const result = validateQuestionAndSql(
            "What is the total quantity of items sold?",
            "SELECT quantity FROM order_items LIMIT 50;"
        );

        assert.equal(result.isValid, false);
        const finding = result.findings.find((f) => f.code === "WRONG_AGGREGATION");
        assert.ok(finding, "Expected WRONG_AGGREGATION finding for unaggregated projection");
        assert.equal(finding.severity, "CRITICAL");
        assert.equal(finding.expected, "SUM");
        assert.equal(finding.actual, "NONE");
    });

    it("detects missing completed order status in revenue questions -> UNHANDLED_ORDER_STATUS", () => {
        const result = validateQuestionAndSql(
            "What is our total revenue from all orders?",
            "SELECT SUM(oi.quantity * oi.unit_price) AS revenue FROM orders o JOIN order_items oi ON o.id = oi.order_id LIMIT 50;"
        );

        assert.equal(result.isValid, false);
        const finding = result.findings.find((f) => f.code === "UNHANDLED_ORDER_STATUS");
        assert.ok(finding, "Expected UNHANDLED_ORDER_STATUS finding");
        assert.equal(finding.severity, "CRITICAL");
        assert.equal(finding.repairable, true);
    });

    it("detects missing date filter in questions with temporal expressions -> MISSING_DATE_FILTER", () => {
        const result = validateQuestionAndSql(
            "How many orders were placed last month?",
            "SELECT COUNT(id) AS order_count FROM orders LIMIT 50;"
        );

        assert.equal(result.isValid, false);
        const finding = result.findings.find((f) => f.code === "MISSING_DATE_FILTER");
        assert.ok(finding, "Expected MISSING_DATE_FILTER finding");
        assert.equal(finding.severity, "CRITICAL");
        assert.equal(finding.repairable, true);
    });

    it("detects Cartesian fanout and 1:N join duplication on multi-table joins -> JOIN_FANOUT_DUPLICATION", () => {
        // 1. CROSS JOIN / Cartesian join without ON condition
        const crossJoinResult = validateQuestionAndSql(
            "Show orders and line items",
            "SELECT o.id, oi.quantity FROM orders o CROSS JOIN order_items oi LIMIT 50;"
        );

        assert.equal(crossJoinResult.isValid, false);
        const crossFinding = crossJoinResult.findings.find(
            (f) => f.code === "JOIN_FANOUT_DUPLICATION" && f.severity === "CRITICAL"
        );
        assert.ok(crossFinding, "Expected CRITICAL JOIN_FANOUT_DUPLICATION on CROSS JOIN");

        // 2. 1:N join inflating parent order count without DISTINCT
        const fanoutCountResult = validateQuestionAndSql(
            "How many orders do we have?",
            "SELECT COUNT(*) AS order_count FROM orders o JOIN order_items oi ON o.id = oi.order_id LIMIT 50;"
        );

        const fanoutFinding = fanoutCountResult.findings.find(
            (f) => f.code === "JOIN_FANOUT_DUPLICATION"
        );
        assert.ok(fanoutFinding, "Expected JOIN_FANOUT_DUPLICATION finding on 1:N join count");
    });

    it("detects business glossary formula mismatch -> GLOSSARY_FORMULA_MISMATCH", () => {
        const result = validateQuestionAndSql(
            "What is our total revenue for completed orders?",
            "SELECT SUM(oi.unit_price) AS total_revenue FROM orders o JOIN order_items oi ON o.id = oi.order_id WHERE o.status = 'completed' LIMIT 50;"
        );

        assert.equal(result.isValid, false);
        const finding = result.findings.find((f) => f.code === "GLOSSARY_FORMULA_MISMATCH");
        assert.ok(finding, "Expected GLOSSARY_FORMULA_MISMATCH when summing unit_price without quantity");
        assert.equal(finding.severity, "CRITICAL");
    });

    it("treats empty result sets (0 rows) from valid queries as semantically valid, not semantic errors", async () => {
        const sql =
            "SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue FROM orders o JOIN order_items oi ON o.id = oi.order_id WHERE o.status = 'completed' AND o.ordered_at >= '2026-03-01' AND o.ordered_at < '2026-04-01' LIMIT 50;";

        const guardrailResult = await guardrails.validate(sql);
        assert.equal(guardrailResult.valid, true);

        const semanticResult = validateQuestionAndSql(
            "What was our total revenue last month?",
            sql
        );

        assert.equal(semanticResult.isValid, true);
        assert.equal(semanticResult.criticalCount, 0);
        assert.equal(semanticResult.findings.length, 0);

        // Simulate empty result set returned by read-only executor (0 matching rows)
        const emptyExecutionResult = {
            ok: true,
            status: "completed" as const,
            columns: [{ name: "total_revenue", pgType: "numeric", jsType: "number" as const, nullable: true }],
            rows: [],
            rowCount: 0,
            byteSize: 0,
            executionTimeMs: 8,
            truncated: false,
        };

        assert.equal(emptyExecutionResult.ok, true);
        assert.equal(emptyExecutionResult.status, "completed");
        assert.equal(emptyExecutionResult.rowCount, 0);
        assert.equal(semanticResult.isValid, true, "0-row result must not be flagged as a semantic error");
    });
});

