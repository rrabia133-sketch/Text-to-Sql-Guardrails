import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { SemanticValidatorService } from "../../src/modules/semantic/semantic-validator.service.js";
import { IntentSlots, SemanticValidationResultSchema } from "@text2sql/contracts";

describe("Sprint 5 - Task 7: Deterministic Semantic Validation Orchestrator (US-11)", () => {
    const service = new SemanticValidatorService();

    const parseSql = (sql: string) => {
        const statements = parse(sql);
        return statements[0];
    };

    describe("Happy Path Validation", () => {
        it("returns isValid: true when all 4 semantic verifiers pass", () => {
            const ast = parseSql(`
                SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                WHERE o.status = 'completed'
            `);
            const intent: IntentSlots = {
                rawQuestion: "What is total revenue?",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: [],
                filters: [],
            };

            const result = service.validate(ast, intent);
            assert.equal(result.isValid, true);
            assert.equal(result.criticalCount, 0);
            assert.equal(result.warningCount, 0);
            assert.equal(result.findings.length, 0);
            assert.ok(result.summary.includes("Semantically valid"));

            // Assert full Zod contract compliance
            const parsed = SemanticValidationResultSchema.safeParse(result);
            assert.equal(parsed.success, true);
        });

        it("allows query to be valid when only non-critical advisory warnings are present", () => {
            const ast = parseSql(`
                SELECT id, name FROM customers
            `);
            const intent: IntentSlots = {
                rawQuestion: "List customers in California",
                metric: "customer_count",
                dimensions: ["customers.id"],
                filters: [
                    { column: "customers.state", operator: "=", value: "CA", rawText: "in California" },
                ],
            };

            const result = service.validate(ast, intent);
            assert.equal(result.isValid, true); // Advisory warning does not block validity
            assert.equal(result.criticalCount, 0);
            assert.equal(result.warningCount, 1);
            assert.equal(result.findings[0].code, "UNRESOLVED_INTENT_SLOT");
            assert.equal(result.findings[0].severity, "WARNING");
            assert.ok(result.summary.includes("advisory warning"));
        });
    });

    describe("Critical Semantic Violations Aggregation", () => {
        it("flags query as invalid when revenue query lacks status = 'completed'", () => {
            const ast = parseSql("SELECT SUM(total_amount) FROM orders");
            const intent: IntentSlots = {
                rawQuestion: "What is the total revenue?",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: [],
                filters: [],
            };

            const result = service.validate(ast, intent);
            assert.equal(result.isValid, false);
            assert.equal(result.criticalCount, 1);
            assert.equal(result.hasRepairableFindings, true);
            assert.ok(result.summary.includes("failed with 1 critical violation"));

            const finding = result.findings.find((f) => f.code === "UNHANDLED_ORDER_STATUS");
            assert.ok(finding);
            assert.equal(finding.severity, "CRITICAL");
        });

        it("aggregates multiple critical violations across different verifiers", () => {
            // 1. Wrong aggregation (AVG instead of SUM)
            // 2. Missing status filter (UNHANDLED_ORDER_STATUS)
            // 3. Missing temporal filter (MISSING_DATE_FILTER)
            const ast = parseSql("SELECT AVG(total_amount) FROM orders");
            const intent: IntentSlots = {
                rawQuestion: "What was total revenue last month?",
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

            const result = service.validate(ast, intent);
            assert.equal(result.isValid, false);
            assert.ok(result.criticalCount >= 2);
            assert.ok(result.findings.some((f) => f.code === "WRONG_AGGREGATION"));
            assert.ok(result.findings.some((f) => f.code === "UNHANDLED_ORDER_STATUS"));
            assert.ok(result.findings.some((f) => f.code === "MISSING_DATE_FILTER"));
        });
    });

    describe("Deterministic Ratio Calculators", () => {
        it("computes 1.0 intent agreement and glossary evidence for clean queries", () => {
            const intent: IntentSlots = {
                rawQuestion: "What is total revenue?",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: [],
                filters: [],
            };

            const slotRatio = service.calculateIntentSlotAgreementRatio(intent, []);
            const glossaryRatio = service.calculateGlossaryEvidenceRatio([]);
            const verifierRatio = service.calculateVerifierAgreementRatio([]);

            assert.equal(slotRatio, 1.0);
            assert.equal(glossaryRatio, 1.0);
            assert.equal(verifierRatio, 1.0);
        });

        it("drops ratios when violations are present", () => {
            const intent: IntentSlots = {
                rawQuestion: "What was revenue last month in CA?",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: [],
                filters: [
                    { column: "state", operator: "=", value: "CA" },
                ],
                temporal: {
                    rawExpression: "last month",
                },
            };

            const findings = [
                {
                    code: "UNHANDLED_ORDER_STATUS" as const,
                    severity: "CRITICAL" as const,
                    message: "Missing status filter",
                },
            ];

            const slotRatio = service.calculateIntentSlotAgreementRatio(intent, findings);
            const glossaryRatio = service.calculateGlossaryEvidenceRatio(findings);
            const verifierRatio = service.calculateVerifierAgreementRatio(findings);

            // Total slots: 1 (metric) + 1 (filter) + 1 (temporal) = 3 slots. 1 violated => 2/3 = 0.6667
            assert.ok(slotRatio < 1.0 && slotRatio > 0.6);
            assert.equal(glossaryRatio, 0.0);
            assert.equal(verifierRatio, 0.0);
        });
    });
});
