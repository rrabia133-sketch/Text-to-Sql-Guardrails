import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../src/app.js";
import { InMemoryAuthRepository } from "../helpers/in-memory-auth.repo.js";
import { ProviderRouter } from "../../src/modules/providers/provider.router.js";
import { OllamaProvider } from "../../src/modules/providers/ollama.provider.js";
import { GroqProvider } from "../../src/modules/providers/groq.provider.js";
import { QueryArtifactRepository } from "../../src/modules/generation/query-artifact.repository.js";
import type { FastifyInstance } from "fastify";

describe("DO-05 Task 4: Automated Private-Mode Egress Verification Test (Airgap Guard)", () => {
    let app: FastifyInstance;
    let authRepo: InMemoryAuthRepository;
    let cookieAlice: string;

    let publicEgressAttempted = false;
    let externalUrlsRequested: string[] = [];

    // Mock failing Ollama
    const failingOllama = new OllamaProvider({
        fetchFn: async () => {
            throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
        },
    });

    // Spy Groq adapter that detects ANY external cloud egress
    const spyGroq = new GroqProvider({
        apiKey: "gsk_secret",
        fetchFn: async (url) => {
            publicEgressAttempted = true;
            externalUrlsRequested.push(String(url));
            return { ok: true, json: async () => ({}) } as any;
        },
    });

    before(async () => {
        authRepo = new InMemoryAuthRepository();

        // Router strictly configured in LOCAL mode
        const providerRouter = new ProviderRouter({
            mode: "local",
            ollamaProvider: failingOllama,
            groqProvider: spyGroq,
        });

        app = await buildApp({
            authRepo: authRepo as any,
            providerRouter,
            queryArtifactRepo: new QueryArtifactRepository(),
        });
        await app.ready();

        const loginRes = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "analyst_a" },
        });
        cookieAlice = loginRes.cookies[0].name + "=" + loginRes.cookies[0].value;
    });

    after(async () => {
        await app.close();
    });

    it("in local airgap mode, local Ollama failure returns 503 and executes ZERO cloud network calls", async () => {
        publicEgressAttempted = false;
        externalUrlsRequested = [];

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: cookieAlice },
            payload: { question: "Calculate gross revenue for 2026" },
        });

        // 1. Must fail with HTTP 503 Service Unavailable
        assert.equal(res.statusCode, 503);
        const err = JSON.parse(res.body);
        assert.ok(
            err.message.includes("Local Ollama daemon is unreachable"),
            "Error must identify local daemon failure without silent fallback"
        );

        // 2. Strict Privacy Verification: Zero outbound requests to Groq or public APIs
        assert.equal(
            publicEgressAttempted,
            false,
            "CRITICAL PRIVACY VIOLATION: Cloud provider was called during local-only mode!"
        );
        assert.deepEqual(externalUrlsRequested, []);
    });

    it("in local airgap mode, explicit user preference for 'groq' is blocked with 403 PolicyViolationError before any network attempt", async () => {
        publicEgressAttempted = false;
        externalUrlsRequested = [];

        const res = await app.inject({
            method: "POST",
            url: "/api/v1/queries",
            headers: { cookie: cookieAlice },
            payload: {
                question: "Show customers",
                providerPreference: "groq",
            },
        });

        // 1. Must reject with 403 Forbidden
        assert.equal(res.statusCode, 403);
        const err = JSON.parse(res.body);
        assert.ok(err.message.includes("strictly prohibited in local airgap mode"));

        // 2. Zero network egress
        assert.equal(publicEgressAttempted, false);
        assert.deepEqual(externalUrlsRequested, []);
    });
});
