import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../src/app.js";
import { InMemoryAuthRepository } from "../helpers/in-memory-auth.repo.js";
import { QueryArtifactRepository } from "../../src/modules/generation/query-artifact.repository.js";
import { ExecutionRepository } from "../../src/modules/execution/execution.repository.js";
import { ArtifactGate } from "../../src/modules/execution/artifact-gate.js";
import { ConcurrencyManager } from "../../src/modules/execution/concurrency-manager.js";
import { CancellationService } from "../../src/modules/execution/cancellation.service.js";
import { RestrictedExecutor } from "../../src/modules/execution/restricted-executor.js";
import { AuditLogger } from "../../src/modules/execution/audit-logger.js";
import type { FastifyInstance } from "fastify";

describe("Sprint 4 - Task 16: Fastify Execution API Routes & Audit Logging (US-10)", () => {
    let app: FastifyInstance;
    let authRepo: InMemoryAuthRepository;
    let queryArtifactRepo: QueryArtifactRepository;
    let executionRepo: ExecutionRepository;
    let artifactGate: ArtifactGate;
    let concurrencyManager: ConcurrencyManager;
    let cancellationService: CancellationService;
    let restrictedExecutor: RestrictedExecutor;
    let auditLogger: AuditLogger;

    let userACookie: string;
    let userBCookie: string;
    let userAId: string;
    let userBId: string;

    before(async () => {
        authRepo = new InMemoryAuthRepository();
        queryArtifactRepo = new QueryArtifactRepository();
        executionRepo = new ExecutionRepository();
        artifactGate = new ArtifactGate(queryArtifactRepo);
        concurrencyManager = new ConcurrencyManager();
        cancellationService = new CancellationService();
        restrictedExecutor = new RestrictedExecutor(); // operates in mock offline mode when pool is dummy
        auditLogger = new AuditLogger();

        app = await buildApp({
            authRepo: authRepo as any,
            queryArtifactRepo,
            executionRepo,
            artifactGate,
            concurrencyManager,
            cancellationService,
            restrictedExecutor,
            auditLogger,
        });
        await app.ready();

        // Login user A
        const loginResA = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "analyst_a" },
        });
        assert.equal(loginResA.statusCode, 200);
        userACookie = `${loginResA.cookies[0].name}=${loginResA.cookies[0].value}`;
        userAId = JSON.parse(loginResA.payload).user.id;

        // Login user B
        const loginResB = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "analyst_b" },
        });
        assert.equal(loginResB.statusCode, 200);
        userBCookie = `${loginResB.cookies[0].name}=${loginResB.cookies[0].value}`;
        userBId = JSON.parse(loginResB.payload).user.id;
    });

    after(async () => {
        await app.close();
    });

    describe("POST /api/v1/queries/:id/execute", () => {
        it("returns 401 when request is unauthenticated", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/v1/queries/art_123/execute",
            });
            assert.equal(res.statusCode, 401);
        });

        it("returns 404 ARTIFACT_NOT_FOUND when query artifact does not exist", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/v1/queries/art_nonexistent/execute",
                headers: { cookie: userACookie },
            });
            assert.equal(res.statusCode, 404);
            const body = JSON.parse(res.payload);
            assert.equal(body.error, "ARTIFACT_NOT_FOUND");
        });

        it("returns 403 ARTIFACT_NOT_OWNED when query artifact belongs to another user", async () => {
            const artifactB = await queryArtifactRepo.create({
                userId: userBId,
                prompt: "Select customers for user B",
                generatedSql: "SELECT id, name FROM customers;",
                referencedTables: ["customers"],
                referencedColumns: ["customers.id", "customers.name"],
                assumptions: [],
                explanation: "Customers query for user B",
                provider: "ollama",
                model: "qwen2.5-coder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "1.0.0",
            });

            const res = await app.inject({
                method: "POST",
                url: `/api/v1/queries/${artifactB.id}/execute`,
                headers: { cookie: userACookie },
            });
            assert.equal(res.statusCode, 403);
            const body = JSON.parse(res.payload);
            assert.equal(body.error, "ARTIFACT_NOT_OWNED");
        });

        it("returns 409 TRANSACTION_VIOLATION when artifact is not in preview state", async () => {
            const artifact = await queryArtifactRepo.create({
                userId: userAId,
                prompt: "Orders count",
                generatedSql: "SELECT COUNT(*) FROM orders;",
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                assumptions: [],
                explanation: "Count of all orders",
                provider: "ollama",
                model: "qwen2.5-coder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "1.0.0",
            });
            await queryArtifactRepo.updateStatus(artifact.id, "completed");

            const res = await app.inject({
                method: "POST",
                url: `/api/v1/queries/${artifact.id}/execute`,
                headers: { cookie: userACookie },
            });
            assert.equal(res.statusCode, 409);
            const body = JSON.parse(res.payload);
            assert.equal(body.error, "TRANSACTION_VIOLATION");
        });

        it("successfully executes owned preview artifact and returns result payload", async () => {
            const artifact = await queryArtifactRepo.create({
                userId: userAId,
                prompt: "Top customers",
                generatedSql: "SELECT id, name FROM customers LIMIT 10;",
                referencedTables: ["customers"],
                referencedColumns: ["customers.id", "customers.name"],
                assumptions: [],
                explanation: "Top 10 customers",
                provider: "ollama",
                model: "qwen2.5-coder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "1.0.0",
            });

            const res = await app.inject({
                method: "POST",
                url: `/api/v1/queries/${artifact.id}/execute`,
                headers: { cookie: userACookie },
            });

            assert.equal(res.statusCode, 200);
            const body = JSON.parse(res.payload);
            assert.equal(body.artifactId, artifact.id);
            assert.equal(body.status, "completed");
            assert.ok(Array.isArray(body.columns));
            assert.ok(Array.isArray(body.rows));
            assert.equal(body.rowCount, body.rows.length);
            assert.equal(typeof body.executionTimeMs, "number");
            assert.equal(typeof body.byteSize, "number");
            assert.equal(typeof body.truncated, "boolean");

            // Verify artifact state was transitioned to completed
            const updated = await queryArtifactRepo.findById(artifact.id);
            assert.equal(updated?.status, "completed");
        });

        it("enforces active query concurrency limit (429 Too Many Requests)", async () => {
            // Settle user concurrency with 2 dummy executions
            concurrencyManager.acquire(userAId, "exec_slot1");
            concurrencyManager.acquire(userAId, "exec_slot2");

            const artifact = await queryArtifactRepo.create({
                userId: userAId,
                prompt: "Third query",
                generatedSql: "SELECT id FROM orders;",
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                assumptions: [],
                explanation: "Third orders query",
                provider: "ollama",
                model: "qwen2.5-coder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "1.0.0",
            });

            const res = await app.inject({
                method: "POST",
                url: `/api/v1/queries/${artifact.id}/execute`,
                headers: { cookie: userACookie },
            });

            assert.equal(res.statusCode, 429);
            const body = JSON.parse(res.payload);
            assert.equal(body.error, "Too Many Requests");

            // Release slots
            concurrencyManager.release(userAId, "exec_slot1");
            concurrencyManager.release(userAId, "exec_slot2");
        });
    });

    describe("GET /api/v1/executions/:id", () => {
        it("returns 404 when execution record is not found", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/v1/executions/exec_unknown",
                headers: { cookie: userACookie },
            });
            assert.equal(res.statusCode, 404);
        });

        it("returns 403 when execution record belongs to another user", async () => {
            const exec = await executionRepo.create({
                id: "exec_b_owned",
                artifactId: "art_b_1",
                userId: userBId,
                status: "completed",
                sqlExecuted: "SELECT 1;",
            });

            const res = await app.inject({
                method: "GET",
                url: `/api/v1/executions/${exec.id}`,
                headers: { cookie: userACookie },
            });
            assert.equal(res.statusCode, 403);
        });

        it("returns execution record when accessed by owner", async () => {
            const exec = await executionRepo.create({
                id: "exec_a_owned",
                artifactId: "art_a_1",
                userId: userAId,
                status: "completed",
                sqlExecuted: "SELECT id, name FROM customers;",
                rowCount: 5,
                byteSize: 120,
                executionTimeMs: 14,
            });

            const res = await app.inject({
                method: "GET",
                url: `/api/v1/executions/${exec.id}`,
                headers: { cookie: userACookie },
            });
            assert.equal(res.statusCode, 200);
            const body = JSON.parse(res.payload);
            assert.equal(body.id, exec.id);
            assert.equal(body.userId, userAId);
            assert.equal(body.status, "completed");
            assert.equal(body.rowCount, 5);
        });
    });

    describe("POST /api/v1/executions/:id/cancel", () => {
        it("returns 404 when cancelling nonexistent execution", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/v1/executions/exec_unknown/cancel",
                headers: { cookie: userACookie },
            });
            assert.equal(res.statusCode, 404);
        });

        it("returns 403 when attempting to cancel another user's execution", async () => {
            const exec = await executionRepo.create({
                id: "exec_b_running",
                artifactId: "art_b_2",
                userId: userBId,
                status: "running",
                sqlExecuted: "SELECT * FROM orders;",
            });

            const res = await app.inject({
                method: "POST",
                url: `/api/v1/executions/${exec.id}/cancel`,
                headers: { cookie: userACookie },
            });
            assert.equal(res.statusCode, 403);
        });

        it("successfully cancels running execution and updates record", async () => {
            const exec = await executionRepo.create({
                id: "exec_a_running",
                artifactId: "art_a_2",
                userId: userAId,
                status: "running",
                sqlExecuted: "SELECT pg_sleep(10);",
            });

            const res = await app.inject({
                method: "POST",
                url: `/api/v1/executions/${exec.id}/cancel`,
                headers: { cookie: userACookie },
            });

            assert.equal(res.statusCode, 200);
            const body = JSON.parse(res.payload);
            assert.equal(body.executionId, exec.id);
            assert.equal(body.cancelled, true);

            const updated = await executionRepo.findById(exec.id);
            assert.equal(updated?.status, "cancelled");
        });
    });

    describe("Audit Logging & Privacy Safeguards", () => {
        it("logs audit events containing strictly performance metadata without raw query rows or PII", async () => {
            const memoryLogs = auditLogger.getMemoryLogs();
            assert.ok(memoryLogs.length > 0);

            for (const log of memoryLogs) {
                assert.ok(log.userId, "Audit log must contain user ID");
                assert.ok(log.action, "Audit log must contain action");
                assert.ok(log.timestamp, "Audit log must contain timestamp");

                // Ensure no raw rows or result data leaked into details
                if (log.details) {
                    assert.equal((log.details as any).rows, undefined, "Audit log must never contain result rows");
                    assert.equal((log.details as any).columns, undefined, "Audit log must never contain raw columns data");
                    assert.equal((log.details as any).password, undefined, "Audit log must never contain passwords");
                }
            }
        });
    });
});
