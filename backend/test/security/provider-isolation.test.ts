import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../src/app.js";
import { InMemoryAuthRepository } from "../helpers/in-memory-auth.repo.js";
import { ProviderRouter } from "../../src/modules/providers/provider.router.js";
import { OllamaProvider } from "../../src/modules/providers/ollama.provider.js";
import { GroqProvider } from "../../src/modules/providers/groq.provider.js";
import { BudgetService } from "../../src/modules/providers/budget.service.js";
import { QueryArtifactRepository } from "../../src/modules/generation/query-artifact.repository.js";
import type { FastifyInstance } from "fastify";

describe("Task 17: Security Isolation, Cross-User Guard, and Budget Cap Tests", () => {
    let app: FastifyInstance;
    let authRepo: InMemoryAuthRepository;
    let queryArtifactRepo: QueryArtifactRepository;
    let budgetService: BudgetService;

    let cookieAlice: string;
    let cookieBob: string;

    const mockOllama = new OllamaProvider({
        fetchFn: async (url) => {
            if (String(url).endsWith("/api/tags")) {
                return {
                    ok: true,
                    json: async () => ({ models: [{ name: "qwen2.5-coder:7b" }] }),
                } as any;
            }
            return {
                ok: true,
                json: async () => ({
                    response: JSON.stringify({
                        sql: "SELECT id FROM orders LIMIT 10;",
                        assumptions: [],
                        referencedTables: ["orders"],
                        referencedColumns: ["orders.id"],
                        explanation: "Queries orders.",
                    }),
                    prompt_eval_count: 50,
                    eval_count: 20,
                    total_duration: 100_000_000,
                }),
            } as any;
        },
    });

    let groqNetworkCalled = false;
    const mockGroq = new GroqProvider({
        apiKey: "gsk_test_key",
        fetchFn: async (url) => {
            groqNetworkCalled = true;
            return {
                ok: true,
                json: async () => ({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    sql: "SELECT id FROM products LIMIT 10;",
                                    assumptions: [],
                                    referencedTables: ["products"],
                                    referencedColumns: ["products.id"],
                                    explanation: "Products.",
                                }),
                            },
                        },
                    ],
                    usage: { prompt_tokens: 50, completion_tokens: 20 },
                }),
            } as any;
        },
    });

    before(async () => {
        authRepo = new InMemoryAuthRepository();
        queryArtifactRepo = new QueryArtifactRepository();
        budgetService = new BudgetService(null, 5.0);

        const providerRouter = new ProviderRouter({
            mode: "hybrid",
            ollamaProvider: mockOllama,
            groqProvider: mockGroq,
            budgetService,
        });

        app = await buildApp({
            authRepo: authRepo as any,
            providerRouter,
            queryArtifactRepo,
        });
        await app.ready();

        // Login Analyst Alice
        const aliceRes = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "analyst_a" },
        });
        cookieAlice = aliceRes.cookies[0].name + "=" + aliceRes.cookies[0].value;

        // Login Analyst Bob
        const bobRes = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "analyst_b" },
        });
        cookieBob = bobRes.cookies[0].name + "=" + bobRes.cookies[0].value;
    });

    after(async () => {
        await app.close();
    });

    it("ownership isolation: Analyst Bob cannot inspect Analyst Alice's query artifact (returns 404)", async () => {
        // Step 1: Alice creates an artifact
        const genRes = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: cookieAlice },
            payload: { question: "Alice private analytical request" },
        });
        assert.equal(genRes.statusCode, 201);
        const aliceArtifact = JSON.parse(genRes.body);

        // Step 2: Alice can read her artifact
        const aliceReadRes = await app.inject({
            method: "GET",
            url: `/api/v1/queries/${aliceArtifact.artifactId}`,
            headers: { cookie: cookieAlice },
        });
        assert.equal(aliceReadRes.statusCode, 200);

        // Step 3: Bob attempts to read Alice's artifact by ID -> MUST return 404
        const bobReadRes = await app.inject({
            method: "GET",
            url: `/api/v1/queries/${aliceArtifact.artifactId}`,
            headers: { cookie: cookieBob },
        });
        assert.equal(bobReadRes.statusCode, 404);
        const body = JSON.parse(bobReadRes.body);
        assert.equal(body.error, "Not Found");
        assert.ok(!body.sql, "No SQL or metadata must be leaked to cross-user requester!");
    });

    it("budget cap enforcement: returns 429 and aborts Groq call BEFORE making network request", async () => {
        groqNetworkCalled = false;
        // Simulate budget spent reaching $5.00 cap
        budgetService.setSimulatedTodaySpend(5.00);

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: cookieAlice },
            payload: {
                question: "Revenue analysis via cloud model",
                providerPreference: "groq",
            },
        });

        assert.equal(res.statusCode, 429);
        const err = JSON.parse(res.body);
        assert.ok(err.message.includes("Daily cloud budget cap"));
        assert.equal(groqNetworkCalled, false, "Zero outbound network calls must be made when cap reached!");
    });
});
