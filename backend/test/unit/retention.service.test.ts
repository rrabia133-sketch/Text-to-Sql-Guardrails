import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { InMemoryAuthRepository } from "../helpers/in-memory-auth.repo.js";
import { RetentionService } from "../../src/modules/retention/retention.service.js";
import { ResultCacheService } from "../../src/modules/execution/result-cache.service.js";
import { AuditLogger } from "../../src/modules/execution/audit-logger.js";
import type { QueryArtifactRecord } from "../../src/modules/generation/query-artifact.repository.js";

describe("Sprint 6 - Task 9 / DO-08 Task 3: Retention Cleanup Service & Admin Route (US-15 / DO-08)", () => {
    let resultCache: ResultCacheService;
    let retentionService: RetentionService;

    const createArtifact = (id: string, daysAgo: number): QueryArtifactRecord => {
        const createdAt = new Date(Date.now() - daysAgo * 86400 * 1000).toISOString();
        return {
            id,
            userId: "user_test",
            prompt: `Prompt ${id}`,
            generatedSql: "SELECT 1;",
            status: "completed",
            assumptions: [],
            referencedTables: [],
            referencedColumns: [],
            explanation: "",
            provider: "ollama",
            model: "sqlcoder:7b",
            promptVersion: "1.0.0",
            schemaVersion: "v1.0",
            policyVersion: "1.0.0",
            createdAt,
            updatedAt: createdAt,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        };
    };

    beforeEach(() => {
        resultCache = new ResultCacheService();
        retentionService = new RetentionService({
            resultCacheService: resultCache,
            policy: {
                historyRetentionDays: 30,
                auditRetentionDays: 90,
                ephemeralResultTtlMinutes: 15,
            },
        });
    });

    describe("1. RetentionService Sweeper Logic", () => {
        it("purges artifacts older than 30 days and retains recent artifacts", async () => {
            retentionService.seedArtifact(createArtifact("art_fresh_5d", 5));
            retentionService.seedArtifact(createArtifact("art_fresh_29d", 29));
            retentionService.seedArtifact(createArtifact("art_expired_31d", 31));
            retentionService.seedArtifact(createArtifact("art_expired_60d", 60));

            const report = await retentionService.runCleanup();
            assert.equal(report.purgedHistory, 2, "Should purge exactly 2 artifacts older than 30 days");

            const counts = retentionService.getCounts();
            assert.equal(counts.artifacts, 2, "Should retain the 2 fresh artifacts");
        });

        it("purges audit logs older than 90 days and retains recent audit logs", async () => {
            const now = Date.now();
            retentionService.seedAuditLog("log_fresh_10d", new Date(now - 10 * 86400 * 1000).toISOString());
            retentionService.seedAuditLog("log_fresh_89d", new Date(now - 89 * 86400 * 1000).toISOString());
            retentionService.seedAuditLog("log_expired_91d", new Date(now - 91 * 86400 * 1000).toISOString());
            retentionService.seedAuditLog("log_expired_120d", new Date(now - 120 * 86400 * 1000).toISOString());

            const report = await retentionService.runCleanup();
            assert.equal(report.purgedAuditLogs, 2, "Should purge exactly 2 audit logs older than 90 days");

            const counts = retentionService.getCounts();
            assert.equal(counts.auditLogs, 2, "Should retain 2 fresh audit logs");
        });

        it("evicts expired ephemeral execution results during retention sweep", async () => {
            // Seed 1 unexpired execution result (15m TTL) and 1 expired result (10ms TTL)
            const sample = {
                executionId: "exec_1",
                artifactId: "art_1",
                status: "completed" as const,
                columns: [],
                rows: [],
                rowCount: 0,
                byteSize: 0,
                executionTimeMs: 5,
                truncated: false,
                executedAt: new Date().toISOString(),
            };

            resultCache.setExecutionResult("exec_fresh", "user_test", "art_1", sample, 900000);
            resultCache.setExecutionResult("exec_expired", "user_test", "art_1", sample, 10);

            // Wait 25ms
            await new Promise((resolve) => setTimeout(resolve, 25));

            const report = await retentionService.runCleanup();
            assert.equal(report.purgedResults, 1, "Should evict 1 expired execution result");
            assert.equal(resultCache.size().executions, 1, "Should retain unexpired execution result");
        });
    });

    describe("2. Admin Trigger Route (POST /api/v1/admin/retention/run)", () => {
        let app: FastifyInstance;
        let authRepo: InMemoryAuthRepository;
        let auditLogger: AuditLogger;
        let analystCookie: string;
        let adminCookie: string;

        before(async () => {
            authRepo = new InMemoryAuthRepository();
            auditLogger = new AuditLogger();

            app = await buildApp({
                authRepo: authRepo as any,
                retentionService,
                auditLogger,
            });
            await app.ready();

            // Login Analyst (role: analyst)
            const loginAnalyst = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { username: "analyst_a" },
            });
            analystCookie = `${loginAnalyst.cookies[0].name}=${loginAnalyst.cookies[0].value}`;

            // Login Admin (role: admin)
            const loginAdmin = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { username: "admin_user" },
            });
            adminCookie = `${loginAdmin.cookies[0].name}=${loginAdmin.cookies[0].value}`;
        });

        after(async () => {
            if (app) await app.close();
        });

        it("returns HTTP 401 Unauthorized when unauthenticated", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/v1/admin/retention/run",
            });
            assert.equal(res.statusCode, 401);
        });

        it("returns HTTP 403 Forbidden when requested by standard Analyst (role: analyst)", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/v1/admin/retention/run",
                headers: { cookie: analystCookie },
            });

            assert.equal(res.statusCode, 403);
            const body = JSON.parse(res.payload);
            assert.equal(body.error, "FORBIDDEN");
            assert.match(body.message, /requires administrator privileges/i);
        });

        it("returns HTTP 200 OK with RetentionCleanupReport when executed by Administrator", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/v1/admin/retention/run",
                headers: { cookie: adminCookie },
            });

            assert.equal(res.statusCode, 200);
            const report = JSON.parse(res.payload);
            assert.equal(typeof report.purgedResults, "number");
            assert.equal(typeof report.purgedHistory, "number");
            assert.equal(typeof report.purgedAuditLogs, "number");
            assert.ok(report.cleanedAt);
            assert.equal(typeof report.durationMs, "number");
        });
    });
});

