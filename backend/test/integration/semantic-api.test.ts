import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../src/app.js";
import { InMemoryAuthRepository } from "../helpers/in-memory-auth.repo.js";
import { ProviderRouter } from "../../src/modules/providers/provider.router.js";
import { OllamaProvider } from "../../src/modules/providers/ollama.provider.js";
import { QueryArtifactRepository } from "../../src/modules/generation/query-artifact.repository.js";
import { SemanticRepository } from "../../src/modules/semantic/semantic.repository.js";
import type { FastifyInstance } from "fastify";

describe("Sprint 5 - Task 13: Fastify Semantic Validation & Confidence API Routes (US-11 / US-12)", () => {
    let app: FastifyInstance;
    let authRepo: InMemoryAuthRepository;
    let analystCookie: string;
    let queryArtifactRepo: QueryArtifactRepository;
    let semanticRepo: SemanticRepository;

    // Stateful mock provider behavior controlled per test scenario
    let nextResponses: Array<{ sql: string; referencedTables: string[]; referencedColumns: string[] }> = [];

    const mockOllama = new OllamaProvider({
        fetchFn: async (url) => {
            if (String(url).endsWith("/api/tags")) {
                return {
                    ok: true,
                    json: async () => ({ models: [{ name: "qwen2.5-coder:7b" }] }),
                } as any;
            }
            if (String(url).endsWith("/api/generate")) {
                const current = nextResponses.shift() || {
                    sql: "SELECT id, name FROM customers LIMIT 50;",
                    referencedTables: ["customers"],
                    referencedColumns: ["customers.id", "customers.name"],
                };
                return {
                    ok: true,
                    json: async () => ({
                        response: JSON.stringify({
                            sql: current.sql,
                            assumptions: ["Standard assumptions"],
                            referencedTables: current.referencedTables,
                            referencedColumns: current.referencedColumns,
                            explanation: "Generated query.",
                        }),
                        prompt_eval_count: 100,
                        eval_count: 45,
                        total_duration: 150_000_000,
                        done: true,
                    }),
                } as any;
            }
            throw new Error(`Unhandled mock URL: ${url}`);
        },
    });

    const mockRestrictedExecutor: any = {
        execute: async (sql: string) => ({
            ok: true,
            columns: [{ name: "total_revenue", pgType: "numeric", jsType: "number", nullable: false }],
            rows: [{ total_revenue: 12500.50 }],
            rowCount: 1,
            byteSize: 64,
            executionTimeMs: 14,
            truncated: false,
            sqlExecuted: sql,
        }),
    };

    before(async () => {
        authRepo = new InMemoryAuthRepository();
        queryArtifactRepo = new QueryArtifactRepository();
        semanticRepo = new SemanticRepository();

        const providerRouter = new ProviderRouter({
            mode: "local",
            ollamaProvider: mockOllama,
        });

        app = await buildApp({
            authRepo: authRepo as any,
            providerRouter,
            queryArtifactRepo,
            semanticRepo,
            restrictedExecutor: mockRestrictedExecutor,
        });
        await app.ready();

        const loginRes = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "analyst_a" },
        });
        assert.equal(loginRes.statusCode, 200);
        analystCookie = loginRes.cookies[0].name + "=" + loginRes.cookies[0].value;
    });

    after(async () => {
        await app.close();
    });

    it("POST /api/v1/queries returns HIGH confidence score, breakdown, and preview_ready state for valid SQL", async () => {
        nextResponses = [
            {
                sql: "SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue FROM orders o JOIN order_items oi ON o.id = oi.order_id WHERE o.status = 'completed' LIMIT 50;",
                referencedTables: ["orders", "order_items"],
                referencedColumns: ["orders.id", "orders.status", "order_items.order_id", "order_items.quantity", "order_items.unit_price"],
            },
        ];

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: analystCookie },
            payload: { question: "What is total revenue from completed orders?" },
        });

        assert.equal(res.statusCode, 201);
        const data = JSON.parse(res.body);

        assert.equal(data.status, "preview_ready");
        assert.equal(data.confidenceBand, "HIGH");
        assert.ok(data.confidenceScore >= 85, `Expected confidenceScore >= 85, got ${data.confidenceScore}`);
        assert.ok(data.confidenceBreakdown);
        assert.equal(data.confidenceBreakdown.intentSlotAgreement.weightedContribution, 35);
        assert.equal(data.confidenceBreakdown.glossaryAndJoinEvidence.weightedContribution, 30);
        assert.equal(data.confidenceBreakdown.verifierAgreement.weightedContribution, 20);
        assert.equal(data.confidenceBreakdown.candidateStability.available, false);
        assert.deepEqual(data.semanticFindings, []);
        assert.equal(data.confidenceResult.isHeuristic, true);

        // Verify GET /api/v1/queries/:id returns the complete confidence scorecard and semantic findings
        const getRes = await app.inject({
            method: "GET",
            url: `/api/v1/queries/${data.artifactId}`,
            headers: { cookie: analystCookie },
        });

        assert.equal(getRes.statusCode, 200);
        const fetched = JSON.parse(getRes.body);
        assert.equal(fetched.status, "preview_ready");
        assert.equal(fetched.confidenceScore, data.confidenceScore);
        assert.equal(fetched.confidenceBand, "HIGH");
        assert.ok(fetched.confidenceBreakdown);
        assert.deepEqual(fetched.semanticFindings, []);
    });

    it("POST /api/v1/queries executes bounded repair pass when repairable semantic mismatch is detected", async () => {
        // 1st response: omits WHERE o.status = 'completed' -> triggers UNHANDLED_ORDER_STATUS
        // 2nd response (repair pass): adds WHERE o.status = 'completed' -> succeeds!
        nextResponses = [
            {
                sql: "SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue FROM orders o JOIN order_items oi ON o.id = oi.order_id LIMIT 50;",
                referencedTables: ["orders", "order_items"],
                referencedColumns: ["orders.id", "order_items.order_id", "order_items.quantity", "order_items.unit_price"],
            },
            {
                sql: "SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue FROM orders o JOIN order_items oi ON o.id = oi.order_id WHERE o.status = 'completed' LIMIT 50;",
                referencedTables: ["orders", "order_items"],
                referencedColumns: ["orders.id", "orders.status", "order_items.order_id", "order_items.quantity", "order_items.unit_price"],
            },
        ];

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: analystCookie },
            payload: { question: "What is total revenue from completed orders?" },
        });

        assert.equal(res.statusCode, 201);
        const data = JSON.parse(res.body);

        assert.ok(data.repairAttempt, "Expected bounded repairAttempt to be recorded");
        assert.equal(data.repairAttempt.attemptNumber, 1);
        assert.equal(data.repairAttempt.success, true);
        assert.ok(data.repairAttempt.resolvedCodes.includes("UNHANDLED_ORDER_STATUS"));
        assert.equal(data.status, "preview_ready");
        assert.equal(data.confidenceBand, "HIGH");
        assert.ok(data.sql.includes("completed"));
    });

    it("POST /api/v1/queries marks artifact as preview_blocked when critical semantic error persists after repair", async () => {
        // Both initial and repair responses fail to include completed status filter
        nextResponses = [
            {
                sql: "SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue FROM orders o JOIN order_items oi ON o.id = oi.order_id LIMIT 50;",
                referencedTables: ["orders", "order_items"],
                referencedColumns: ["orders.id", "order_items.order_id", "order_items.quantity", "order_items.unit_price"],
            },
            {
                sql: "SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue FROM orders o JOIN order_items oi ON o.id = oi.order_id LIMIT 50;",
                referencedTables: ["orders", "order_items"],
                referencedColumns: ["orders.id", "order_items.order_id", "order_items.quantity", "order_items.unit_price"],
            },
        ];

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: analystCookie },
            payload: { question: "What is total revenue from completed orders?" },
        });

        assert.equal(res.statusCode, 201);
        const data = JSON.parse(res.body);

        assert.equal(data.status, "preview_blocked");
        assert.equal(data.confidenceBand, "BLOCKED");
        assert.ok(data.semanticFindings.length > 0);
        assert.equal(data.semanticFindings[0].code, "UNHANDLED_ORDER_STATUS");

        // Attempting to execute a preview_blocked artifact returns 403 BLOCKED_CONFIDENCE_BAND
        const execRes = await app.inject({
            method: "POST",
            url: `/api/v1/queries/${data.artifactId}/execute`,
            headers: { cookie: analystCookie },
            payload: {},
        });

        assert.equal(execRes.statusCode, 403);
        const execErr = JSON.parse(execRes.body);
        assert.equal(execErr.error, "BLOCKED_CONFIDENCE_BAND");
    });

    it("POST /api/v1/queries/:id/execute enforces review acknowledgement for preview_review artifacts", async () => {
        // Query with advisory warning (WRONG_AGGREGATION warning -> REVIEW band, 65 <= score < 85)
        nextResponses = [
            {
                sql: "SELECT status, COUNT(id) AS order_count FROM orders WHERE status = 'completed' GROUP BY status LIMIT 50;",
                referencedTables: ["orders"],
                referencedColumns: ["orders.id", "orders.status"],
            },
        ];

        const genRes = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: analystCookie },
            payload: { question: "Total orders and unique orders by status for completed orders" },
        });

        assert.equal(genRes.statusCode, 201);
        const genData = JSON.parse(genRes.body);
        assert.equal(genData.status, "preview_review");
        assert.equal(genData.confidenceBand, "REVIEW");
        assert.ok(genData.confidenceScore >= 65 && genData.confidenceScore < 85);

        // 1. Execution WITHOUT review acknowledgement fails with HTTP 400
        const execWithoutAck = await app.inject({
            method: "POST",
            url: `/api/v1/queries/${genData.artifactId}/execute`,
            headers: { cookie: analystCookie },
            payload: {},
        });

        assert.equal(execWithoutAck.statusCode, 400);
        const errBody = JSON.parse(execWithoutAck.body);
        assert.equal(errBody.error, "REVIEW_ACKNOWLEDGEMENT_REQUIRED");

        // 2. Execution WITH confirmed review acknowledgement succeeds with HTTP 200
        const execWithAck = await app.inject({
            method: "POST",
            url: `/api/v1/queries/${genData.artifactId}/execute`,
            headers: { cookie: analystCookie },
            payload: {
                acknowledgement: {
                    confirmed: true,
                    reviewedWarnings: ["WRONG_AGGREGATION"],
                },
            },
        });

        assert.equal(execWithAck.statusCode, 200);
        const execBody = JSON.parse(execWithAck.body);
        assert.equal(execBody.status, "completed");
        assert.equal(execBody.rowCount, 1);

        // Verify acknowledgement was persisted in SemanticRepository
        const savedMeta = await semanticRepo.getArtifactSemanticMetadata(genData.artifactId);
        assert.equal(savedMeta?.reviewAcknowledged, true);
        assert.ok(savedMeta?.acknowledgedAt);
    });
});
