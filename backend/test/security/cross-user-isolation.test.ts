import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config/env.js";
import {
    requireRole,
    requireAdmin,
    createOwnershipGuard,
} from "../../src/modules/auth/ownership.guard.js";
import { requireAuth } from "../../src/plugins/auth.js";
import {
    InMemoryAuthRepository,
    DEFAULT_MOCK_USERS,
} from "../helpers/in-memory-auth.repo.js";
import type { SessionRecord } from "../../src/modules/auth/auth.repository.js";

// ============================================================================
// 1. DATA MODELS & TYPES FOR ISOLATION TESTING
// ============================================================================

interface MockQueryArtifact {
    id: string;
    userId: string;
    prompt: string;
    sql: string;
    status: "completed" | "failed" | "pending";
    createdAt: Date;
}

const testConfig = { ...config, NODE_ENV: "test" as const };

function createInitialArtifacts(): Map<string, MockQueryArtifact> {
    return new Map([
        [
            "art_alice_101",
            {
                id: "art_alice_101",
                userId: "usr_analyst_a",
                prompt: "Alice's sales performance breakdown",
                sql: "SELECT region, SUM(revenue) FROM sales GROUP BY region;",
                status: "completed",
                createdAt: new Date("2026-02-01T10:00:00.000Z"),
            },
        ],
        [
            "art_bob_201",
            {
                id: "art_bob_201",
                userId: "usr_analyst_b",
                prompt: "Bob's confidential executive payroll query",
                sql: "SELECT employee_id, ssn, base_salary, bonus FROM executive_payroll;",
                status: "completed",
                createdAt: new Date("2026-02-02T11:00:00.000Z"),
            },
        ],
    ]);
}

// ============================================================================
// 2. ISOLATION TEST SERVER FACTORY
// ============================================================================

async function buildIsolationTestServer(
    authRepo: InMemoryAuthRepository,
    queryStore: Map<string, MockQueryArtifact>
): Promise<FastifyInstance> {
    const mockPool = {
        query: async () => ({ rows: [], rowCount: 0 }),
        end: async () => {},
    } as unknown as Pool;

    const mockDbChecker = {
        checkHealth: async () => ({
            analyticsDb: { status: "connected" as const, isReadOnly: true, latencyMs: 5 },
            appDb: { status: "connected" as const, latencyMs: 5 },
        }),
        close: async () => {},
    };

    // Instantiate app using the actual production buildApp factory
    const app = await buildApp({
        appConfig: testConfig,
        authRepo,
        appPool: mockPool,
        dbChecker: mockDbChecker,
    });

    // -------------------------------------------------------------
    // PROTECTED QUERY ARTIFACT ROUTES (Guarded by createOwnershipGuard)
    // -------------------------------------------------------------
    const artifactGuard = createOwnershipGuard<MockQueryArtifact>({
        paramName: "id",
        resourceName: "Query artifact",
        loader: async (id) => queryStore.get(id) ?? null,
        getOwnerId: (res) => res.userId,
    });

    // List caller's artifacts only
    app.get("/api/queries", { preHandler: [requireAuth] }, async (request) => {
        const callerId = request.user!.id;
        const callerArtifacts = Array.from(queryStore.values()).filter(
            (q) => q.userId === callerId
        );
        return { artifacts: callerArtifacts };
    });

    // Read artifact by ID
    app.get(
        "/api/queries/:id",
        { preHandler: [artifactGuard] },
        async (request) => {
            return { artifact: request.loadedResource };
        }
    );

    // Modify artifact by ID
    app.put(
        "/api/queries/:id",
        { preHandler: [artifactGuard] },
        async (request) => {
            const existing = request.loadedResource as MockQueryArtifact;
            const body = (request.body as Partial<MockQueryArtifact>) || {};
            const updated: MockQueryArtifact = {
                ...existing,
                prompt: body.prompt ?? existing.prompt,
                sql: body.sql ?? existing.sql,
                status: body.status ?? existing.status,
            };
            queryStore.set(existing.id, updated);
            return { artifact: updated };
        }
    );

    // Delete artifact by ID
    app.delete(
        "/api/queries/:id",
        { preHandler: [artifactGuard] },
        async (request, reply) => {
            const existing = request.loadedResource as MockQueryArtifact;
            queryStore.delete(existing.id);
            return reply.status(204).send();
        }
    );

    // -------------------------------------------------------------
    // PROTECTED SESSION MANAGEMENT ROUTES (Guarded by createOwnershipGuard)
    // -------------------------------------------------------------
    const sessionGuard = createOwnershipGuard<SessionRecord>({
        paramName: "sessionId",
        resourceName: "Session",
        loader: async (id) => authRepo.getRawSession(id),
        getOwnerId: (res) => res.userId,
    });

    // Read session details
    app.get(
        "/api/sessions/:sessionId",
        { preHandler: [sessionGuard] },
        async (request) => {
            return { session: request.loadedResource };
        }
    );

    // Revoke another user's session attempt
    app.delete(
        "/api/sessions/:sessionId",
        { preHandler: [sessionGuard] },
        async (request, reply) => {
            const sess = request.loadedResource as SessionRecord;
            await authRepo.deleteSession(sess.id);
            return reply.status(200).send({
                success: true,
                message: "Session revoked successfully",
            });
        }
    );

    // -------------------------------------------------------------
    // ADMINISTRATIVE ENDPOINTS (Guarded by requireAdmin)
    // -------------------------------------------------------------
    app.get(
        "/api/admin/metrics",
        { preHandler: [requireAdmin] },
        async () => {
            return {
                status: "admin_metrics",
                totalQueriesExecuted: 42,
                systemLoad: 0.15,
            };
        }
    );

    app.post(
        "/api/admin/system/reset-cache",
        { preHandler: [requireAdmin] },
        async () => {
            return {
                success: true,
                message: "Global query cache purged by administrator",
            };
        }
    );

    app.get(
        "/api/admin/audit-logs",
        { preHandler: [requireAdmin] },
        async () => {
            return {
                logs: [
                    { id: "audit_1", event: "USER_LOGIN", user: "admin_user" },
                    { id: "audit_2", event: "SYSTEM_BACKUP", status: "completed" },
                ],
            };
        }
    );

    app.delete(
        "/api/admin/users/:id",
        { preHandler: [requireAdmin] },
        async (request) => {
            const { id } = request.params as { id: string };
            return {
                success: true,
                message: `User ${id} deactivated by administrator`,
            };
        }
    );

    await app.ready();
    return app;
}

// ============================================================================
// 3. COOKIE & AUTH HELPERS
// ============================================================================

async function loginAndGetCookie(
    app: FastifyInstance,
    username: string
): Promise<{ cookie: string; sessionId: string }> {
    const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username },
    });

    assert.equal(res.statusCode, 200, `Login must succeed for ${username}`);
    const setCookie = res.headers["set-cookie"];
    assert.ok(setCookie, "Set-Cookie header must be present on login");

    const rawCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const cookiePart = rawCookie.split(";")[0];
    const body = res.json();

    return {
        cookie: cookiePart,
        sessionId: body.sessionId,
    };
}

// ============================================================================
// 4. PENETRATION & ISOLATION TEST SUITE (Task 15 / US-03)
// ============================================================================

describe("Task 15: Automated Security & Cross-User Penetration Tests (US-03)", () => {
    let authRepo: InMemoryAuthRepository;
    let queryStore: Map<string, MockQueryArtifact>;
    let app: FastifyInstance;

    beforeEach(async () => {
        authRepo = new InMemoryAuthRepository(DEFAULT_MOCK_USERS);
        queryStore = createInitialArtifacts();
        app = await buildIsolationTestServer(authRepo, queryStore);
    });

    afterEach(async () => {
        await app.close();
    });

    // ------------------------------------------------------------------------
    // CHECKLIST ITEM 1: Requests without cookie return 401 Unauthorized
    // ------------------------------------------------------------------------
    describe("1. Unauthenticated Requests & Cookie Validation (401 Unauthorized)", () => {
        it("returns 401 when GET /api/auth/me has no cookie header", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/auth/me",
            });

            assert.equal(res.statusCode, 401);
            const body = res.json();
            assert.equal(body.error, "Unauthorized");
            assert.equal(body.message, "Authentication required to access this resource");
            assert.ok(body.timestamp);
        });

        it("returns 401 when accessing protected query artifact without cookie", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/queries/art_alice_101",
            });

            assert.equal(res.statusCode, 401);
            assert.equal(res.json().error, "Unauthorized");
        });

        it("returns 401 when attempting to list queries without cookie", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/queries",
            });

            assert.equal(res.statusCode, 401);
            assert.equal(res.json().error, "Unauthorized");
        });

        it("returns 401 when attempting PUT mutation on query without cookie", async () => {
            const res = await app.inject({
                method: "PUT",
                url: "/api/queries/art_alice_101",
                payload: { prompt: "Malicious unauthenticated update" },
            });

            assert.equal(res.statusCode, 401);
            assert.equal(res.json().error, "Unauthorized");
        });

        it("returns 401 when attempting DELETE on query without cookie", async () => {
            const res = await app.inject({
                method: "DELETE",
                url: "/api/queries/art_alice_101",
            });

            assert.equal(res.statusCode, 401);
            assert.equal(res.json().error, "Unauthorized");
        });

        it("returns 401 when accessing admin endpoints without cookie", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/admin/metrics",
            });

            assert.equal(res.statusCode, 401);
            assert.equal(res.json().error, "Unauthorized");
        });

        it("returns 401 when cookie header is completely empty", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/auth/me",
                headers: { cookie: "" },
            });

            assert.equal(res.statusCode, 401);
        });

        it("returns 401 when cookie contains unrelated cookies but no session_id", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/auth/me",
                headers: {
                    cookie: "theme=dark; ga_client_id=123456.789; tracking=disabled",
                },
            });

            assert.equal(res.statusCode, 401);
            assert.equal(res.json().error, "Unauthorized");
        });

        it("returns 401 when session_id cookie is unsigned / raw token", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/auth/me",
                headers: {
                    cookie: "session_id=raw_unsigned_token_12345",
                },
            });

            assert.equal(res.statusCode, 401);
            assert.equal(res.json().error, "Unauthorized");
        });

        it("returns 401 when session_id cookie signature is tampered or corrupted", async () => {
            // First get a legitimate cookie
            const { cookie } = await loginAndGetCookie(app, "analyst_a");

            // Tamper with the cryptographic signature portion
            const tamperedCookie = `${cookie}corrupted_signature`;

            const res = await app.inject({
                method: "GET",
                url: "/api/auth/me",
                headers: {
                    cookie: tamperedCookie,
                },
            });

            assert.equal(res.statusCode, 401);
            assert.equal(res.json().error, "Unauthorized");
        });

        it("returns 401 when cookie is validly signed but session does not exist in store", async () => {
            // Sign a random UUID that was never inserted into authRepo
            const nonExistentId = "00000000-0000-4000-a000-000000000000";
            const signedVal = app.signCookie(nonExistentId);

            const res = await app.inject({
                method: "GET",
                url: "/api/auth/me",
                headers: {
                    cookie: `session_id=${signedVal}`,
                },
            });

            assert.equal(res.statusCode, 401);
            assert.equal(res.json().error, "Unauthorized");
        });
    });

    // ------------------------------------------------------------------------
    // CHECKLIST ITEM 2: Expired session cookie returns 401 Unauthorized
    // ------------------------------------------------------------------------
    describe("2. Expired Session Cookie Rejection (401 Unauthorized)", () => {
        it("returns 401 when GET /api/auth/me is called with an expired session cookie", async () => {
            const { cookie, sessionId } = await loginAndGetCookie(app, "analyst_a");

            // Verify session works before expiration
            const validRes = await app.inject({
                method: "GET",
                url: "/api/auth/me",
                headers: { cookie },
            });
            assert.equal(validRes.statusCode, 200);

            // Force session expiration (1 hour in the past)
            authRepo.expireSession(sessionId);

            // Re-attempting with the same cookie must now be rejected
            const expiredRes = await app.inject({
                method: "GET",
                url: "/api/auth/me",
                headers: { cookie },
            });

            assert.equal(expiredRes.statusCode, 401);
            const body = expiredRes.json();
            assert.equal(body.error, "Unauthorized");
            assert.equal(body.message, "Authentication required to access this resource");
        });

        it("returns 401 when accessing protected query artifact with expired session", async () => {
            const { cookie, sessionId } = await loginAndGetCookie(app, "analyst_a");
            authRepo.expireSession(sessionId);

            const res = await app.inject({
                method: "GET",
                url: "/api/queries/art_alice_101",
                headers: { cookie },
            });

            assert.equal(res.statusCode, 401);
            assert.equal(res.json().error, "Unauthorized");
        });

        it("returns 401 when attempting mutation with expired session", async () => {
            const { cookie, sessionId } = await loginAndGetCookie(app, "analyst_a");
            authRepo.expireSession(sessionId);

            const res = await app.inject({
                method: "PUT",
                url: "/api/queries/art_alice_101",
                headers: { cookie },
                payload: { prompt: "Expired session update attempt" },
            });

            assert.equal(res.statusCode, 401);
            assert.equal(res.json().error, "Unauthorized");
        });

        it("returns 401 when attempting deletion with expired session", async () => {
            const { cookie, sessionId } = await loginAndGetCookie(app, "analyst_a");
            authRepo.expireSession(sessionId);

            const res = await app.inject({
                method: "DELETE",
                url: "/api/queries/art_alice_101",
                headers: { cookie },
            });

            assert.equal(res.statusCode, 401);
            assert.equal(res.json().error, "Unauthorized");
        });

        it("returns 401 when admin endpoint is accessed with expired admin session", async () => {
            const { cookie, sessionId } = await loginAndGetCookie(app, "admin_user");

            // Verify admin can access before expiration
            const validRes = await app.inject({
                method: "GET",
                url: "/api/admin/metrics",
                headers: { cookie },
            });
            assert.equal(validRes.statusCode, 200);

            // Expire admin session
            authRepo.expireSession(sessionId);

            const expiredRes = await app.inject({
                method: "GET",
                url: "/api/admin/metrics",
                headers: { cookie },
            });

            assert.equal(expiredRes.statusCode, 401);
            assert.equal(expiredRes.json().error, "Unauthorized");
        });

        it("purging expired sessions via deleteExpiredSessions permanently rejects future requests", async () => {
            const { cookie, sessionId } = await loginAndGetCookie(app, "analyst_b");
            authRepo.expireSession(sessionId);

            const purgedCount = await authRepo.deleteExpiredSessions();
            assert.ok(purgedCount >= 1, "Must purge at least the expired test session");

            const res = await app.inject({
                method: "GET",
                url: "/api/auth/me",
                headers: { cookie },
            });

            assert.equal(res.statusCode, 401);
        });
    });

    // ------------------------------------------------------------------------
    // CHECKLIST ITEM 3: Analyst A cannot read Analyst B's query artifact or session
    // ------------------------------------------------------------------------
    describe("3. Cross-User Read Isolation (Anti-Enumeration 404)", () => {
        let aliceCookie: string;
        let bobCookie: string;
        let bobSessionId: string;

        beforeEach(async () => {
            const alice = await loginAndGetCookie(app, "analyst_a");
            aliceCookie = alice.cookie;

            const bob = await loginAndGetCookie(app, "analyst_b");
            bobCookie = bob.cookie;
            bobSessionId = bob.sessionId;
        });

        it("returns 404 when Analyst A attempts to read Analyst B's query artifact", async () => {
            // Bob owns art_bob_201 containing confidential payroll data
            const res = await app.inject({
                method: "GET",
                url: "/api/queries/art_bob_201",
                headers: { cookie: aliceCookie },
            });

            assert.equal(res.statusCode, 404);
            const body = res.json();
            assert.equal(body.error, "Not Found");
            assert.equal(body.message, "Query artifact not found");

            // Verify confidential payload is NOT leaked in response
            const rawBody = res.body;
            assert.ok(!rawBody.includes("executive_payroll"), "Confidential SQL must not leak");
            assert.ok(!rawBody.includes("payroll query"), "Confidential prompt must not leak");
            assert.ok(!rawBody.includes("ssn"), "Sensitive schema fields must not leak");
        });

        it("returns 404 when Analyst B attempts to read Analyst A's query artifact", async () => {
            // Alice owns art_alice_101
            const res = await app.inject({
                method: "GET",
                url: "/api/queries/art_alice_101",
                headers: { cookie: bobCookie },
            });

            assert.equal(res.statusCode, 404);
            assert.equal(res.json().message, "Query artifact not found");
        });

        it("returns 404 when Analyst A attempts to read Analyst B's active session details", async () => {
            const res = await app.inject({
                method: "GET",
                url: `/api/sessions/${bobSessionId}`,
                headers: { cookie: aliceCookie },
            });

            assert.equal(res.statusCode, 404);
            assert.equal(res.json().message, "Session not found");
        });

        it("guarantees query artifact list is strictly scoped to the authenticated caller", async () => {
            // Alice's list view must contain art_alice_101 and NOT art_bob_201
            const aliceRes = await app.inject({
                method: "GET",
                url: "/api/queries",
                headers: { cookie: aliceCookie },
            });

            assert.equal(aliceRes.statusCode, 200);
            const aliceArtifacts: MockQueryArtifact[] = aliceRes.json().artifacts;
            assert.ok(aliceArtifacts.some((a) => a.id === "art_alice_101"));
            assert.ok(
                !aliceArtifacts.some((a) => a.id === "art_bob_201"),
                "Analyst A must not see Analyst B's artifacts in listing"
            );
            assert.ok(aliceArtifacts.every((a) => a.userId === "usr_analyst_a"));

            // Bob's list view must contain art_bob_201 and NOT art_alice_101
            const bobRes = await app.inject({
                method: "GET",
                url: "/api/queries",
                headers: { cookie: bobCookie },
            });

            assert.equal(bobRes.statusCode, 200);
            const bobArtifacts: MockQueryArtifact[] = bobRes.json().artifacts;
            assert.ok(bobArtifacts.some((a) => a.id === "art_bob_201"));
            assert.ok(
                !bobArtifacts.some((a) => a.id === "art_alice_101"),
                "Analyst B must not see Analyst A's artifacts in listing"
            );
            assert.ok(bobArtifacts.every((a) => a.userId === "usr_analyst_b"));
        });

        it("allows legitimate owner to read their own query artifact", async () => {
            // Alice reads art_alice_101
            const aliceRes = await app.inject({
                method: "GET",
                url: "/api/queries/art_alice_101",
                headers: { cookie: aliceCookie },
            });

            assert.equal(aliceRes.statusCode, 200);
            const aliceBody = aliceRes.json();
            assert.equal(aliceBody.artifact.id, "art_alice_101");
            assert.equal(aliceBody.artifact.userId, "usr_analyst_a");
            assert.equal(aliceBody.artifact.prompt, "Alice's sales performance breakdown");

            // Bob reads art_bob_201
            const bobRes = await app.inject({
                method: "GET",
                url: "/api/queries/art_bob_201",
                headers: { cookie: bobCookie },
            });

            assert.equal(bobRes.statusCode, 200);
            const bobBody = bobRes.json();
            assert.equal(bobBody.artifact.id, "art_bob_201");
            assert.equal(bobBody.artifact.userId, "usr_analyst_b");
            assert.equal(bobBody.artifact.prompt, "Bob's confidential executive payroll query");
        });

        it("returns identical 404 responses for unowned vs non-existent resources (anti-enumeration)", async () => {
            // Unowned resource (exists, but belongs to Bob)
            const unownedRes = await app.inject({
                method: "GET",
                url: "/api/queries/art_bob_201",
                headers: { cookie: aliceCookie },
            });

            // Completely nonexistent resource
            const nonExistentRes = await app.inject({
                method: "GET",
                url: "/api/queries/art_phantom_99999",
                headers: { cookie: aliceCookie },
            });

            assert.equal(unownedRes.statusCode, 404);
            assert.equal(nonExistentRes.statusCode, 404);

            const { timestamp: _t1, ...unownedBody } = unownedRes.json();
            const { timestamp: _t2, ...nonExistentBody } = nonExistentRes.json();

            // Bodies must be strictly identical so attacker cannot detect valid IDs via diffing
            assert.deepEqual(unownedBody, nonExistentBody);
        });
    });

    // ------------------------------------------------------------------------
    // CHECKLIST ITEM 4: Analyst A cannot delete or modify Analyst B's resources
    // ------------------------------------------------------------------------
    describe("4. Cross-User Mutation & Deletion Prevention", () => {
        let aliceCookie: string;
        let bobCookie: string;
        let bobSessionId: string;

        beforeEach(async () => {
            const alice = await loginAndGetCookie(app, "analyst_a");
            aliceCookie = alice.cookie;

            const bob = await loginAndGetCookie(app, "analyst_b");
            bobCookie = bob.cookie;
            bobSessionId = bob.sessionId;
        });

        it("rejects Analyst A's attempt to modify Analyst B's query artifact with 404", async () => {
            const maliciousPayload = {
                prompt: "HACKED BY ALICE",
                sql: "DROP TABLE users;",
            };

            const res = await app.inject({
                method: "PUT",
                url: "/api/queries/art_bob_201",
                headers: { cookie: aliceCookie },
                payload: maliciousPayload,
            });

            assert.equal(res.statusCode, 404);
            assert.equal(res.json().message, "Query artifact not found");

            // CRITICAL VERIFICATION: Bob's artifact in storage MUST remain unchanged
            const bobArtifactInStore = queryStore.get("art_bob_201")!;
            assert.equal(
                bobArtifactInStore.prompt,
                "Bob's confidential executive payroll query",
                "Prompt must remain unaltered"
            );
            assert.equal(
                bobArtifactInStore.sql,
                "SELECT employee_id, ssn, base_salary, bonus FROM executive_payroll;",
                "SQL query must remain unaltered"
            );
        });

        it("rejects Analyst A's attempt to delete Analyst B's query artifact with 404", async () => {
            const res = await app.inject({
                method: "DELETE",
                url: "/api/queries/art_bob_201",
                headers: { cookie: aliceCookie },
            });

            assert.equal(res.statusCode, 404);
            assert.equal(res.json().message, "Query artifact not found");

            // CRITICAL VERIFICATION: Bob's artifact MUST still exist in store
            assert.ok(queryStore.has("art_bob_201"), "Bob's artifact must not be deleted");
        });

        it("rejects Analyst A's attempt to delete/revoke Analyst B's active session with 404", async () => {
            const res = await app.inject({
                method: "DELETE",
                url: `/api/sessions/${bobSessionId}`,
                headers: { cookie: aliceCookie },
            });

            assert.equal(res.statusCode, 404);
            assert.equal(res.json().message, "Session not found");

            // Verify Bob's session remains active and usable
            const bobMeRes = await app.inject({
                method: "GET",
                url: "/api/auth/me",
                headers: { cookie: bobCookie },
            });
            assert.equal(bobMeRes.statusCode, 200);
            assert.equal(bobMeRes.json().user.username, "analyst_b");
        });

        it("allows legitimate owner Analyst B to modify their own query artifact", async () => {
            const updatePayload = {
                prompt: "Bob's updated quarterly forecast",
                sql: "SELECT quarter, revenue FROM forecasts WHERE year = 2026;",
            };

            const res = await app.inject({
                method: "PUT",
                url: "/api/queries/art_bob_201",
                headers: { cookie: bobCookie },
                payload: updatePayload,
            });

            assert.equal(res.statusCode, 200);
            const body = res.json();
            assert.equal(body.artifact.prompt, updatePayload.prompt);
            assert.equal(body.artifact.sql, updatePayload.sql);

            // Storage reflection
            const inStore = queryStore.get("art_bob_201")!;
            assert.equal(inStore.prompt, updatePayload.prompt);
            assert.equal(inStore.sql, updatePayload.sql);
        });

        it("allows legitimate owner Analyst B to delete their own query artifact", async () => {
            const res = await app.inject({
                method: "DELETE",
                url: "/api/queries/art_bob_201",
                headers: { cookie: bobCookie },
            });

            assert.equal(res.statusCode, 204);
            assert.equal(queryStore.has("art_bob_201"), false);
        });

        it("logging out as Analyst A does not terminate Analyst B's concurrent session", async () => {
            // Alice logs out
            const logoutRes = await app.inject({
                method: "POST",
                url: "/api/auth/logout",
                headers: { cookie: aliceCookie },
            });
            assert.equal(logoutRes.statusCode, 200);

            // Alice is logged out (401)
            const aliceMe = await app.inject({
                method: "GET",
                url: "/api/auth/me",
                headers: { cookie: aliceCookie },
            });
            assert.equal(aliceMe.statusCode, 401);

            // Bob remains logged in and authenticated (200)
            const bobMe = await app.inject({
                method: "GET",
                url: "/api/auth/me",
                headers: { cookie: bobCookie },
            });
            assert.equal(bobMe.statusCode, 200);
            assert.equal(bobMe.json().user.username, "analyst_b");
        });
    });

    // ------------------------------------------------------------------------
    // CHECKLIST ITEM 5: Analyst role cannot access Admin-only endpoints
    // ------------------------------------------------------------------------
    describe("5. Role-Based Access Control & Admin Endpoint Containment (403 Forbidden)", () => {
        let analystACookie: string;
        let analystBCookie: string;
        let adminCookie: string;

        beforeEach(async () => {
            const a = await loginAndGetCookie(app, "analyst_a");
            analystACookie = a.cookie;

            const b = await loginAndGetCookie(app, "analyst_b");
            analystBCookie = b.cookie;

            const adm = await loginAndGetCookie(app, "admin_user");
            adminCookie = adm.cookie;
        });

        it("returns 403 Forbidden when Analyst A accesses GET /api/admin/metrics", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/admin/metrics",
                headers: { cookie: analystACookie },
            });

            assert.equal(res.statusCode, 403);
            const body = res.json();
            assert.equal(body.error, "Forbidden");
            assert.equal(
                body.message,
                "Insufficient permissions to access this administrative resource"
            );
            assert.ok(body.timestamp);
        });

        it("returns 403 Forbidden when Analyst B accesses POST /api/admin/system/reset-cache", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/admin/system/reset-cache",
                headers: { cookie: analystBCookie },
            });

            assert.equal(res.statusCode, 403);
            assert.equal(res.json().error, "Forbidden");
        });

        it("returns 403 Forbidden when Analyst A accesses GET /api/admin/audit-logs", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/admin/audit-logs",
                headers: { cookie: analystACookie },
            });

            assert.equal(res.statusCode, 403);
            assert.equal(res.json().error, "Forbidden");
        });

        it("returns 403 Forbidden when Analyst B attempts DELETE /api/admin/users/:id", async () => {
            const res = await app.inject({
                method: "DELETE",
                url: "/api/admin/users/usr_analyst_a",
                headers: { cookie: analystBCookie },
            });

            assert.equal(res.statusCode, 403);
            assert.equal(res.json().error, "Forbidden");
        });

        it("allows Administrator to access all administrative endpoints with 200 OK", async () => {
            // Metrics
            const metricsRes = await app.inject({
                method: "GET",
                url: "/api/admin/metrics",
                headers: { cookie: adminCookie },
            });
            assert.equal(metricsRes.statusCode, 200);
            assert.equal(metricsRes.json().status, "admin_metrics");

            // Reset cache
            const resetRes = await app.inject({
                method: "POST",
                url: "/api/admin/system/reset-cache",
                headers: { cookie: adminCookie },
            });
            assert.equal(resetRes.statusCode, 200);
            assert.equal(resetRes.json().success, true);

            // Audit logs
            const logsRes = await app.inject({
                method: "GET",
                url: "/api/admin/audit-logs",
                headers: { cookie: adminCookie },
            });
            assert.equal(logsRes.statusCode, 200);
            assert.ok(Array.isArray(logsRes.json().logs));

            // User deactivation
            const userDeleteRes = await app.inject({
                method: "DELETE",
                url: "/api/admin/users/usr_analyst_b",
                headers: { cookie: adminCookie },
            });
            assert.equal(userDeleteRes.statusCode, 200);
            assert.equal(userDeleteRes.json().success, true);
        });

        it("enforces authentication (401) before authorization (403) on admin endpoints", async () => {
            // An unauthenticated request to admin route MUST return 401, not 403,
            // to avoid revealing route existence or privilege requirements to unauthenticated probes.
            const res = await app.inject({
                method: "GET",
                url: "/api/admin/metrics",
            });

            assert.equal(res.statusCode, 401);
            assert.equal(res.json().error, "Unauthorized");
        });
    });

    // ------------------------------------------------------------------------
    // 6. ADVANCED PENETRATION & INPUT TAMPERING VECTORS
    // ------------------------------------------------------------------------
    describe("6. Penetration Hardening & Parameter Tampering", () => {
        let aliceCookie: string;

        beforeEach(async () => {
            const a = await loginAndGetCookie(app, "analyst_a");
            aliceCookie = a.cookie;
        });

        it("rejects path traversal attacks in resource ID with 404", async () => {
            const traversalPaths = [
                "/api/queries/..%2F..%2Fadmin",
                "/api/queries/%2e%2e%2fadmin",
                "/api/queries/....//admin",
            ];

            for (const path of traversalPaths) {
                const res = await app.inject({
                    method: "GET",
                    url: path,
                    headers: { cookie: aliceCookie },
                });

                assert.ok(
                    res.statusCode === 404 || res.statusCode === 400,
                    `Expected 404 or 400 for path traversal '${path}', got ${res.statusCode}`
                );
            }
        });

        it("rejects SQL injection probes in resource identifier parameters with 404", async () => {
            const sqliIds = [
                "art_alice_101' OR '1'='1",
                "art_alice_101; DROP TABLE users;--",
                "art_alice_101' UNION SELECT * FROM users--",
            ];

            for (const id of sqliIds) {
                const res = await app.inject({
                    method: "GET",
                    url: `/api/queries/${encodeURIComponent(id)}`,
                    headers: { cookie: aliceCookie },
                });

                assert.equal(res.statusCode, 404);
                assert.equal(res.json().message, "Query artifact not found");
            }
        });

        it("rejects session hijacking via forged session cookie header", async () => {
            // Attacker knows Bob's user ID or guesses Bob's session ID format,
            // but cannot produce a valid cryptographic signature without the server secret.
            const forgedCookies = [
                "session_id=usr_analyst_b",
                "session_id=s%3Ausr_analyst_b.fake_signature",
                "session_id=s%3Ausr_analyst_b",
                "session_id=null",
                "session_id=undefined",
            ];

            for (const forged of forgedCookies) {
                const res = await app.inject({
                    method: "GET",
                    url: "/api/auth/me",
                    headers: { cookie: forged },
                });

                assert.equal(
                    res.statusCode,
                    401,
                    `Expected 401 for forged cookie '${forged}', got ${res.statusCode}`
                );
            }
        });
    });
});
