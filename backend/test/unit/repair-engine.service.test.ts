import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    RepairEngineService,
    MAX_REPAIR_ATTEMPTS,
} from "../../src/modules/semantic/repair-engine.service.js";
import { SemanticValidatorService } from "../../src/modules/semantic/semantic-validator.service.js";
import { GuardrailsService } from "../../src/modules/guardrails/guardrails.service.js";
import type { ILLMProvider } from "../../src/modules/providers/provider.interface.js";
import { ProviderTimeoutError, ProviderQuotaError } from "../../src/modules/providers/base.provider.js";
import type { IntentSlots, SemanticValidationResult } from "@text2sql/contracts";
import { parse } from "pgsql-ast-parser";

describe("Sprint 5 - Task 9: Bounded Automated Repair Engine (US-11)", () => {
    const semanticValidator = new SemanticValidatorService();
    const guardrailsService = new GuardrailsService();

    const parseSql = (sql: string) => parse(sql)[0];

    // Intent slot fixture for total revenue
    const revenueIntent: IntentSlots = {
        rawQuestion: "What is total revenue from completed orders?",
        metric: "revenue",
        aggregation: "SUM",
        dimensions: [],
        filters: [
            { column: "orders.status", operator: "=", value: "completed" },
        ],
    };

    // Intent slot fixture for average order value
    const aovIntent: IntentSlots = {
        rawQuestion: "What is the average order value for completed orders?",
        metric: "average_order_value",
        aggregation: "AVG",
        dimensions: [],
        filters: [
            { column: "orders.status", operator: "=", value: "completed" },
        ],
    };

    describe("Repairable Findings Identification & Targeted Prompt Building", () => {
        const service = new RepairEngineService();

        it("identifies repairable findings correctly", () => {
            const findings = [
                {
                    code: "UNHANDLED_ORDER_STATUS" as const,
                    severity: "CRITICAL" as const,
                    message: "Revenue requires completed orders",
                    repairable: true,
                },
                {
                    code: "WRONG_AGGREGATION" as const,
                    severity: "CRITICAL" as const,
                    message: "Expected AVG, found SUM",
                    repairable: true,
                },
                {
                    code: "MISSING_DATE_FILTER" as const,
                    severity: "CRITICAL" as const,
                    message: "Missing date comparison",
                    repairable: true,
                },
            ];

            const repairable = service.identifyRepairableFindings(findings);
            assert.equal(repairable.length, 3);
        });

        it("builds a targeted repair prompt containing only question, faulty SQL, schema context, and findings", () => {
            const question = "What is total revenue?";
            const faultySql = "SELECT SUM(oi.quantity * oi.unit_price) FROM order_items oi;";
            const findings = [
                {
                    code: "UNHANDLED_ORDER_STATUS" as const,
                    severity: "CRITICAL" as const,
                    message: "Revenue requires orders.status = 'completed'",
                    expected: "completed",
                    suggestion: "Add JOIN orders o AND o.status = 'completed'",
                    repairable: true,
                },
            ];
            const schemaContext = "TABLE orders (id INT, status VARCHAR);";

            const prompt = service.buildRepairPrompt(question, faultySql, findings, schemaContext);

            assert.ok(prompt.includes(question), "Prompt must include original question");
            assert.ok(prompt.includes(faultySql), "Prompt must include faulty SQL");
            assert.ok(prompt.includes(schemaContext), "Prompt must include schema context");
            assert.ok(prompt.includes("UNHANDLED_ORDER_STATUS"), "Prompt must include specific finding code");
            assert.ok(prompt.includes("orders.status = 'completed'"), "Prompt must include suggestion");
            assert.ok(!prompt.includes("SECRET"), "Prompt must not contain unrelated data");
        });
    });

    describe("Automated Single-Pass Repair Workflow", () => {
        it("successfully repairs a query missing status = 'completed' in a single attempt", async () => {
            const faultySql = `
                SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
            `;
            const initialSemantic = semanticValidator.validate(parseSql(faultySql), revenueIntent);
            assert.equal(initialSemantic.isValid, false);
            assert.equal(initialSemantic.findings[0].code, "UNHANDLED_ORDER_STATUS");

            const repairedSql = `
                SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                WHERE o.status = 'completed'
            `;

            let generateCallCount = 0;
            const mockProvider: ILLMProvider = {
                getModelInfo: () => ({ provider: "ollama", model: "qwen2.5-coder:7b", isLocal: true }),
                checkHealth: async () => true,
                generate: async () => {
                    generateCallCount++;
                    return {
                        rawText: JSON.stringify({
                            sql: repairedSql,
                            explanation: "Added WHERE o.status = 'completed'",
                        }),
                        promptTokens: 100,
                        completionTokens: 40,
                        latencyMs: 120,
                        model: "qwen2.5-coder:7b",
                        provider: "ollama",
                    };
                },
            };

            const service = new RepairEngineService();
            const result = await service.repair(
                faultySql,
                "What is total revenue from completed orders?",
                revenueIntent,
                initialSemantic,
                { provider: mockProvider }
            );

            assert.equal(generateCallCount, 1, "Must make at most 1 repair call");
            assert.equal(result.success, true);
            assert.equal(result.attempt.attemptNumber, 1);
            assert.equal(result.attempt.success, true);
            assert.ok(result.attempt.resolvedCodes.includes("UNHANDLED_ORDER_STATUS"));
            assert.equal(result.semanticResult?.isValid, true);
            assert.equal(result.guardrailResult?.valid, true);
            assert.ok(result.normalizedSql?.includes("completed"));
        });

        it("successfully repairs a query with WRONG_AGGREGATION (replaces SUM with AVG)", async () => {
            const faultySql = `
                SELECT SUM(oi.quantity * oi.unit_price) AS avg_order_value
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                WHERE o.status = 'completed'
            `;
            const initialSemantic = semanticValidator.validate(parseSql(faultySql), aovIntent);
            assert.equal(initialSemantic.isValid, false);
            assert.equal(initialSemantic.findings[0].code, "WRONG_AGGREGATION");

            const repairedSql = `
                SELECT AVG(oi.quantity * oi.unit_price) AS avg_order_value
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                WHERE o.status = 'completed'
            `;

            const mockProvider: ILLMProvider = {
                getModelInfo: () => ({ provider: "ollama", model: "qwen2.5-coder:7b", isLocal: true }),
                checkHealth: async () => true,
                generate: async () => ({
                    rawText: JSON.stringify({
                        sql: repairedSql,
                        explanation: "Replaced SUM with AVG",
                    }),
                    promptTokens: 100,
                    completionTokens: 40,
                    latencyMs: 100,
                    model: "qwen2.5-coder:7b",
                    provider: "ollama",
                }),
            };

            const service = new RepairEngineService();
            const result = await service.repair(
                faultySql,
                "What is average order value for completed orders?",
                aovIntent,
                initialSemantic,
                { provider: mockProvider }
            );

            assert.equal(result.success, true);
            assert.equal(result.attempt.attemptNumber, 1);
            assert.ok(result.attempt.resolvedCodes.includes("WRONG_AGGREGATION"));
            assert.equal(result.semanticResult?.isValid, true);
        });

        it("returns success immediately without calling LLM if query was already valid", async () => {
            const validSql = `
                SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                WHERE o.status = 'completed'
            `;
            const validSemantic = semanticValidator.validate(parseSql(validSql), revenueIntent);
            assert.equal(validSemantic.isValid, true);

            let providerCalled = false;
            const mockProvider: ILLMProvider = {
                getModelInfo: () => ({ provider: "ollama", model: "qwen2.5-coder:7b", isLocal: true }),
                checkHealth: async () => true,
                generate: async () => {
                    providerCalled = true;
                    throw new Error("Should not be called!");
                },
            };

            const service = new RepairEngineService();
            const result = await service.repair(validSql, "Total revenue", revenueIntent, validSemantic, {
                provider: mockProvider,
            });

            assert.equal(providerCalled, false);
            assert.equal(result.success, true);
            assert.equal(result.attempt.attemptNumber, 1);
        });
    });

    describe("Bounded Boundaries & Security Guardrail Enforcements", () => {
        it("enforces strict maxRepairAttempts = 1; fails closed if repaired query still has critical findings", async () => {
            const faultySql = `
                SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
            `;
            const initialSemantic = semanticValidator.validate(parseSql(faultySql), revenueIntent);

            // Model returns an SQL that STILL omits status = 'completed'
            const badRepairSql = `
                SELECT SUM(oi.quantity * oi.unit_price) AS revenue_still_missing_status
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
            `;

            let callCount = 0;
            const mockProvider: ILLMProvider = {
                getModelInfo: () => ({ provider: "ollama", model: "qwen2.5-coder:7b", isLocal: true }),
                checkHealth: async () => true,
                generate: async () => {
                    callCount++;
                    return {
                        rawText: JSON.stringify({ sql: badRepairSql }),
                        promptTokens: 100,
                        completionTokens: 40,
                        latencyMs: 100,
                        model: "qwen2.5-coder:7b",
                        provider: "ollama",
                    };
                },
            };

            const service = new RepairEngineService();
            const result = await service.repair(
                faultySql,
                "What is total revenue?",
                revenueIntent,
                initialSemantic,
                { provider: mockProvider }
            );

            assert.equal(callCount, 1, "Must never attempt a 2nd repair pass");
            assert.equal(result.success, false, "Must fail closed when critical violations persist");
            assert.equal(result.attempt.attemptNumber, 1);
            assert.equal(result.attempt.success, false);
            assert.ok(result.error?.includes("Single repair attempt exhausted"));
        });

        it("asserts repair can NEVER weaken security: rejects non-SELECT mutations", async () => {
            const faultySql = "SELECT id FROM orders;";
            const initialSemantic: SemanticValidationResult = {
                isValid: false,
                criticalCount: 1,
                warningCount: 0,
                infoCount: 0,
                hasRepairableFindings: true,
                summary: "Faulty query",
                intentSlots: revenueIntent,
                findings: [
                    {
                        code: "UNHANDLED_ORDER_STATUS",
                        severity: "CRITICAL",
                        message: "Missing status filter",
                        repairable: true,
                    },
                ],
            };

            // Model attempts malicious UPDATE mutation
            const maliciousSql = "UPDATE orders SET status = 'completed';";

            const mockProvider: ILLMProvider = {
                getModelInfo: () => ({ provider: "ollama", model: "qwen2.5-coder:7b", isLocal: true }),
                checkHealth: async () => true,
                generate: async () => ({
                    rawText: JSON.stringify({ sql: maliciousSql }),
                    promptTokens: 100,
                    completionTokens: 20,
                    latencyMs: 100,
                    model: "qwen2.5-coder:7b",
                    provider: "ollama",
                }),
            };

            const service = new RepairEngineService();
            const result = await service.repair(faultySql, "Revenue", revenueIntent, initialSemantic, {
                provider: mockProvider,
            });

            assert.equal(result.success, false);
            assert.equal(result.attempt.success, false);
            assert.equal(result.guardrailResult?.valid, false);
            assert.ok(result.error?.includes("violated security guardrails"));
        });

        it("asserts repair can NEVER weaken security: rejects unapproved tables or system catalogs", async () => {
            const faultySql = "SELECT id FROM orders;";
            const initialSemantic: SemanticValidationResult = {
                isValid: false,
                criticalCount: 1,
                warningCount: 0,
                infoCount: 0,
                hasRepairableFindings: true,
                summary: "Faulty query",
                intentSlots: revenueIntent,
                findings: [
                    {
                        code: "UNHANDLED_ORDER_STATUS",
                        severity: "CRITICAL",
                        message: "Missing status filter",
                        repairable: true,
                    },
                ],
            };

            // Model references forbidden table
            const unapprovedTableSql = "SELECT password_hash FROM admin_passwords;";

            const mockProvider: ILLMProvider = {
                getModelInfo: () => ({ provider: "ollama", model: "qwen2.5-coder:7b", isLocal: true }),
                checkHealth: async () => true,
                generate: async () => ({
                    rawText: JSON.stringify({ sql: unapprovedTableSql }),
                    promptTokens: 100,
                    completionTokens: 20,
                    latencyMs: 100,
                    model: "qwen2.5-coder:7b",
                    provider: "ollama",
                }),
            };

            const service = new RepairEngineService();
            const result = await service.repair(faultySql, "Revenue", revenueIntent, initialSemantic, {
                provider: mockProvider,
            });

            assert.equal(result.success, false);
            assert.equal(result.attempt.success, false);
            assert.equal(result.guardrailResult?.valid, false);
            assert.ok(result.error?.includes("violated security guardrails"));
        });

        it("handles provider timeouts during repair without throwing uncaught errors", async () => {
            const faultySql = "SELECT id FROM orders;";
            const initialSemantic: SemanticValidationResult = {
                isValid: false,
                criticalCount: 1,
                warningCount: 0,
                infoCount: 0,
                hasRepairableFindings: true,
                summary: "Faulty query",
                intentSlots: revenueIntent,
                findings: [
                    {
                        code: "UNHANDLED_ORDER_STATUS",
                        severity: "CRITICAL",
                        message: "Missing status",
                        repairable: true,
                    },
                ],
            };

            const timeoutProvider: ILLMProvider = {
                getModelInfo: () => ({ provider: "groq", model: "llama-3.3-70b", isLocal: false }),
                checkHealth: async () => true,
                generate: async () => {
                    throw new ProviderTimeoutError("groq", 5000);
                },
            };

            const service = new RepairEngineService();
            const result = await service.repair(faultySql, "Revenue", revenueIntent, initialSemantic, {
                provider: timeoutProvider,
            });

            assert.equal(result.success, false);
            assert.equal(result.attempt.success, false);
            assert.ok(result.error?.includes("timed out"));
        });
    });
});

