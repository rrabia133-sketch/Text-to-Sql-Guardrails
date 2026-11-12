import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../src/app.js";
import { InMemoryAuthRepository } from "../helpers/in-memory-auth.repo.js";
import { redactSensitiveData, SENSITIVE_KEY_PATTERNS } from "../../src/plugins/redaction.js";
import type { FastifyInstance } from "fastify";

describe("Sprint 7 - Task 3 / DO-10: Correlated Request Tracing & Zero-Leak Log Redaction", () => {
    let app: FastifyInstance;

    before(async () => {
        const authRepo = new InMemoryAuthRepository();
        app = await buildApp({
            authRepo: authRepo as any,
            logger: false,
        });
        await app.ready();
    });

    after(async () => {
        if (app) await app.close();
    });

    describe("1. Sensitive Data Redaction Unit Tests", () => {
        it("redacts passwords, tokens, API keys, and session secrets from objects", () => {
            const rawPayload = {
                username: "analyst_a",
                password: "super_secret_password_123",
                apiKey: "gsk_live_secret_key_9999",
                sessionSecret: "min_32_character_long_session_secret_!",
                nested: {
                    userToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
                    authorization: "Bearer eyJhbGciOi...",
                },
            };

            const redacted = redactSensitiveData(rawPayload);

            assert.equal(redacted.username, "analyst_a");
            assert.equal(redacted.password, "[REDACTED]");
            assert.equal(redacted.apiKey, "[REDACTED]");
            assert.equal(redacted.sessionSecret, "[REDACTED]");
            assert.equal(redacted.nested.userToken, "[REDACTED]");
            assert.equal(redacted.nested.authorization, "[REDACTED]");
        });

        it("redacts database rows arrays to prevent PII leakage in application logs", () => {
            const queryExecutionLog = {
                executionId: "exec_123",
                status: "completed",
                rows: [
                    { id: 1, customerName: "Alice Smith", creditCard: "4111-2222-3333-4444" },
                    { id: 2, customerName: "Bob Jones", creditCard: "5555-6666-7777-8888" },
                ],
                rowCount: 2,
            };

            const redacted = redactSensitiveData(queryExecutionLog);

            assert.equal(redacted.executionId, "exec_123");
            assert.equal(redacted.status, "completed");
            assert.equal(redacted.rows, "[REDACTED_ROWS count=2]");
            assert.equal(redacted.rowCount, 2);
        });

        it("preserves safe non-sensitive metadata without alteration", () => {
            const safeMetadata = {
                executionTimeMs: 42,
                truncated: false,
                schemaVersion: "v1",
                model: "sqlcoder:7b",
                provider: "ollama",
                confidenceScore: 95,
            };

            const redacted = redactSensitiveData(safeMetadata);
            assert.deepEqual(redacted, safeMetadata);
        });
    });

    describe("2. Request ID Correlation & Security Headers Integration Tests", () => {
        it("generates and attaches unique x-request-id when none provided", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/",
            });

            assert.equal(res.statusCode, 200);
            const reqId = res.headers["x-request-id"] as string;
            assert.ok(reqId, "Expected x-request-id header");
            assert.match(reqId, /^req_/);
            assert.equal(res.headers["x-content-type-options"], "nosniff");
            assert.equal(res.headers["x-frame-options"], "DENY");
        });

        it("preserves and propagates client-supplied x-request-id header", async () => {
            const customReqId = "trace_upstream_distributed_999";
            const res = await app.inject({
                method: "GET",
                url: "/api/",
                headers: {
                    "x-request-id": customReqId,
                },
            });

            assert.equal(res.statusCode, 200);
            assert.equal(res.headers["x-request-id"], customReqId);
        });
    });
});

