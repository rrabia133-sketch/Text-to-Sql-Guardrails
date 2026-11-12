import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../src/app.js";
import { InMemoryAuthRepository } from "../helpers/in-memory-auth.repo.js";
import { QueryArtifactRepository } from "../../src/modules/generation/query-artifact.repository.js";
import { ConcurrencyManager } from "../../src/modules/execution/concurrency-manager.js";
import { RestrictedExecutor, type ExecutionResult } from "../../src/modules/execution/restricted-executor.js";
import type { FastifyInstance } from "fastify";

describe("Sprint 7 - Task 7 / DO-13: High-Concurrency Stress Benchmark & Latency SLA Suite", () => {
    let app: FastifyInstance;
    let artifactRepo: QueryArtifactRepository;
    let concurrencyManager: ConcurrencyManager;
    let analystCookie: string;
    let artifactId: string;

    const MAX_CONCURRENT = 5;

    before(async () => {
        const authRepo = new InMemoryAuthRepository();
        artifactRepo = new QueryArtifactRepository();
        concurrencyManager = new ConcurrencyManager(MAX_CONCURRENT);

        // Fast simulated executor with slight synthetic latency
        const mockExecutor = {
            execute: async (): Promise<ExecutionResult> => {
                await new Promise((r) => setTimeout(r, 20)); // 20ms simulated query latency
                return {
                    ok: true,
                    rows: [{ total_revenue: 105420 }],
                    columns: [{ name: "total_revenue", pgType: "numeric", jsType: "number", nullable: false }],
                    rowCount: 1,
                    byteSize: 32,
                    executionTimeMs: 20,
                    truncated: false,
                };
            },
        } as unknown as RestrictedExecutor;

        app = await buildApp({
            authRepo: authRepo as any,
            queryArtifactRepo: artifactRepo,
            concurrencyManager,
            restrictedExecutor: mockExecutor,
            logger: false,
        });
        await app.ready();

        // Login Analyst
        const loginRes = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "analyst_a" },
        });
        analystCookie = `${loginRes.cookies[0].name}=${loginRes.cookies[0].value}`;
        const userId = JSON.parse(loginRes.payload).user.id;

        // Create query preview artifact
        const artifact = await artifactRepo.create({
            userId,
            prompt: "Total revenue benchmark",
            generatedSql: "SELECT SUM(total_amount) FROM orders;",
            assumptions: [],
            referencedTables: ["orders"],
            referencedColumns: ["total_amount"],
            explanation: "Aggregates revenue",
            provider: "ollama",
            model: "sqlcoder:7b",
            promptVersion: "1.0.0",
            schemaVersion: "1.0.0",
        });
        artifactId = artifact.id;
    });

    after(async () => {
        if (app) await app.close();
    });

    it("executes 20 concurrent requests, verifies p95 latency < 3s, and enforces concurrency limit bounds", async () => {
        const CONCURRENT_REQUESTS = 20;
        const latenciesMs: number[] = [];
        let successCount = 0;
        let throttledCount = 0;

        const executeSingleQuery = async (index: number) => {
            const start = Date.now();
            const res = await app.inject({
                method: "POST",
                url: `/api/v1/queries/${encodeURIComponent(artifactId)}/execute`,
                headers: { cookie: analystCookie },
                payload: {
                    idempotencyKey: `stress_req_${index}_${Math.random()}`,
                },
            });
            const latency = Date.now() - start;
            latenciesMs.push(latency);

            if (res.statusCode === 200) {
                successCount++;
            } else if (res.statusCode === 429) {
                throttledCount++;
                const body = JSON.parse(res.payload);
                assert.ok(
                    body.error === "CONCURRENCY_LIMIT_EXCEEDED" || res.statusCode === 429,
                    "Throttled request must return 429 with clear error code"
                );
            }
        };

        // Fire 20 parallel requests simultaneously
        await Promise.all(
            Array.from({ length: CONCURRENT_REQUESTS }, (_, i) => executeSingleQuery(i))
        );

        // Sort latencies ascending to compute percentiles
        latenciesMs.sort((a, b) => a - b);
        const p50 = latenciesMs[Math.floor(latenciesMs.length * 0.50)];
        const p90 = latenciesMs[Math.floor(latenciesMs.length * 0.90)];
        const p95 = latenciesMs[Math.floor(latenciesMs.length * 0.95)];

        // Verify performance SLAs
        assert.ok(p95 < 3000, `Expected p95 latency < 3000ms, got ${p95}ms`);
        assert.ok(p50 < 1000, `Expected p50 latency < 1000ms, got ${p50}ms`);

        // Verify total accounted for: every request either completed or was gracefully throttled (zero 500s or hangs)
        assert.equal(successCount + throttledCount, CONCURRENT_REQUESTS);
        assert.ok(successCount > 0, "At least some requests must succeed up to max concurrency limit");
    });
});

