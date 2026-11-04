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
import type { FastifyInstance } from "fastify";

describe("Sprint 6 - Task 15: Complete End-to-End Analyst Journey Suite (US-13, US-14, US-15)", () => {
    let app: FastifyInstance;
    let authRepo: InMemoryAuthRepository;
    let queryArtifactRepo: QueryArtifactRepository;
    let historyRepo: HistoryRepository;
    let resultCacheService: ResultCacheService;
    let csvExporterService: CsvExporterService;
    let auditLogger: AuditLogger;

    let aliceCookie: string;
    let aliceId: string;

    before(async () => {
        authRepo = new InMemoryAuthRepository();
        queryArtifactRepo = new QueryArtifactRepository();
        historyRepo = new HistoryRepository();
        resultCacheService = new ResultCacheService();
        csvExporterService = new CsvExporterService();
        auditLogger = new AuditLogger();

        const mockExecutor = {
            execute: async (): Promise<ExecutionResult> => ({
                ok: true,
                rows: [
                    { customer_name: "Acme Corp", total_amount: 15420.50 },
                    { customer_name: "Global Tech", total_amount: 8320.00 },
                ],
                columns: [
                    { name: "customer_name", pgType: "varchar", jsType: "string", nullable: false },
                    { name: "total_amount", pgType: "numeric", jsType: "number", nullable: false },
                ],
                rowCount: 2,
                byteSize: 150,
                executionTimeMs: 8,
                truncated: false,
            }),
        } as unknown as RestrictedExecutor;

        app = await buildApp({
            authRepo: authRepo as any,
            queryArtifactRepo,
            historyRepo,
            resultCacheService,
            csvExporterService,
            restrictedExecutor: mockExecutor,
            auditLogger,
            logger: false,
        });
        await app.ready();

        // 1. Authenticate as Analyst Alice
        const loginRes = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "analyst_a" },
        });
        assert.equal(loginRes.statusCode, 200);
        aliceCookie = `${loginRes.cookies[0].name}=${loginRes.cookies[0].value}`;
        aliceId = JSON.parse(loginRes.payload).user.id;
        assert.ok(aliceCookie, "Expected auth cookie");
    });

    after(async () => {
        if (app) await app.close();
    });

    it("executes the entire analyst lifecycle: generate -> execute -> export csv -> feedback -> history -> delete", async () => {
        // 1. Create a validated query artifact owned by Alice
        const artifact = await queryArtifactRepo.create({
            userId: aliceId,
            prompt: "Show total order amount per customer last year",
            generatedSql: "SELECT customer_name, total_amount FROM orders;",
            assumptions: ["Grouped by customer name"],
            referencedTables: ["orders"],
            referencedColumns: ["customer_name", "total_amount"],
            explanation: "Aggregates order amounts by customer.",
            provider: "ollama",
            model: "sqlcoder:7b",
            promptVersion: "1.0.0",
            schemaVersion: "1.0.0",
        });
        const artifactId = artifact.id;
        assert.ok(artifactId, "Expected artifactId in generation response");
        historyRepo.seedArtifact(artifact);

        // 2. Execute Preview Query with Idempotency Key
        const idempotencyKey = "idem_e2e_test_001";
        const execRes = await app.inject({
            method: "POST",
            url: `/api/v1/queries/${encodeURIComponent(artifactId)}/execute`,
            headers: { cookie: aliceCookie },
            payload: {
                idempotencyKey,
            },
        });
        assert.equal(execRes.statusCode, 200);
        const execData = JSON.parse(execRes.payload);
        assert.equal(execData.artifactId, artifactId);
        assert.equal(execData.status, "completed");
        assert.ok(Array.isArray(execData.rows));
        assert.ok(Array.isArray(execData.columns));
        const executionId = execData.executionId;
        assert.ok(executionId, "Expected executionId");

        // 2b. Re-executing with identical idempotencyKey returns cached execution (Idempotent)
        const replayRes = await app.inject({
            method: "POST",
            url: `/api/v1/queries/${encodeURIComponent(artifactId)}/execute`,
            headers: { cookie: aliceCookie },
            payload: {
                idempotencyKey,
            },
        });
        assert.equal(replayRes.statusCode, 200);
        const replayData = JSON.parse(replayRes.payload);
        assert.equal(replayData.executionId, executionId);

        // 3. Inspect Cached Results via GET /api/v1/executions/:id/results
        const resultsRes = await app.inject({
            method: "GET",
            url: `/api/v1/executions/${encodeURIComponent(executionId)}/results`,
            headers: { cookie: aliceCookie },
        });
        assert.equal(resultsRes.statusCode, 200);
        const resultsData = JSON.parse(resultsRes.payload);
        assert.equal(resultsData.executionId, executionId);
        assert.equal(resultsData.rowCount, execData.rowCount);

        // 4. Download Safe CSV via GET /api/v1/executions/:id/export.csv
        const exportRes = await app.inject({
            method: "GET",
            url: `/api/v1/executions/${encodeURIComponent(executionId)}/export.csv`,
            headers: { cookie: aliceCookie },
        });
        assert.equal(exportRes.statusCode, 200);
        assert.equal(exportRes.headers["content-type"], "text/csv; charset=utf-8");
        assert.equal(exportRes.headers["x-content-type-options"], "nosniff");
        assert.match(
            exportRes.headers["content-disposition"] as string,
            /attachment; filename="query-results-.*\.csv"/
        );
        assert.ok(exportRes.payload.length > 0);

        // 5. Submit Analyst Feedback
        const feedbackRes = await app.inject({
            method: "POST",
            url: `/api/v1/queries/${encodeURIComponent(artifactId)}/feedback`,
            headers: { cookie: aliceCookie },
            payload: {
                verdict: "correct",
            },
        });
        assert.equal(feedbackRes.statusCode, 201);
        const feedbackData = JSON.parse(feedbackRes.payload);
        assert.equal(feedbackData.artifactId, artifactId);
        assert.equal(feedbackData.verdict, "correct");

        // 5b. Verify Feedback Retrieval
        const getFeedbackRes = await app.inject({
            method: "GET",
            url: `/api/v1/queries/${encodeURIComponent(artifactId)}/feedback`,
            headers: { cookie: aliceCookie },
        });
        assert.equal(getFeedbackRes.statusCode, 200);
        const loadedFeedback = JSON.parse(getFeedbackRes.payload);
        assert.equal(loadedFeedback.verdict, "correct");

        // 6. List History and verify artifact is listed
        const historyRes = await app.inject({
            method: "GET",
            url: "/api/v1/history?limit=10&offset=0",
            headers: { cookie: aliceCookie },
        });
        assert.equal(historyRes.statusCode, 200);
        const historyData = JSON.parse(historyRes.payload);
        assert.ok(historyData.items.some((item: any) => item.artifactId === artifactId));

        // 7. Soft-Delete Artifact
        const deleteRes = await app.inject({
            method: "DELETE",
            url: `/api/v1/history/${encodeURIComponent(artifactId)}`,
            headers: { cookie: aliceCookie },
        });
        assert.equal(deleteRes.statusCode, 200);

        // 8. Verify artifact is excluded from history after deletion
        const historyAfterDeleteRes = await app.inject({
            method: "GET",
            url: "/api/v1/history?limit=10&offset=0",
            headers: { cookie: aliceCookie },
        });
        assert.equal(historyAfterDeleteRes.statusCode, 200);
        const historyAfterDeleteData = JSON.parse(historyAfterDeleteRes.payload);
        assert.ok(!historyAfterDeleteData.items.some((item: any) => item.artifactId === artifactId));
    });
});
