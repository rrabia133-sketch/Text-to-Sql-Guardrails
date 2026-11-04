import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../src/app.js";
import { InMemoryAuthRepository } from "../helpers/in-memory-auth.repo.js";
import { QueryArtifactRepository } from "../../src/modules/generation/query-artifact.repository.js";
import { HistoryRepository } from "../../src/modules/history/history.repository.js";
import { ResultCacheService } from "../../src/modules/execution/result-cache.service.js";
import { CsvExporterService } from "../../src/modules/export/csv-exporter.service.js";
import { RestrictedExecutor, type ExecutionResult } from "../../src/modules/execution/restricted-executor.js";
import { AuditLogger } from "../../src/modules/execution/audit-logger.js";
import { RetentionService } from "../../src/modules/retention/retention.service.js";
import type { FastifyInstance } from "fastify";

describe("Sprint 6 - Task 15 / DO-08 Task 4: Cross-User Isolation & Retention Security Suite", () => {
    let app: FastifyInstance;
    let authRepo: InMemoryAuthRepository;
    let queryArtifactRepo: QueryArtifactRepository;
    let historyRepo: HistoryRepository;
    let resultCacheService: ResultCacheService;
    let csvExporterService: CsvExporterService;
    let retentionService: RetentionService;
    let auditLogger: AuditLogger;

    let aliceCookie: string;
    let bobCookie: string;
    let adminCookie: string;
    let aliceId: string;
    let bobId: string;

    before(async () => {
        authRepo = new InMemoryAuthRepository();
        queryArtifactRepo = new QueryArtifactRepository();
        historyRepo = new HistoryRepository();
        resultCacheService = new ResultCacheService();
        csvExporterService = new CsvExporterService();
        auditLogger = new AuditLogger();
        retentionService = new RetentionService(
            queryArtifactRepo,
            auditLogger,
            resultCacheService
        );

        const mockExecutor = {
            execute: async (): Promise<ExecutionResult> => ({
                ok: true,
                rows: [{ customer_count: 42 }],
                columns: [{ name: "customer_count", pgType: "int8", jsType: "number", nullable: false }],
                rowCount: 1,
                byteSize: 30,
                executionTimeMs: 4,
                truncated: false,
            }),
        } as unknown as RestrictedExecutor;

        app = await buildApp({
            authRepo: authRepo as any,
            queryArtifactRepo,
            historyRepo,
            resultCacheService,
            csvExporterService,
            retentionService,
            restrictedExecutor: mockExecutor,
            auditLogger,
            logger: false,
        });
        await app.ready();

        // Login Alice (analyst)
        const aliceRes = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "analyst_a" },
        });
        assert.equal(aliceRes.statusCode, 200);
        aliceCookie = `${aliceRes.cookies[0].name}=${aliceRes.cookies[0].value}`;
        aliceId = JSON.parse(aliceRes.payload).user.id;

        // Login Bob (analyst)
        const bobRes = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "analyst_b" },
        });
        assert.equal(bobRes.statusCode, 200);
        bobCookie = `${bobRes.cookies[0].name}=${bobRes.cookies[0].value}`;
        bobId = JSON.parse(bobRes.payload).user.id;

        // Login Admin
        const adminRes = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "admin_user" },
        });
        assert.equal(adminRes.statusCode, 200);
        adminCookie = `${adminRes.cookies[0].name}=${adminRes.cookies[0].value}`;
    });

    after(async () => {
        if (app) await app.close();
    });

    it("enforces strict cross-user isolation: Analyst B cannot view, export, feedback or delete Analyst A resources", async () => {
        // 1. Alice creates query artifact
        const artifact = await queryArtifactRepo.create({
            userId: aliceId,
            prompt: "Total customers count",
            generatedSql: "SELECT count(*) FROM customers;",
            assumptions: [],
            referencedTables: ["customers"],
            referencedColumns: ["id"],
            explanation: "Counts all customers.",
            provider: "ollama",
            model: "sqlcoder:7b",
            promptVersion: "1.0.0",
            schemaVersion: "1.0.0",
        });
        const artifactId = artifact.id;
        historyRepo.seedArtifact(artifact);

        // 2. Alice executes query
        const execRes = await app.inject({
            method: "POST",
            url: `/api/v1/queries/${encodeURIComponent(artifactId)}/execute`,
            headers: { cookie: aliceCookie },
            payload: { idempotencyKey: "alice_secret_query_key" },
        });
        assert.equal(execRes.statusCode, 200);
        const { executionId } = JSON.parse(execRes.payload);

        // 3. Bob attempts to export Alice's CSV -> 403 Forbidden
        const bobExportRes = await app.inject({
            method: "GET",
            url: `/api/v1/executions/${encodeURIComponent(executionId)}/export.csv`,
            headers: { cookie: bobCookie },
        });
        assert.equal(bobExportRes.statusCode, 403);
        const bobExportBody = JSON.parse(bobExportRes.payload);
        assert.ok(bobExportBody.error, "Expected error property in 403 response");

        // 4. Bob attempts to submit feedback on Alice's artifact -> 403 Forbidden
        const bobFeedbackRes = await app.inject({
            method: "POST",
            url: `/api/v1/queries/${encodeURIComponent(artifactId)}/feedback`,
            headers: { cookie: bobCookie },
            payload: { verdict: "incorrect", reasonCode: "wrong_metric" },
        });
        assert.equal(bobFeedbackRes.statusCode, 403);

        // 5. Bob attempts to delete Alice's artifact -> 403 Forbidden
        const bobDeleteRes = await app.inject({
            method: "DELETE",
            url: `/api/v1/history/${encodeURIComponent(artifactId)}`,
            headers: { cookie: bobCookie },
        });
        assert.equal(bobDeleteRes.statusCode, 403);

        // 6. Bob lists history -> Alice's artifact is NOT visible in Bob's history
        const bobHistoryRes = await app.inject({
            method: "GET",
            url: "/api/v1/history",
            headers: { cookie: bobCookie },
        });
        assert.equal(bobHistoryRes.statusCode, 200);
        const bobHistory = JSON.parse(bobHistoryRes.payload);
        assert.ok(!bobHistory.items.some((item: any) => item.artifactId === artifactId));
    });

    it("enforces admin-only role containment on retention sweep endpoint", async () => {
        // Standard analyst Alice attempts retention run -> 403 Forbidden
        const aliceRetentionRes = await app.inject({
            method: "POST",
            url: "/api/v1/admin/retention/run",
            headers: { cookie: aliceCookie },
        });
        assert.equal(aliceRetentionRes.statusCode, 403);

        // Administrator triggers retention run -> 200 OK
        const adminRetentionRes = await app.inject({
            method: "POST",
            url: "/api/v1/admin/retention/run",
            headers: { cookie: adminCookie },
        });
        assert.equal(adminRetentionRes.statusCode, 200);
        const report = JSON.parse(adminRetentionRes.payload);
        assert.equal(typeof report.purgedHistory, "number");
        assert.equal(typeof report.purgedAuditLogs, "number");
        assert.equal(typeof report.purgedResults, "number");
        assert.ok(report.cleanedAt);
    });

    it("returns HTTP 410 Gone for expired ephemeral execution results (> 15 minutes)", async () => {
        // Alice creates query preview and executes
        const artifact = await queryArtifactRepo.create({
            userId: aliceId,
            prompt: "Count active products",
            generatedSql: "SELECT count(*) FROM products;",
            assumptions: [],
            referencedTables: ["products"],
            referencedColumns: ["id"],
            explanation: "Counts products.",
            provider: "ollama",
            model: "sqlcoder:7b",
            promptVersion: "1.0.0",
            schemaVersion: "1.0.0",
        });
        const artifactId = artifact.id;
        historyRepo.seedArtifact(artifact);

        const execRes = await app.inject({
            method: "POST",
            url: `/api/v1/queries/${encodeURIComponent(artifactId)}/execute`,
            headers: { cookie: aliceCookie },
            payload: { idempotencyKey: "expired_test_key" },
        });
        assert.equal(execRes.statusCode, 200);
        const execData = JSON.parse(execRes.payload);
        const { executionId } = execData;

        // Artificially replace result cache entry with expired TTL (-1000ms)
        resultCacheService.setExecutionResult(
            executionId,
            aliceId,
            artifactId,
            execData,
            -1000 // negative TTL expires immediately
        );

        // Calling export on expired result must return HTTP 410 Gone (and evicts it)
        const exportRes = await app.inject({
            method: "GET",
            url: `/api/v1/executions/${encodeURIComponent(executionId)}/export.csv`,
            headers: { cookie: aliceCookie },
        });
        assert.equal(exportRes.statusCode, 410);
        const exportBody = JSON.parse(exportRes.payload);
        assert.equal(exportBody.error, "RESULT_EXPIRED");

        // Once evicted, subsequent calls deterministically return HTTP 404 EXECUTION_NOT_FOUND
        const inspectRes = await app.inject({
            method: "GET",
            url: `/api/v1/executions/${encodeURIComponent(executionId)}/results`,
            headers: { cookie: aliceCookie },
        });
        assert.equal(inspectRes.statusCode, 404);
        const inspectBody = JSON.parse(inspectRes.payload);
        assert.equal(inspectBody.error, "EXECUTION_NOT_FOUND");
    });
});
