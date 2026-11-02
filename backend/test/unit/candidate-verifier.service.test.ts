import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import {
    CandidateVerifierService,
    CANDIDATE_TIMEOUT_LOCAL_MS,
    CANDIDATE_TIMEOUT_CLOUD_MS,
    VERIFIER_TIMEOUT_LOCAL_MS,
    VERIFIER_TIMEOUT_CLOUD_MS,
} from "../../src/modules/semantic/candidate-verifier.service.js";
import type { ILLMProvider, ProviderRawResponse } from "../../src/modules/providers/provider.interface.js";
import { ProviderTimeoutError, ProviderQuotaError } from "../../src/modules/providers/base.provider.js";
import type { IntentSlots, SemanticFinding } from "@text2sql/contracts";

describe("Sprint 5 - Task 8: Bounded Verifier & Secondary Candidate Stability Generator (US-11 / US-12)", () => {
    const parseSql = (sql: string) => parse(sql)[0];

    // Sample intent slots
    const sampleRevenueIntent: IntentSlots = {
        rawQuestion: "What is total revenue for completed orders?",
        metric: "revenue",
        aggregation: "SUM",
        dimensions: [],
        filters: [
            { column: "orders.status", operator: "=", value: "completed" },
        ],
    };

    describe("Structural Equivalence & Stability Evaluation", () => {
        const service = new CandidateVerifierService();

        it("returns stability score 1.0 for structurally identical primary and secondary queries", () => {
            const sql1 = `
                SELECT c.id, c.name, SUM(oi.quantity * oi.unit_price) AS revenue
                FROM customers c
                JOIN orders o ON c.id = o.customer_id
                JOIN order_items oi ON o.id = oi.order_id
                WHERE o.status = 'completed'
                GROUP BY c.id, c.name
            `;
            const sql2 = `
                SELECT c.id, c.name, SUM(oi.quantity * oi.unit_price) AS revenue
                FROM customers c
                JOIN orders o ON c.id = o.customer_id
                JOIN order_items oi ON o.id = oi.order_id
                WHERE o.status = 'completed'
                GROUP BY c.id, c.name
            `;

            const result = service.evaluateEquivalence(parseSql(sql1), parseSql(sql2), sql2);
            assert.equal(result.available, true);
            assert.equal(result.unavailable, false);
            assert.equal(result.score, 1.0);
            assert.equal(result.metrics?.projectionSimilarity, 1.0);
            assert.equal(result.metrics?.tableJoinSimilarity, 1.0);
            assert.equal(result.metrics?.predicateSimilarity, 1.0);
            assert.ok(result.evidenceSummary.includes("High structural consensus"));
        });

        it("evaluates structural equivalence across alias variations and alternate join ordering", () => {
            const primarySql = `
                SELECT c.id, c.name, SUM(oi.quantity * oi.unit_price) AS revenue
                FROM customers c
                JOIN orders o ON c.id = o.customer_id
                JOIN order_items oi ON o.id = oi.order_id
                WHERE o.status = 'completed'
                GROUP BY c.id, c.name
            `;
            const secondarySql = `
                SELECT cust.id, cust.name, SUM(item.quantity * item.unit_price) AS total_revenue
                FROM orders ord
                JOIN customers cust ON ord.customer_id = cust.id
                JOIN order_items item ON ord.id = item.order_id
                WHERE ord.status = 'completed'
                GROUP BY cust.id, cust.name
            `;

            const result = service.evaluateEquivalence(parseSql(primarySql), parseSql(secondarySql), secondarySql);
            assert.equal(result.available, true);
            assert.equal(result.unavailable, false);
            assert.ok(result.score >= 0.85, `Expected score >= 0.85, got ${result.score}`);
            assert.equal(result.metrics?.tableJoinSimilarity, 1.0); // Exact same 3 tables
            assert.equal(result.metrics?.predicateSimilarity, 1.0); // Exact same predicate column 'status'
        });

        it("evaluates predicate similarity as 1.0 when neither query has a WHERE clause", () => {
            const sql1 = `SELECT id, name FROM customers`;
            const sql2 = `SELECT id, name FROM customers`;

            const result = service.evaluateEquivalence(parseSql(sql1), parseSql(sql2), sql2);
            assert.equal(result.metrics?.predicateSimilarity, 1.0);
            assert.equal(result.score, 1.0);
        });

        it("penalizes divergent queries with low stability score", () => {
            const primarySql = `
                SELECT id, name FROM customers WHERE state = 'CA'
            `;
            const secondarySql = `
                SELECT title, price FROM products WHERE category = 'Electronics'
            `;

            const result = service.evaluateEquivalence(parseSql(primarySql), parseSql(secondarySql), secondarySql);
            assert.equal(result.available, true);
            assert.equal(result.unavailable, false);
            assert.ok(result.score < 0.60, `Expected score < 0.60, got ${result.score}`);
            assert.ok(result.evidenceSummary.includes("diverged significantly") || result.evidenceSummary.includes("Low consensus"));
        });

        it("handles invalid or non-SELECT candidate AST gracefully", () => {
            const primaryAst = parseSql("SELECT id FROM customers");
            const result = service.evaluateEquivalence(primaryAst, null);

            assert.equal(result.available, false);
            assert.equal(result.unavailable, true);
            assert.equal(result.score, 0.0);
            assert.ok(result.reasonUnavailable?.includes("Unable to parse"));
        });

        it("evaluates stability via evaluateStability with explicit secondary SQL string", async () => {
            const primary = "SELECT id, email FROM customers WHERE active = true";
            const secondary = "SELECT id, email FROM customers WHERE active = true";

            const result = await service.evaluateStability(primary, "Show active customers", {
                secondarySql: secondary,
            });

            assert.equal(result.available, true);
            assert.equal(result.unavailable, false);
            assert.equal(result.score, 1.0);
            assert.equal(result.secondarySql, secondary);
        });

        it("handles secondary SQL parse errors in evaluateStability gracefully", async () => {
            const primary = "SELECT id FROM customers";
            const invalidSecondary = "THIS IS NOT VALID SQL AT ALL";

            const result = await service.evaluateStability(primary, "Show customers", {
                secondarySql: invalidSecondary,
            });

            assert.equal(result.available, false);
            assert.equal(result.unavailable, true);
            assert.equal(result.score, 0.0);
            assert.ok(result.reasonUnavailable?.includes("Failed to parse SQL candidate"));
        });
    });

    describe("Secondary Candidate Independent Generation & Guardrails", () => {
        it("enforces strict 10s timeout budget for local provider", async () => {
            let capturedTimeoutMs: number | undefined;
            const mockLocalProvider: ILLMProvider = {
                getModelInfo: () => ({ provider: "ollama", model: "qwen2.5-coder:7b", isLocal: true }),
                checkHealth: async () => true,
                generate: async (_, options) => {
                    capturedTimeoutMs = options?.timeoutMs;
                    return {
                        rawText: JSON.stringify({ sql: "SELECT id FROM customers LIMIT 5;" }),
                        promptTokens: 10,
                        completionTokens: 10,
                        latencyMs: 100,
                        model: "qwen2.5-coder:7b",
                        provider: "ollama",
                    };
                },
            };

            const service = new CandidateVerifierService();
            const result = await service.generateSecondaryCandidate("List customers", {
                provider: mockLocalProvider,
            });

            assert.equal(result.available, true);
            assert.equal(result.unavailable, false);
            assert.equal(capturedTimeoutMs, CANDIDATE_TIMEOUT_LOCAL_MS);
            assert.equal(CANDIDATE_TIMEOUT_LOCAL_MS, 10_000);
            assert.equal(result.sql, "SELECT id FROM customers LIMIT 5;");
        });

        it("enforces strict 5s timeout budget for cloud provider", async () => {
            let capturedTimeoutMs: number | undefined;
            const mockCloudProvider: ILLMProvider = {
                getModelInfo: () => ({ provider: "groq", model: "llama-3.3-70b-versatile", isLocal: false }),
                checkHealth: async () => true,
                generate: async (_, options) => {
                    capturedTimeoutMs = options?.timeoutMs;
                    return {
                        rawText: JSON.stringify({ sql: "SELECT title FROM products LIMIT 5;" }),
                        promptTokens: 10,
                        completionTokens: 10,
                        latencyMs: 100,
                        model: "llama-3.3-70b-versatile",
                        provider: "groq",
                    };
                },
            };

            const service = new CandidateVerifierService();
            const result = await service.generateSecondaryCandidate("List products", {
                provider: mockCloudProvider,
            });

            assert.equal(result.available, true);
            assert.equal(result.unavailable, false);
            assert.equal(capturedTimeoutMs, CANDIDATE_TIMEOUT_CLOUD_MS);
            assert.equal(CANDIDATE_TIMEOUT_CLOUD_MS, 5_000);
            assert.equal(result.sql, "SELECT title FROM products LIMIT 5;");
        });

        it("generates secondary candidate WITHOUT exposing primary SQL", async () => {
            let capturedPrompt = "";
            let capturedTemp: number | undefined;
            const primarySql = "SELECT secret_column_xyz FROM customers WHERE id = 9999;";

            const mockProvider: ILLMProvider = {
                getModelInfo: () => ({ provider: "ollama", model: "qwen2.5-coder:7b", isLocal: true }),
                checkHealth: async () => true,
                generate: async (prompt, options) => {
                    capturedPrompt = prompt;
                    capturedTemp = options?.temperature;
                    return {
                        rawText: JSON.stringify({ sql: "SELECT id FROM customers;" }),
                        promptTokens: 10,
                        completionTokens: 10,
                        latencyMs: 100,
                        model: "qwen2.5-coder:7b",
                        provider: "ollama",
                    };
                },
            };

            const service = new CandidateVerifierService();
            // Primary SQL is passed to evaluateStability, but evaluateStability must NOT send it to generator
            await service.evaluateStability(primarySql, "Find customer 9999", {
                provider: mockProvider,
            });

            assert.ok(!capturedPrompt.includes(primarySql), "Prompt MUST NOT expose primary SQL!");
            assert.ok(!capturedPrompt.includes("secret_column_xyz"), "Prompt MUST NOT leak column details from primary SQL!");
            assert.equal(capturedTemp, 0.3, "Candidate generation should use secondary temperature variation (0.3)");
        });

        it("marks candidate unavailable: true when candidate generation times out without failing", async () => {
            const timeoutProvider: ILLMProvider = {
                getModelInfo: () => ({ provider: "groq", model: "llama-3.3-70b", isLocal: false }),
                checkHealth: async () => true,
                generate: async () => {
                    throw new ProviderTimeoutError("groq", 5000);
                },
            };

            const service = new CandidateVerifierService();
            const result = await service.evaluateStability(
                "SELECT id FROM customers;",
                "Find customers",
                { provider: timeoutProvider }
            );

            assert.equal(result.available, false);
            assert.equal(result.unavailable, true);
            assert.equal(result.score, 0.0);
            assert.ok(result.reasonUnavailable?.includes("timed out"));
            assert.ok(result.evidenceSummary.includes("not available"));
        });

        it("marks candidate unavailable: true when provider quota or budget cap is tripped", async () => {
            const quotaProvider: ILLMProvider = {
                getModelInfo: () => ({ provider: "groq", model: "llama-3.3-70b", isLocal: false }),
                checkHealth: async () => true,
                generate: async () => {
                    throw new ProviderQuotaError("groq", "Budget exceeded");
                },
            };

            const service = new CandidateVerifierService();
            const result = await service.evaluateStability(
                "SELECT id FROM customers;",
                "Find customers",
                { provider: quotaProvider }
            );

            assert.equal(result.available, false);
            assert.equal(result.unavailable, true);
            assert.equal(result.score, 0.0);
            assert.ok(result.reasonUnavailable?.includes("budget or rate quota exceeded"));
        });

        it("extracts SQL from various raw model output formats (JSON, markdown fences, raw text)", () => {
            const service = new CandidateVerifierService();

            // JSON format
            const jsonText = JSON.stringify({ sql: "SELECT id FROM orders;" });
            assert.equal(service.extractSqlFromRaw(jsonText), "SELECT id FROM orders;");

            // Markdown ```sql ... ```
            const fencedSql = "```sql\nSELECT * FROM products;\n```";
            assert.equal(service.extractSqlFromRaw(fencedSql), "SELECT * FROM products;");

            // Markdown ```json ... ```
            const fencedJson = '```json\n{"sql": "SELECT COUNT(*) FROM customers;"}\n```';
            assert.equal(service.extractSqlFromRaw(fencedJson), "SELECT COUNT(*) FROM customers;");

            // Direct raw SQL query
            const direct = "SELECT o.id FROM orders o WHERE o.status = 'completed';";
            assert.equal(service.extractSqlFromRaw(direct), direct);
        });
    });

    describe("Bounded Verifier Prompt & Semantic Agreement Verification", () => {
        it("returns high verifier score when LLM verifier confirms semantic agreement", async () => {
            let capturedPrompt = "";
            let capturedTimeoutMs: number | undefined;
            let capturedTemp: number | undefined;

            const mockProvider: ILLMProvider = {
                getModelInfo: () => ({ provider: "groq", model: "llama-3.3-70b", isLocal: false }),
                checkHealth: async () => true,
                generate: async (prompt, options) => {
                    capturedPrompt = prompt;
                    capturedTimeoutMs = options?.timeoutMs;
                    capturedTemp = options?.temperature;
                    return {
                        rawText: JSON.stringify({
                            agrees: true,
                            score: 0.95,
                            explanation: "SQL correctly computes sum of quantity * unit_price with completed status filter.",
                            discrepancies: [],
                        }),
                        promptTokens: 80,
                        completionTokens: 30,
                        latencyMs: 120,
                        model: "llama-3.3-70b",
                        provider: "groq",
                    };
                },
            };

            const service = new CandidateVerifierService();
            const primarySql = `
                SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue
                FROM orders o
                JOIN order_items oi ON o.id = oi.order_id
                WHERE o.status = 'completed'
            `;

            const result = await service.verifySemanticAgreement(
                primarySql,
                "What is total revenue for completed orders?",
                sampleRevenueIntent,
                { provider: mockProvider }
            );

            assert.equal(result.available, true);
            assert.equal(result.unavailable, false);
            assert.equal(result.agrees, true);
            assert.equal(result.score, 0.95);
            assert.deepEqual(result.discrepancies, []);
            assert.ok(result.evidenceSummary.includes("SQL correctly computes"));

            // Verify bounded prompt parameters
            assert.equal(capturedTimeoutMs, VERIFIER_TIMEOUT_CLOUD_MS);
            assert.equal(VERIFIER_TIMEOUT_CLOUD_MS, 5_000);
            assert.equal(capturedTemp, 0.0, "Verifier must use deterministic temperature 0.0");
            assert.ok(capturedPrompt.includes("Primary SQL Query Under Verification"));
            assert.ok(capturedPrompt.includes("revenue"));
            assert.ok(capturedPrompt.includes("orders.status"));
        });

        it("returns low score when verifier identifies semantic discrepancies", async () => {
            const mockProvider: ILLMProvider = {
                getModelInfo: () => ({ provider: "ollama", model: "qwen2.5-coder:7b", isLocal: true }),
                checkHealth: async () => true,
                generate: async () => {
                    return {
                        rawText: JSON.stringify({
                            agrees: false,
                            score: 0.30,
                            explanation: "Query omitted mandatory filter orders.status = 'completed'.",
                            discrepancies: ["Missing filter for completed order status"],
                        }),
                        promptTokens: 80,
                        completionTokens: 30,
                        latencyMs: 150,
                        model: "qwen2.5-coder:7b",
                        provider: "ollama",
                    };
                },
            };

            const service = new CandidateVerifierService();
            const result = await service.verifySemanticAgreement(
                "SELECT SUM(total_amount) FROM orders;",
                "What is revenue for completed orders?",
                sampleRevenueIntent,
                { provider: mockProvider }
            );

            assert.equal(result.available, true);
            assert.equal(result.unavailable, false);
            assert.equal(result.agrees, false);
            assert.equal(result.score, 0.30);
            assert.equal(result.discrepancies?.length, 1);
        });

        it("marks verifier unavailable: true when verifier times out without failing the query", async () => {
            const timeoutProvider: ILLMProvider = {
                getModelInfo: () => ({ provider: "ollama", model: "qwen2.5-coder:7b", isLocal: true }),
                checkHealth: async () => true,
                generate: async () => {
                    throw new ProviderTimeoutError("ollama", 10000);
                },
            };

            const service = new CandidateVerifierService();
            const result = await service.verifySemanticAgreement(
                "SELECT id FROM customers;",
                "Show customers",
                sampleRevenueIntent,
                { provider: timeoutProvider }
            );

            assert.equal(result.available, false);
            assert.equal(result.unavailable, true);
            assert.equal(result.score, 0.0);
            assert.ok(result.reasonUnavailable?.includes("timed out"));
            assert.ok(result.evidenceSummary.includes("timed out"));
        });

        it("falls back to deterministic verifier using semanticFindings when provider is absent", async () => {
            const service = new CandidateVerifierService();
            const criticalFindings: SemanticFinding[] = [
                {
                    code: "UNHANDLED_ORDER_STATUS",
                    severity: "CRITICAL",
                    message: "Missing mandatory filter orders.status = 'completed'",
                    repairable: true,
                },
            ];

            const result = await service.verifySemanticAgreement(
                "SELECT SUM(total_amount) FROM orders;",
                "Total revenue",
                sampleRevenueIntent,
                { semanticFindings: criticalFindings }
            );

            assert.equal(result.available, true);
            assert.equal(result.unavailable, false);
            assert.equal(result.agrees, false);
            assert.equal(result.score, 0.0);
            assert.ok(result.evidenceSummary.includes("1 critical semantic violation"));
        });

        it("evaluates deterministic verifier consensus properly across finding severities", () => {
            const service = new CandidateVerifierService();

            // No findings -> 1.0
            const clean = service.evaluateDeterministicVerifier([]);
            assert.equal(clean.score, 1.0);
            assert.equal(clean.agrees, true);

            // Warning only -> 0.75
            const warningOnly: SemanticFinding[] = [
                {
                    code: "JOIN_FANOUT_DUPLICATION",
                    severity: "WARNING",
                    message: "Potential fanout duplication",
                    repairable: false,
                },
            ];
            const warningResult = service.evaluateDeterministicVerifier(warningOnly);
            assert.equal(warningResult.score, 0.75);
            assert.equal(warningResult.agrees, true);

            // Critical finding -> 0.0
            const critical: SemanticFinding[] = [
                {
                    code: "WRONG_AGGREGATION",
                    severity: "CRITICAL",
                    message: "Expected AVG, found SUM",
                    repairable: true,
                },
            ];
            const criticalResult = service.evaluateDeterministicVerifier(critical);
            assert.equal(criticalResult.score, 0.0);
            assert.equal(criticalResult.agrees, false);
        });
    });

    describe("Unified Stability & Verifier Evaluation (evaluateBoth)", () => {
        it("returns both stability and verifier results in parallel", async () => {
            const mockProvider: ILLMProvider = {
                getModelInfo: () => ({ provider: "ollama", model: "qwen2.5-coder:7b", isLocal: true }),
                checkHealth: async () => true,
                generate: async (prompt) => {
                    if (prompt.includes("Verification Task")) {
                        return {
                            rawText: JSON.stringify({
                                agrees: true,
                                score: 1.0,
                                explanation: "Verified matches intent.",
                                discrepancies: [],
                            }),
                            promptTokens: 50,
                            completionTokens: 20,
                            latencyMs: 100,
                            model: "qwen2.5-coder:7b",
                            provider: "ollama",
                        };
                    }
                    // Candidate generation response
                    return {
                        rawText: JSON.stringify({
                            sql: "SELECT id, name FROM customers WHERE active = true;",
                        }),
                        promptTokens: 50,
                        completionTokens: 20,
                        latencyMs: 100,
                        model: "qwen2.5-coder:7b",
                        provider: "ollama",
                    };
                },
            };

            const service = new CandidateVerifierService();
            const primarySql = "SELECT id, name FROM customers WHERE active = true;";

            const { stability, verifier } = await service.evaluateBoth(
                primarySql,
                "Show active customers",
                {
                    rawQuestion: "Show active customers",
                    metric: "customer_count",
                    aggregation: "NONE",
                    dimensions: ["customers.id", "customers.name"],
                    filters: [{ column: "customers.active", operator: "=", value: true }],
                },
                { provider: mockProvider }
            );

            // Stability check
            assert.equal(stability.available, true);
            assert.equal(stability.unavailable, false);
            assert.equal(stability.score, 1.0);

            // Verifier check
            assert.equal(verifier.available, true);
            assert.equal(verifier.unavailable, false);
            assert.equal(verifier.score, 1.0);
            assert.equal(verifier.agrees, true);
        });
    });
});

