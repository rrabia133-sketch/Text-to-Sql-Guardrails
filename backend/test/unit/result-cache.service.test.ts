import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { InMemoryAuthRepository } from "../helpers/in-memory-auth.repo.js";
import { QueryArtifactRepository } from "../../src/modules/generation/query-artifact.repository.js";
import { ExecutionRepository } from "../../src/modules/execution/execution.repository.js";
import { ArtifactGate } from "../../src/modules/execution/artifact-gate.js";
import { ConcurrencyManager } from "../../src/modules/execution/concurrency-manager.js";
import { CancellationService } from "../../src/modules/execution/cancellation.service.js";
import { RestrictedExecutor, type ExecutionResult } from "../../src/modules/execution/restricted-executor.js";
import { AuditLogger } from "../../src/modules/execution/audit-logger.js";
import { ResultCacheService } from "../../src/modules/execution/result-cache.service.js";
import type { ExecutionResultResponse } from "@text2sql/contracts";

describe("Sprint 6 - Task 4: Ephemeral execution result store (15-minute TTL) & ownership lookup (US-14 / US-15 / DO-08)", () => {
    let service: ResultCacheService;

    const sampleResult: ExecutionResultResponse = {
        executionId: "exec_test_001",
        artifactId: "art_test_001",
        status: "completed",
        columns: [
            { name: "id", pgType: "int4", jsType: "number", nullable: false },
            { name: "name", pgType: "varchar", jsType: "string", nullable: false },
            { name: "revenue", pgType: "numeric", jsType: "number", nullable: true },
        ],
        rows: [
            { id: 1, name: "Alice", revenue: 1500.5 },
            { id: 2, name: "Bob", revenue: 2300.0 },
        ],
        rowCount: 2,
        byteSize: 256,
        executionTimeMs: 15,
        truncated: false,
        executedAt: new Date().toISOString(),
    };

    beforeEach(() => {
        service = new ResultCacheService();
    });

    describe("1. In-Memory Storage & Owner Lookup", () => {
        it("stores and retrieves result for the owning user within TTL", () => {
            service.setExecutionResult("exec_test_001", "usr_owner", "art_test_001", sampleResult);

            const lookup = service.getExecutionResult("exec_test_001", "usr_owner");
            assert.equal(lookup.ok, true);
            assert.equal(lookup.status, "FOUND");
            assert.ok(lookup.result);
            assert.equal(lookup.result.executionId, "exec_test_001");
            assert.equal(lookup.result.rowCount, 2);
            assert.deepEqual(lookup.result.columns, sampleResult.columns);
            assert.ok(lookup.remainingTtlMs! > 0 && lookup.remainingTtlMs! <= ResultCacheService.DEFAULT_TTL_MS);
        });

        it("returns EXECUTION_NOT_FOUND when execution result does not exist", () => {
            const lookup = service.getExecutionResult("exec_non_existent", "usr_owner");
            assert.equal(lookup.ok, false);
            assert.equal(lookup.status, "NOT_FOUND");
            assert.equal(lookup.errorCode, "EXECUTION_NOT_FOUND");
        });

        it("enforces tenant ownership isolation and rejects non-owner lookup with FORBIDDEN", () => {
            service.setExecutionResult("exec_test_001", "usr_owner", "art_test_001", sampleResult);

            const lookup = service.getExecutionResult("exec_test_001", "usr_different_user");
            assert.equal(lookup.ok, false);
            assert.equal(lookup.status, "FORBIDDEN");
            assert.equal(lookup.errorCode, "FORBIDDEN");
            assert.match(lookup.errorMessage!, /belongs to another user/i);
        });
    });

    describe("2. Memory Bounds Enforcement (Row & Byte Caps)", () => {
        it("clamps row count to MAX_CACHED_ROWS (500) and marks result truncated when exceeding limit", () => {
            // Generate 600 rows
            const oversizedRows = Array.from({ length: 600 }, (_, i) => ({
                id: i + 1,
                name: `Item ${i + 1}`,
                revenue: (i + 1) * 10,
            }));

            const largeResult: ExecutionResultResponse = {
                ...sampleResult,
                rows: oversizedRows,
                rowCount: 600,
                truncated: false,
            };

            const entry = service.setExecutionResult("exec_large", "usr_owner", "art_large", largeResult);
            assert.equal(entry.result.rows.length, 500, "Should clamp rows to 500 maximum");
            assert.equal(entry.result.rowCount, 500);
            assert.equal(entry.result.truncated, true, "Should mark truncated = true");

            const lookup = service.getExecutionResult("exec_large", "usr_owner");
            assert.equal(lookup.ok, true);
            assert.equal(lookup.result!.rows.length, 500);
            assert.equal(lookup.result!.truncated, true);
        });

        it("flags result as truncated when byteSize exceeds MAX_CACHED_BYTES (1 MiB)", () => {
            const bigByteResult: ExecutionResultResponse = {
                ...sampleResult,
                byteSize: 1024 * 1024 + 100, // > 1 MiB
                truncated: false,
            };

            const entry = service.setExecutionResult("exec_bytes", "usr_owner", "art_bytes", bigByteResult);
            assert.equal(entry.result.truncated, true, "Should mark truncated = true for >1 MiB payloads");
        });
    });

    describe("3. Deterministic 15-Minute Expiration & Sweeper", () => {
        it("returns RESULT_EXPIRED and auto-evicts from memory when TTL has elapsed", async () => {
            // Create service with 20ms TTL for testing
            const shortTtlService = new ResultCacheService(20);
            shortTtlService.setExecutionResult("exec_short_ttl", "usr_owner", "art_short", sampleResult, 20);

            // Wait 35ms for TTL to lapse
            await new Promise((resolve) => setTimeout(resolve, 35));

            const lookup1 = shortTtlService.getExecutionResult("exec_short_ttl", "usr_owner");
            assert.equal(lookup1.ok, false);
            assert.equal(lookup1.status, "EXPIRED");
            assert.equal(lookup1.errorCode, "RESULT_EXPIRED");
            assert.match(lookup1.errorMessage!, /expired/i);

            // Entry must be deleted on expired access, so subsequent lookup returns EXECUTION_NOT_FOUND
            const lookup2 = shortTtlService.getExecutionResult("exec_short_ttl", "usr_owner");
            assert.equal(lookup2.ok, false);
            assert.equal(lookup2.status, "NOT_FOUND");
            assert.equal(lookup2.errorCode, "EXECUTION_NOT_FOUND");
        });

        it("evicts expired entries across both execution and idempotency caches on evictExpired() sweep", async () => {
            const shortTtlService = new ResultCacheService(25);
            shortTtlService.setExecutionResult("exec_sweep_1", "usr_owner", "art_1", sampleResult, 25);
            shortTtlService.setIdempotentResult("usr_owner", "art_1", "idem-sweep-key", sampleResult, 25);

            assert.equal(shortTtlService.size().executions, 1);
            assert.equal(shortTtlService.size().idempotency, 1);

            // Wait for expiration
            await new Promise((resolve) => setTimeout(resolve, 35));

            const swept = shortTtlService.evictExpired();
            assert.equal(swept.executionEvicted, 1);
            assert.equal(swept.idempotencyEvicted, 1);
            assert.equal(shortTtlService.size().executions, 0);
            assert.equal(shortTtlService.size().idempotency, 0);
        });
    });

    describe("4. Fastify GET /api/v1/executions/:id/results Route Integration", () => {
        let app: FastifyInstance;
        let authRepo: InMemoryAuthRepository;
        let routeRepo: QueryArtifactRepository;
        let executionRepo: ExecutionRepository;
        let resultCache: ResultCacheService;
        let userACookie: string;
        let userBCookie: string;
        let userAId: string;
        let userBId: string;

        before(async () => {
            authRepo = new InMemoryAuthRepository();
            routeRepo = new QueryArtifactRepository();
            executionRepo = new ExecutionRepository();
            const gate = new ArtifactGate(routeRepo);
            const concurrencyManager = new ConcurrencyManager();
            const cancellationService = new CancellationService();
            const auditLogger = new AuditLogger();
            resultCache = new ResultCacheService();

            const mockExecutor = {
                execute: async (): Promise<ExecutionResult> => ({
                    ok: true,
                    rows: [{ id: 1 }],
                    columns: [{ name: "id", pgType: "int4", jsType: "number", nullable: false }],
                    rowCount: 1,
                    byteSize: 64,
                    executionTimeMs: 10,
                    truncated: false,
                }),
            } as unknown as RestrictedExecutor;

            app = await buildApp({
                authRepo: authRepo as any,
                queryArtifactRepo: routeRepo,
                executionRepo,
                artifactGate: gate,
                concurrencyManager,
                cancellationService,
                restrictedExecutor: mockExecutor,
                auditLogger,
                resultCacheService: resultCache,
            });
            await app.ready();

            // Login Analyst Alice
            const loginResA = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { username: "analyst_a" },
            });
            userACookie = `${loginResA.cookies[0].name}=${loginResA.cookies[0].value}`;
            userAId = JSON.parse(loginResA.payload).user.id;

            // Login Analyst Bob
            const loginResB = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { username: "analyst_b" },
            });
            userBCookie = `${loginResB.cookies[0].name}=${loginResB.cookies[0].value}`;
            userBId = JSON.parse(loginResB.payload).user.id;
        });

        after(async () => {
            if (app) await app.close();
        });

        it("returns HTTP 200 with cached rows and columns for valid owned execution", async () => {
            const execId = "exec_alice_cached_1";
            resultCache.setExecutionResult(execId, userAId, "art_alice_1", sampleResult);

            const res = await app.inject({
                method: "GET",
                url: `/api/v1/executions/${execId}/results`,
                headers: { cookie: userACookie },
            });

            assert.equal(res.statusCode, 200);
            const body = JSON.parse(res.payload);
            assert.equal(body.executionId, "exec_test_001");
            assert.equal(body.rowCount, 2);
            assert.equal(body.rows.length, 2);
        });

        it("returns HTTP 403 Forbidden when analyst attempts to access another user's execution results", async () => {
            const execId = "exec_alice_private";
            resultCache.setExecutionResult(execId, userAId, "art_alice_priv", sampleResult);

            // Analyst Bob attempts to access Alice's execution results
            const res = await app.inject({
                method: "GET",
                url: `/api/v1/executions/${execId}/results`,
                headers: { cookie: userBCookie },
            });

            assert.equal(res.statusCode, 403);
            const body = JSON.parse(res.payload);
            assert.equal(body.error, "FORBIDDEN");
            assert.match(body.message, /belongs to another user/i);
        });

        it("returns HTTP 410 Gone with RESULT_EXPIRED when cached result has passed 15m TTL", async () => {
            const execId = "exec_alice_expired";
            // Store with 10ms TTL
            resultCache.setExecutionResult(execId, userAId, "art_alice_exp", sampleResult, 10);

            // Wait 25ms
            await new Promise((resolve) => setTimeout(resolve, 25));

            const res = await app.inject({
                method: "GET",
                url: `/api/v1/executions/${execId}/results`,
                headers: { cookie: userACookie },
            });

            assert.equal(res.statusCode, 410);
            const body = JSON.parse(res.payload);
            assert.equal(body.error, "RESULT_EXPIRED");
            assert.match(body.message, /has expired/i);
        });

        it("returns HTTP 404 Not Found for non-existent execution result", async () => {
            const res = await app.inject({
                method: "GET",
                url: `/api/v1/executions/exec_ghost_never_existed/results`,
                headers: { cookie: userACookie },
            });

            assert.equal(res.statusCode, 404);
            const body = JSON.parse(res.payload);
            assert.equal(body.error, "EXECUTION_NOT_FOUND");
        });
    });
});

