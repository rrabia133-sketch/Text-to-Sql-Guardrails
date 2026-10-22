import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../src/app.js";
import { InMemoryAuthRepository } from "../helpers/in-memory-auth.repo.js";
import { ProviderRouter } from "../../src/modules/providers/provider.router.js";
import { OllamaProvider } from "../../src/modules/providers/ollama.provider.js";
import { QueryArtifactRepository } from "../../src/modules/generation/query-artifact.repository.js";
import type { FastifyInstance } from "fastify";

describe("Task 15: Fastify Generation, Provider, and Schema API Routes (US-06 / US-07 / US-08)", () => {
    let app: FastifyInstance;
    let authRepo: InMemoryAuthRepository;
    let analystCookie: string;
    let queryArtifactRepo: QueryArtifactRepository;

    const mockOllama = new OllamaProvider({
        fetchFn: async (url) => {
            if (String(url).endsWith("/api/tags")) {
                return {
                    ok: true,
                    json: async () => ({ models: [{ name: "qwen2.5-coder:7b" }] }),
                } as any;
            }
            if (String(url).endsWith("/api/generate")) {
                return {
                    ok: true,
                    json: async () => ({
                        response: JSON.stringify({
                            sql: "SELECT id, name FROM customers LIMIT 50;",
                            assumptions: ["Standard 50 limit"],
                            referencedTables: ["customers"],
                            referencedColumns: ["customers.id", "customers.name"],
                            explanation: "Returns top 50 customers.",
                        }),
                        prompt_eval_count: 90,
                        eval_count: 45,
                        total_duration: 200_000_000,
                        done: true,
                    }),
                } as any;
            }
            throw new Error(`Unhandled mock: ${url}`);
        },
    });

    before(async () => {
        authRepo = new InMemoryAuthRepository();
        queryArtifactRepo = new QueryArtifactRepository();

        const providerRouter = new ProviderRouter({
            mode: "local",
            ollamaProvider: mockOllama,
        });

        app = await buildApp({
            authRepo: authRepo as any,
            providerRouter,
            queryArtifactRepo,
        });
        await app.ready();

        // Login as demo analyst
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

    it("rejects unauthenticated calls to all endpoints with 401", async () => {
        const schemaRes = await app.inject({ method: "GET", url: "/api/v1/schema" });
        assert.equal(schemaRes.statusCode, 401);

        const providersRes = await app.inject({ method: "GET", url: "/api/v1/providers" });
        assert.equal(providersRes.statusCode, 401);

        const queryRes = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            payload: { question: "What is revenue?" },
        });
        assert.equal(queryRes.statusCode, 401);
    });

    it("GET /api/v1/schema returns sanitized tables and versioned glossary for authenticated user", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/api/v1/schema",
            headers: { cookie: analystCookie },
        });

        assert.equal(res.statusCode, 200);
        const data = JSON.parse(res.body);
        assert.ok(data.catalog);
        assert.ok(data.glossary);
        assert.equal(data.glossaryVersion, "1.0.0");
        assert.deepEqual(Object.keys(data.catalog.tables).sort(), [
            "customers",
            "order_items",
            "orders",
            "products",
        ]);
    });

    it("GET /api/v1/providers returns available providers and privacy mode", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/api/v1/providers",
            headers: { cookie: analystCookie },
        });

        assert.equal(res.statusCode, 200);
        const data = JSON.parse(res.body);
        assert.equal(data.activeMode, "local");
        assert.deepEqual(data.allowedProviders, ["ollama"]);
        assert.equal(data.providers.length, 1);
        assert.equal(data.providers[0].provider, "ollama");
        assert.ok(data.dailyBudget);
    });

    it("POST /api/v1/queries validates input length and rejects whitespace/empty", async () => {
        const emptyRes = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: analystCookie },
            payload: { question: "    " },
        });
        assert.equal(emptyRes.statusCode, 400);

        const longRes = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: analystCookie },
            payload: { question: "a".repeat(501) },
        });
        assert.equal(longRes.statusCode, 400);
    });

    it("POST /api/v1/queries returns clarification dialog for ambiguous input", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: analystCookie },
            payload: { question: "Who are our best customers?" },
        });

        assert.equal(res.statusCode, 200);
        const data = JSON.parse(res.body);
        assert.equal(data.type, "clarification");
        assert.equal(data.reasonCode, "AMBIGUOUS_METRIC");
        assert.ok(data.clarificationSessionId);
        assert.ok(data.options.length >= 2);
    });

    it("POST /api/v1/queries successfully generates query preview and persists artifact", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: analystCookie },
            payload: { question: "Show all customers in the West region" },
        });

        assert.equal(res.statusCode, 201);
        const data = JSON.parse(res.body);
        assert.equal(data.type, "generation");
        assert.equal(data.status, "preview");
        assert.ok(data.artifactId);
        assert.ok(data.sql.includes("SELECT"));
        assert.deepEqual(data.referencedTables, ["customers"]);
        assert.equal(data.provider, "ollama");
        assert.ok(data.versions.promptVersion);
        assert.ok(data.versions.schemaVersion);

        // Verify GET /api/v1/queries/:id retrieves the created artifact
        const getRes = await app.inject({
            method: "GET",
            url: `/api/v1/queries/${data.artifactId}`,
            headers: { cookie: analystCookie },
        });

        assert.equal(getRes.statusCode, 200);
        const fetched = JSON.parse(getRes.body);
        assert.equal(fetched.artifactId, data.artifactId);
        assert.equal(fetched.sql, data.sql);
    });

    it("POST /api/v1/queries resumes clarification session and generates preview", async () => {
        // Step 1: Trigger clarification
        const clarRes = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: analystCookie },
            payload: { question: "Who are our best customers?" },
        });
        const clarData = JSON.parse(clarRes.body);

        // Step 2: Resume with selected option
        const resumeRes = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: analystCookie },
            payload: {
                question: "Who are our best customers?",
                clarificationSessionId: clarData.clarificationSessionId,
                selectedClarificationOption: "metric_revenue",
            },
        });

        assert.equal(resumeRes.statusCode, 201);
        const genData = JSON.parse(resumeRes.body);
        assert.equal(genData.type, "generation");
        assert.equal(genData.status, "preview");
    });
});
