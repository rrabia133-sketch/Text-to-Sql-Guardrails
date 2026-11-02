import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../src/app.js";
import { InMemoryAuthRepository } from "../helpers/in-memory-auth.repo.js";
import { ProviderRouter } from "../../src/modules/providers/provider.router.js";
import { OllamaProvider } from "../../src/modules/providers/ollama.provider.js";
import { QueryArtifactRepository } from "../../src/modules/generation/query-artifact.repository.js";
import { SemanticRepository } from "../../src/modules/semantic/semantic.repository.js";
import type { FastifyInstance } from "fastify";

describe("Sprint 5 - Task 17: End-to-End Generation to Semantic Review & Execution Suite (US-11 / US-12 / DO-07)", () => {
    let app: FastifyInstance;
    let authRepo: InMemoryAuthRepository;
    let analystCookie: string;
    let queryArtifactRepo: QueryArtifactRepository;
    let semanticRepo: SemanticRepository;

    let nextResponses: Array<{
        sql: string;
        referencedTables: string[];
        referencedColumns: string[];
    }> = [];

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
                            assumptions: ["Grounded schema assumption"],
                            referencedTables: current.referencedTables,
                            referencedColumns: current.referencedColumns,
                            explanation: "End-to-end generated SQL query.",
                        }),
                        prompt_eval_count: 110,
                        eval_count: 42,
                        total_duration: 140_000_000,
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
            columns: [{ name: "result_metric", pgType: "numeric", jsType: "number", nullable: false }],
            rows: [{ result_metric: 42 }],
            rowCount: 1,
            byteSize: 48,
            executionTimeMs: 11,
            sqlExecuted: sql,
            truncated: false,
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
        if (app) await app.close();
    });

    it("Flow 1 & 5: Full pipeline for HIGH confidence query -> reaches preview_ready and executes immediately without extra acknowledgement", async () => {
        nextResponses = [
            {
                sql: "SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue FROM orders o JOIN order_items oi ON o.id = oi.order_id WHERE o.status = 'completed' LIMIT 50;",
                referencedTables: ["orders", "order_items"],
                referencedColumns: [
                    "orders.id",
                    "orders.status",
                    "order_items.order_id",
                    "order_items.quantity",
                    "order_items.unit_price",
                ],
            },
        ];

        // 1. Question -> Intent -> Generation -> AST Guardrails -> Semantic Validation -> Confidence -> Preview
        const genRes = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: analystCookie },
            payload: { question: "What is our total revenue from completed orders?" },
        });

        assert.equal(genRes.statusCode, 201);
        const preview = JSON.parse(genRes.body);
        assert.equal(preview.status, "preview_ready");
        assert.equal(preview.confidenceBand, "HIGH");
        assert.ok(preview.confidenceScore >= 85);
        assert.equal(preview.semanticFindings.length, 0);
        assert.ok(preview.confidenceBreakdown);

        // 2. Execute immediately without acknowledgement
        const execRes = await app.inject({
            method: "POST",
            url: `/api/v1/queries/${preview.artifactId}/execute`,
            headers: { cookie: analystCookie },
            payload: {},
        });

        assert.equal(execRes.statusCode, 200);
        const execData = JSON.parse(execRes.body);
        assert.equal(execData.status, "completed");
        assert.equal(execData.rowCount, 1);
    });

    it("Flow 2: Bounded repair flow -> initial faulty SQL is repaired automatically in 1 attempt and reaches preview_ready", async () => {
        nextResponses = [
            // Primary attempt omits WHERE o.status = 'completed' -> triggers UNHANDLED_ORDER_STATUS (repairable)
            {
                sql: "SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue FROM orders o JOIN order_items oi ON o.id = oi.order_id LIMIT 50;",
                referencedTables: ["orders", "order_items"],
                referencedColumns: ["orders.id", "order_items.order_id", "order_items.quantity", "order_items.unit_price"],
            },
            // Bounded 1-pass repair adds WHERE o.status = 'completed'
            {
                sql: "SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue FROM orders o JOIN order_items oi ON o.id = oi.order_id WHERE o.status = 'completed' LIMIT 50;",
                referencedTables: ["orders", "order_items"],
                referencedColumns: ["orders.id", "orders.status", "order_items.order_id", "order_items.quantity", "order_items.unit_price"],
            },
        ];

        const genRes = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: analystCookie },
            payload: { question: "What is our total revenue from completed orders?" },
        });

        assert.equal(genRes.statusCode, 201);
        const preview = JSON.parse(genRes.body);
        assert.equal(preview.status, "preview_ready");
        assert.equal(preview.confidenceBand, "HIGH");
        assert.ok(preview.sql.includes("status = ('completed')"));

        const meta = await semanticRepo.getArtifactSemanticMetadata(preview.artifactId);
        assert.equal(meta?.repairAttempts, 1);
    });

    it("Flow 3: Critical unrepairable mismatch -> reaches preview_blocked and cannot be executed via API", async () => {
        nextResponses = [
            // Primary attempt has critical glossary formula mismatch + missing status
            {
                sql: "SELECT SUM(oi.unit_price) AS total_revenue FROM orders o JOIN order_items oi ON o.id = oi.order_id LIMIT 50;",
                referencedTables: ["orders", "order_items"],
                referencedColumns: ["orders.id", "order_items.order_id", "order_items.unit_price"],
            },
            // Repair attempt still fails critical rules
            {
                sql: "SELECT SUM(oi.unit_price) AS total_revenue FROM orders o JOIN order_items oi ON o.id = oi.order_id LIMIT 50;",
                referencedTables: ["orders", "order_items"],
                referencedColumns: ["orders.id", "order_items.order_id", "order_items.unit_price"],
            },
        ];

        const genRes = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: analystCookie },
            payload: { question: "What is our total revenue from completed orders?" },
        });

        assert.equal(genRes.statusCode, 201);
        const preview = JSON.parse(genRes.body);
        assert.equal(preview.status, "preview_blocked");
        assert.equal(preview.confidenceBand, "BLOCKED");

        const execRes = await app.inject({
            method: "POST",
            url: `/api/v1/queries/${preview.artifactId}/execute`,
            headers: { cookie: analystCookie },
            payload: {
                acknowledgement: { confirmed: true, reviewedWarnings: ["GLOSSARY_FORMULA_MISMATCH"] },
            },
        });

        assert.equal(execRes.statusCode, 403);
        const errBody = JSON.parse(execRes.body);
        assert.equal(errBody.error, "BLOCKED_CONFIDENCE_BAND");
    });

    it("Flow 4: Medium confidence query -> reaches preview_review; fails with 400 without acknowledgement; succeeds with acknowledgement", async () => {
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
        const preview = JSON.parse(genRes.body);
        assert.equal(preview.status, "preview_review");
        assert.equal(preview.confidenceBand, "REVIEW");
        assert.ok(preview.confidenceScore >= 65 && preview.confidenceScore < 85);

        // Execute without acknowledgement -> 400
        const unackRes = await app.inject({
            method: "POST",
            url: `/api/v1/queries/${preview.artifactId}/execute`,
            headers: { cookie: analystCookie },
            payload: {},
        });
        assert.equal(unackRes.statusCode, 400);
        assert.equal(JSON.parse(unackRes.body).error, "REVIEW_ACKNOWLEDGEMENT_REQUIRED");

        // Execute with acknowledgement -> 200
        const ackRes = await app.inject({
            method: "POST",
            url: `/api/v1/queries/${preview.artifactId}/execute`,
            headers: { cookie: analystCookie },
            payload: {
                acknowledgement: {
                    confirmed: true,
                    reviewedWarnings: ["WRONG_AGGREGATION"],
                    analystNote: "Reviewed plain count vs distinct count for order IDs",
                },
            },
        });
        assert.equal(ackRes.statusCode, 200);
        assert.equal(JSON.parse(ackRes.body).status, "completed");
    });
});
