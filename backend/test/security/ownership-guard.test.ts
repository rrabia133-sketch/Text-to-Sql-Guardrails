import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

import {
    requireRole,
    requireAdmin,
    createOwnershipGuard,
} from "../../src/modules/auth/ownership.guard.js";

import type {
    UserRecord,
} from "../../src/modules/auth/auth.repository.js";

// =====================================================
// 1. MOCK USERS
// =====================================================

const analystA: UserRecord = {
    id: "usr_analyst_a",
    email: "analyst-a@example.com",
    username: "analyst_a",
    displayName: "Analyst Alice",
    role: "analyst",
    createdAt: new Date(),
};

const analystB: UserRecord = {
    id: "usr_analyst_b",
    email: "analyst-b@example.com",
    username: "analyst_b",
    displayName: "Analyst Bob",
    role: "analyst",
    createdAt: new Date(),
};

const adminUser: UserRecord = {
    id: "usr_admin_01",
    email: "admin@example.com",
    username: "admin_user",
    displayName: "Admin",
    role: "admin",
    createdAt: new Date(),
};

// =====================================================
// 2. MOCK RESOURCE
// =====================================================

interface MockArtifact {
    id: string;
    userId: string;
    prompt: string;
}

function createMockArtifacts(): Record<string, MockArtifact> {
    return {
        art_101: {
            id: "art_101",
            userId: analystA.id,
            prompt: "Alice's secret query",
        },
        art_102: {
            id: "art_102",
            userId: analystB.id,
            prompt: "Bob's private query",
        },
    };
}

// =====================================================
// 3. TEST SERVER FACTORY
// =====================================================

function createTestServer(
    currentUser: UserRecord | null,
): FastifyInstance {
    const app = Fastify();

    const mockArtifacts = createMockArtifacts();

    // Simulate authentication hook
    app.addHook("preHandler", async (request) => {
        request.user = currentUser;
    });

    // Admin-only endpoint
    app.get(
        "/api/admin/metrics",
        {
            preHandler: [requireAdmin],
        },
        async () => {
            return {
                status: "admin_only_data",
            };
        },
    );

    // Role-based endpoint
    app.get(
        "/api/analyst/dashboard",
        {
            preHandler: [requireRole("analyst")],
        },
        async () => {
            return {
                status: "analyst_dashboard",
            };
        },
    );

    // Resource ownership protection
    const artifactGuard = createOwnershipGuard<MockArtifact>({
        paramName: "id",
        resourceName: "Query artifact",
        loader: async (id) => {
            return mockArtifacts[id] ?? null;
        },
    });

    // Protected resource route
    app.get(
        "/api/queries/:id",
        {
            preHandler: [artifactGuard],
        },
        async (request) => {
            return {
                artifact: request.loadedResource,
            };
        },
    );

    return app;
}

// =====================================================
// 4. TEST HELPER
// =====================================================

async function withTestServer(
    currentUser: UserRecord | null,
    testFn: (app: FastifyInstance) => Promise<void>,
): Promise<void> {
    const app = createTestServer(currentUser);

    try {
        await app.ready();
        await testFn(app);
    } finally {
        await app.close();
    }
}

// =====================================================
// 5. AUTHORIZATION TESTS
// =====================================================

describe("Task 13: Ownership Guard & Role Guard", () => {
    // -------------------------------------------------
    // ROLE GUARD: REQUIRE ADMIN
    // -------------------------------------------------

    describe("1. Role Guard (requireAdmin)", () => {
        it("returns 401 when user is not authenticated", async () => {
            await withTestServer(null, async (app) => {
                const res = await app.inject({
                    method: "GET",
                    url: "/api/admin/metrics",
                });

                assert.equal(res.statusCode, 401);
            });
        });

        it("returns 403 when an analyst accesses admin endpoint", async () => {
            await withTestServer(analystA, async (app) => {
                const res = await app.inject({
                    method: "GET",
                    url: "/api/admin/metrics",
                });

                assert.equal(res.statusCode, 403);

                const body = res.json();
                assert.equal(body.error, "Forbidden");
            });
        });

        it("allows admin access with 200 OK", async () => {
            await withTestServer(adminUser, async (app) => {
                const res = await app.inject({
                    method: "GET",
                    url: "/api/admin/metrics",
                });

                assert.equal(res.statusCode, 200);
                assert.deepEqual(res.json(), {
                    status: "admin_only_data",
                });
            });
        });
    });

    // -------------------------------------------------
    // ROLE GUARD: REQUIRE ROLE
    // -------------------------------------------------

    describe("2. Role Guard (requireRole)", () => {
        it("returns 401 for unauthenticated user", async () => {
            await withTestServer(null, async (app) => {
                const res = await app.inject({
                    method: "GET",
                    url: "/api/analyst/dashboard",
                });

                assert.equal(res.statusCode, 401);
            });
        });

        it("allows analyst to access analyst endpoint", async () => {
            await withTestServer(analystA, async (app) => {
                const res = await app.inject({
                    method: "GET",
                    url: "/api/analyst/dashboard",
                });

                assert.equal(res.statusCode, 200);
                assert.deepEqual(res.json(), {
                    status: "analyst_dashboard",
                });
            });
        });

        it("returns 403 when admin lacks the required analyst role", async () => {
            await withTestServer(adminUser, async (app) => {
                const res = await app.inject({
                    method: "GET",
                    url: "/api/analyst/dashboard",
                });

                assert.equal(res.statusCode, 403);
            });
        });
    });

    // -------------------------------------------------
    // RESOURCE OWNERSHIP / IDOR
    // -------------------------------------------------

    describe("3. IDOR Ownership Guard", () => {
        it("returns 401 when user is not authenticated", async () => {
            await withTestServer(null, async (app) => {
                const res = await app.inject({
                    method: "GET",
                    url: "/api/queries/art_101",
                });

                assert.equal(res.statusCode, 401);
            });
        });

        it("returns 404 when resource does not exist", async () => {
            await withTestServer(analystA, async (app) => {
                const res = await app.inject({
                    method: "GET",
                    url: "/api/queries/non_existent",
                });

                assert.equal(res.statusCode, 404);
                assert.equal(
                    res.json().message,
                    "Query artifact not found",
                );
            });
        });

        it("returns 404 when Bob accesses Alice's resource", async () => {
            await withTestServer(analystB, async (app) => {
                const res = await app.inject({
                    method: "GET",
                    url: "/api/queries/art_101",
                });

                assert.equal(res.statusCode, 404);
                assert.equal(
                    res.json().message,
                    "Query artifact not found",
                );
            });
        });

        it("returns 404 when Alice accesses Bob's resource", async () => {
            await withTestServer(analystA, async (app) => {
                const res = await app.inject({
                    method: "GET",
                    url: "/api/queries/art_102",
                });

                assert.equal(res.statusCode, 404);
            });
        });

        it("allows Alice to access her own resource", async () => {
            await withTestServer(analystA, async (app) => {
                const res = await app.inject({
                    method: "GET",
                    url: "/api/queries/art_101",
                });

                assert.equal(res.statusCode, 200);

                const body = res.json();
                assert.equal(body.artifact.id, "art_101");
                assert.equal(body.artifact.userId, analystA.id);
                assert.equal(body.artifact.prompt, "Alice's secret query");
            });
        });

        it("allows Bob to access his own resource", async () => {
            await withTestServer(analystB, async (app) => {
                const res = await app.inject({
                    method: "GET",
                    url: "/api/queries/art_102",
                });

                assert.equal(res.statusCode, 200);
                assert.equal(
                    res.json().artifact.prompt,
                    "Bob's private query",
                );
            });
        });

        it("returns identical 404 responses for missing and unauthorized resources", async () => {
            await withTestServer(analystB, async (app) => {
                const missing = await app.inject({
                    method: "GET",
                    url: "/api/queries/does_not_exist",
                });

                const unauthorized = await app.inject({
                    method: "GET",
                    url: "/api/queries/art_101",
                });

                assert.equal(missing.statusCode, 404);
                assert.equal(unauthorized.statusCode, 404);
                const { timestamp: _t1, ...missingBody } = missing.json();
                const { timestamp: _t2, ...unauthorizedBody } = unauthorized.json();
                assert.deepEqual(unauthorizedBody, missingBody);
            });
        });
    });
});
