import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { InMemoryAuthRepository } from "../helpers/in-memory-auth.repo.js";
import { QueryArtifactRepository } from "../../src/modules/generation/query-artifact.repository.js";
import { HistoryRepository } from "../../src/modules/history/history.repository.js";
import { AuditLogger } from "../../src/modules/execution/audit-logger.js";

describe("Sprint 6 - Task 8: Fastify History, Deletion & Feedback Routes (US-15)", () => {
    let app: FastifyInstance;
    let authRepo: InMemoryAuthRepository;
    let queryArtifactRepo: QueryArtifactRepository;
    let historyRepo: HistoryRepository;
    let auditLogger: AuditLogger;

    let userACookie: string;
    let userBCookie: string;
    let userAId: string;
    let userBId: string;

    before(async () => {
        authRepo = new InMemoryAuthRepository();
        queryArtifactRepo = new QueryArtifactRepository();
        historyRepo = new HistoryRepository();
        auditLogger = new AuditLogger();

        app = await buildApp({
            authRepo: authRepo as any,
            queryArtifactRepo,
            historyRepo,
            auditLogger,
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

    describe("1. GET /api/v1/history (Paginated History)", () => {
        it("returns HTTP 401 Unauthorized without session cookie", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/v1/history",
            });
            assert.equal(res.statusCode, 401);
        });

        it("returns paginated history with strict tenant isolation", async () => {
            // Seed artifacts for Alice and Bob
            const artAlice1 = await queryArtifactRepo.create({
                id: "art_hist_alice_1",
                userId: userAId,
                prompt: "Revenue for Alice",
                generatedSql: "SELECT 1;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Test",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "v1.0",
            });
            historyRepo.seedArtifact(artAlice1, { score: 88, band: "high" });

            const artBob1 = await queryArtifactRepo.create({
                id: "art_hist_bob_1",
                userId: userBId,
                prompt: "Orders for Bob",
                generatedSql: "SELECT 2;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Test Bob",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "v1.0",
            });
            historyRepo.seedArtifact(artBob1);

            // Alice requests history
            const resAlice = await app.inject({
                method: "GET",
                url: "/api/v1/history?limit=10&offset=0",
                headers: { cookie: userACookie },
            });

            assert.equal(resAlice.statusCode, 200);
            const bodyAlice = JSON.parse(resAlice.payload);
            assert.equal(bodyAlice.total, 1);
            assert.equal(bodyAlice.items[0].artifactId, "art_hist_alice_1");
            assert.equal(bodyAlice.items[0].confidenceScore, 88);

            // Bob requests history
            const resBob = await app.inject({
                method: "GET",
                url: "/api/v1/history",
                headers: { cookie: userBCookie },
            });

            assert.equal(resBob.statusCode, 200);
            const bodyBob = JSON.parse(resBob.payload);
            assert.equal(bodyBob.total, 1);
            assert.equal(bodyBob.items[0].artifactId, "art_hist_bob_1");
        });
    });

    describe("2. DELETE /api/v1/history/:artifactId (Artifact Deletion)", () => {
        it("returns HTTP 403 Forbidden when attempting to delete another user's artifact", async () => {
            const res = await app.inject({
                method: "DELETE",
                url: "/api/v1/history/art_hist_alice_1",
                headers: { cookie: userBCookie }, // Bob attempts to delete Alice's artifact
            });

            assert.equal(res.statusCode, 403);
            const body = JSON.parse(res.payload);
            assert.equal(body.error, "FORBIDDEN");
        });

        it("returns HTTP 404 ARTIFACT_NOT_FOUND when deleting nonexistent artifact", async () => {
            const res = await app.inject({
                method: "DELETE",
                url: "/api/v1/history/art_ghost_nonexistent",
                headers: { cookie: userACookie },
            });

            assert.equal(res.statusCode, 404);
            const body = JSON.parse(res.payload);
            assert.equal(body.error, "ARTIFACT_NOT_FOUND");
        });

        it("successfully soft-deletes owned artifact and removes it from history", async () => {
            const artToDelete = await queryArtifactRepo.create({
                id: "art_to_delete_01",
                userId: userAId,
                prompt: "Delete me query",
                generatedSql: "SELECT 1;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Test",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "v1.0",
            });
            historyRepo.seedArtifact(artToDelete);

            const res = await app.inject({
                method: "DELETE",
                url: `/api/v1/history/${artToDelete.id}`,
                headers: { cookie: userACookie },
            });

            assert.equal(res.statusCode, 200);
            const body = JSON.parse(res.payload);
            assert.equal(body.ok, true);
            assert.equal(body.artifactId, artToDelete.id);

            // History should no longer list the deleted artifact
            const histRes = await app.inject({
                method: "GET",
                url: "/api/v1/history",
                headers: { cookie: userACookie },
            });
            const histBody = JSON.parse(histRes.payload);
            assert.equal(histBody.items.some((i: any) => i.artifactId === artToDelete.id), false);
        });
    });

    describe("3. POST /api/v1/queries/:id/feedback & GET /api/v1/queries/:id/feedback", () => {
        it("returns HTTP 400 Bad Request on invalid verdict or missing fields", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/v1/queries/art_hist_alice_1/feedback",
                headers: { cookie: userACookie },
                payload: {
                    verdict: "maybe", // invalid
                },
            });

            assert.equal(res.statusCode, 400);
        });

        it("returns HTTP 403 Forbidden when submitting feedback on another user's artifact", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/v1/queries/art_hist_alice_1/feedback",
                headers: { cookie: userBCookie }, // Bob submits feedback on Alice's artifact
                payload: {
                    verdict: "correct",
                },
            });

            assert.equal(res.statusCode, 403);
        });

        it("successfully persists and retrieves feedback for owned artifact", async () => {
            const resPost = await app.inject({
                method: "POST",
                url: "/api/v1/queries/art_hist_alice_1/feedback",
                headers: { cookie: userACookie },
                payload: {
                    verdict: "incorrect",
                    reasonCode: "wrong_filter",
                    notes: "Missed status = 'completed' condition",
                },
            });

            assert.equal(resPost.statusCode, 201);
            const postedFeedback = JSON.parse(resPost.payload);
            assert.ok(postedFeedback.id.startsWith("fb_"));
            assert.equal(postedFeedback.verdict, "incorrect");
            assert.equal(postedFeedback.reasonCode, "wrong_filter");
            assert.equal(postedFeedback.notes, "Missed status = 'completed' condition");

            // GET feedback
            const resGet = await app.inject({
                method: "GET",
                url: "/api/v1/queries/art_hist_alice_1/feedback",
                headers: { cookie: userACookie },
            });

            assert.equal(resGet.statusCode, 200);
            const retrieved = JSON.parse(resGet.payload);
            assert.equal(retrieved.id, postedFeedback.id);
            assert.equal(retrieved.verdict, "incorrect");
        });
    });
});

