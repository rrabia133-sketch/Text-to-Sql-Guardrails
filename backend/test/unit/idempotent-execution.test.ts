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

describe("Sprint 6 - Task 3: Idempotent execution guard & schema/policy version freshness check (US-13)", () => {
    describe("1. ArtifactGate Schema & Policy Version Freshness", () => {
        let repo: QueryArtifactRepository;
        let gate: ArtifactGate;

        beforeEach(() => {
            repo = new QueryArtifactRepository();
            gate = new ArtifactGate(repo);
        });

        it("approves artifact with active schema versions ('v1', 'v1.0', '1.0.0', 'v1-hash')", async () => {
            const versions = ["v1", "v1.0", "1.0.0", "v1-38fa9280"];
            for (const v of versions) {
                const art = await repo.create({
                    id: `art_fresh_${v.replace(/[^a-zA-Z0-9]/g, "_")}`,
                    userId: "user_test",
                    prompt: "Active version test",
                    generatedSql: "SELECT 1;",
                    assumptions: [],
                    referencedTables: ["orders"],
                    referencedColumns: ["orders.id"],
                    explanation: "Version freshness test",
                    provider: "ollama",
                    model: "sqlcoder:7b",
                    promptVersion: "1.0.0",
                    schemaVersion: v,
                    policyVersion: "1.0.0",
                });

                const res = await gate.verify(art.id, "user_test");
                assert.equal(res.ok, true, `Expected version ${v} to be approved`);
                assert.equal(res.errorCode, undefined);
            }
        });

        it("rejects artifact with stale schema version ('v0.8', 'legacy') with STALE_SCHEMA_VERSION", async () => {
            const art = await repo.create({
                id: "art_stale_schema",
                userId: "user_test",
                prompt: "Stale schema test",
                generatedSql: "SELECT 1;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Stale schema version test",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "v0.8",
                policyVersion: "1.0.0",
            });

            const res = await gate.verify("art_stale_schema", "user_test");
            assert.equal(res.ok, false);
            assert.equal(res.errorCode, "STALE_SCHEMA_VERSION");
            assert.match(res.errorMessage!, /schema version 'v0\.8' is stale/i);
        });

        it("rejects artifact when activeSchemaVersion option mismatches", async () => {
            const art = await repo.create({
                id: "art_mismatch_schema",
                userId: "user_test",
                prompt: "Mismatch test",
                generatedSql: "SELECT 1;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Mismatch schema test",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "v1.0",
                policyVersion: "1.0.0",
            });

            const res = await gate.verify("art_mismatch_schema", "user_test", {
                activeSchemaVersion: "v2.0",
            });
            assert.equal(res.ok, false);
            assert.equal(res.errorCode, "STALE_SCHEMA_VERSION");
        });

        it("rejects artifact with stale policy version with STALE_POLICY_VERSION", async () => {
            const art = await repo.create({
                id: "art_stale_policy",
                userId: "user_test",
                prompt: "Stale policy test",
                generatedSql: "SELECT 1;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Stale policy test",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "v1.0",
                policyVersion: "0.5.0",
            });

            const res = await gate.verify("art_stale_policy", "user_test");
            assert.equal(res.ok, false);
            assert.equal(res.errorCode, "STALE_POLICY_VERSION");
            assert.match(res.errorMessage!, /policy version '0\.5\.0' is stale/i);
        });
    });

    describe("2. Fastify Execution Route Guards & Idempotency", () => {
        let app: FastifyInstance;
        let authRepo: InMemoryAuthRepository;
        let routeRepo: QueryArtifactRepository;
        let executionRepo: ExecutionRepository;
        let concurrencyManager: ConcurrencyManager;
        let cancellationService: CancellationService;
        let auditLogger: AuditLogger;
        let resultCacheService: ResultCacheService;
        let executorCallCount: number;
        let mockExecutor: RestrictedExecutor;
        let userCookie: string;
        let userId: string;

        before(async () => {
            authRepo = new InMemoryAuthRepository();
            routeRepo = new QueryArtifactRepository();
            executionRepo = new ExecutionRepository();
            const gate = new ArtifactGate(routeRepo);
            concurrencyManager = new ConcurrencyManager();
            cancellationService = new CancellationService();
            auditLogger = new AuditLogger();
            resultCacheService = new ResultCacheService();

            executorCallCount = 0;
            mockExecutor = {
                execute: async (_sql: string): Promise<ExecutionResult> => {
                    executorCallCount++;
                    return {
                        ok: true,
                        rows: [{ id: 101, name: "Widget A", total: 49.99 }],
                        columns: [
                            { name: "id", pgType: "int4", jsType: "number", nullable: false },
                            { name: "name", pgType: "varchar", jsType: "string", nullable: false },
                            { name: "total", pgType: "numeric", jsType: "number", nullable: true },
                        ],
                        rowCount: 1,
                        byteSize: 128,
                        executionTimeMs: 12,
                        truncated: false,
                    };
                },
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
                resultCacheService,
            });
            await app.ready();

            // Login pre-seeded analyst
            const loginRes = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { username: "analyst_a" },
            });
            assert.equal(loginRes.statusCode, 200);
            userCookie = `${loginRes.cookies[0].name}=${loginRes.cookies[0].value}`;
            userId = JSON.parse(loginRes.payload).user.id;
        });

        after(async () => {
            if (app) {
                await app.close();
            }
        });

        it("rejects execution body containing raw 'sql' property with HTTP 400 RAW_SQL_SUBMISSION_FORBIDDEN", async () => {
            const art = await routeRepo.create({
                id: "art_raw_sql_test",
                userId,
                prompt: "Raw SQL test",
                generatedSql: "SELECT id FROM orders LIMIT 10;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Raw SQL test",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "v1.0",
                policyVersion: "1.0.0",
            });

            const res = await app.inject({
                method: "POST",
                url: `/api/v1/queries/${art.id}/execute`,
                headers: { cookie: userCookie },
                payload: {
                    sql: "SELECT * FROM orders; -- client raw sql injection",
                },
            });

            assert.equal(res.statusCode, 400);
            const body = JSON.parse(res.payload);
            assert.equal(body.error, "RAW_SQL_SUBMISSION_FORBIDDEN");
            assert.match(body.message, /client raw sql submission is forbidden/i);
        });

        it("rejects execution body containing raw 'query' property with HTTP 400 RAW_SQL_SUBMISSION_FORBIDDEN", async () => {
            const art = await routeRepo.create({
                id: "art_raw_query_test",
                userId,
                prompt: "Raw query test",
                generatedSql: "SELECT id FROM orders LIMIT 10;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Raw query test",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "v1.0",
                policyVersion: "1.0.0",
            });

            const res = await app.inject({
                method: "POST",
                url: `/api/v1/queries/${art.id}/execute`,
                headers: { cookie: userCookie },
                payload: {
                    query: "DROP TABLE users;",
                },
            });

            assert.equal(res.statusCode, 400);
            const body = JSON.parse(res.payload);
            assert.equal(body.error, "RAW_SQL_SUBMISSION_FORBIDDEN");
        });

        it("rejects execution of artifact with stale schema version with HTTP 409 STALE_SCHEMA_VERSION", async () => {
            const art = await routeRepo.create({
                id: "art_stale_endpoint_test",
                userId,
                prompt: "Stale endpoint test",
                generatedSql: "SELECT id FROM orders LIMIT 10;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Stale schema endpoint test",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "v0.5",
                policyVersion: "1.0.0",
            });

            const res = await app.inject({
                method: "POST",
                url: `/api/v1/queries/${art.id}/execute`,
                headers: { cookie: userCookie },
                payload: {},
            });

            assert.equal(res.statusCode, 409);
            const body = JSON.parse(res.payload);
            assert.equal(body.error, "STALE_SCHEMA_VERSION");
        });

        it("executes once and caches result under idempotencyKey; duplicate request returns cached result without re-executing", async () => {
            const art = await routeRepo.create({
                id: "art_idempotent_1",
                userId,
                prompt: "Idempotent query",
                generatedSql: "SELECT id, name, total FROM orders LIMIT 1;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id", "orders.name", "orders.total"],
                explanation: "Idempotency test query",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "v1.0",
                policyVersion: "1.0.0",
            });

            const idempotencyKey = "req-uuid-abc-123";
            const initialCalls = executorCallCount;

            // 1. Initial execution
            const res1 = await app.inject({
                method: "POST",
                url: `/api/v1/queries/${art.id}/execute`,
                headers: { cookie: userCookie },
                payload: { idempotencyKey },
            });

            assert.equal(res1.statusCode, 200);
            const body1 = JSON.parse(res1.payload);
            assert.equal(body1.status, "completed");
            assert.equal(body1.rowCount, 1);
            assert.equal(executorCallCount, initialCalls + 1, "Restricted executor should have been called once");

            // 2. Duplicate submission with identical idempotencyKey
            const res2 = await app.inject({
                method: "POST",
                url: `/api/v1/queries/${art.id}/execute`,
                headers: { cookie: userCookie },
                payload: { idempotencyKey },
            });

            assert.equal(res2.statusCode, 200);
            assert.equal(res2.headers["x-cache-hit"], "true");
            const body2 = JSON.parse(res2.payload);
            assert.equal(body2.executionId, body1.executionId);
            assert.equal(body2.rowCount, 1);
            assert.deepEqual(body2.rows, body1.rows);

            // Restricted executor must NOT have been called again!
            assert.equal(
                executorCallCount,
                initialCalls + 1,
                "Restricted executor should NOT have been re-invoked on duplicate idempotencyKey"
            );
        });

        it("invokes executor again when a different idempotencyKey is used", async () => {
            const art = await routeRepo.create({
                id: "art_idempotent_2",
                userId,
                prompt: "Second query",
                generatedSql: "SELECT id, name, total FROM orders LIMIT 1;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id", "orders.name", "orders.total"],
                explanation: "Idempotency diff key query",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "v1.0",
                policyVersion: "1.0.0",
            });

            const callsBefore = executorCallCount;

            const res = await app.inject({
                method: "POST",
                url: `/api/v1/queries/${art.id}/execute`,
                headers: { cookie: userCookie },
                payload: { idempotencyKey: "different-key-789" },
            });

            assert.equal(res.statusCode, 200);
            assert.equal(executorCallCount, callsBefore + 1, "Executor should be invoked for new idempotencyKey");
        });
    });
});
