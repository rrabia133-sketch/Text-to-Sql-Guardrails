import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { AuthRepository } from "../../src/modules/auth/auth.repository.js";

const APP_DB_URL =
    process.env.APP_DB_URL ||
    "postgresql://app_user:app_password@127.0.0.1:5434/app_db";

describe("AuthRepository Integration Tests (app_db)", () => {
    let pool: Pool | null = null;
    let repo: AuthRepository | null = null;
    let dbAvailable = false;

    before(async () => {
        try {
            pool = new Pool({
                connectionString: APP_DB_URL,
                connectionTimeoutMillis: 1500,
            });
            const client = await pool.connect();
            client.release();
            repo = new AuthRepository(pool);
            dbAvailable = true;
        } catch {
            dbAvailable = false;
        }
    });

    after(async () => {
        if (pool) {
            await pool.end().catch(() => {});
        }
    });

    describe("User Queries", () => {
        it("finds seeded Analyst A by ID", async (t) => {
            if (!dbAvailable || !repo) {
                t.skip("PostgreSQL (app_db) is not running on " + APP_DB_URL);
                return;
            }
            const user = await repo.findUserById("usr_analyst_a");
            assert.ok(user, "User should exist");
            assert.equal(user.email, "analyst-a@example.com");
            assert.equal(user.role, "analyst");
            assert.equal(user.displayName, "Analyst Alice");
        });

        it("finds seeded Analyst B by username", async (t) => {
            if (!dbAvailable || !repo) {
                t.skip("PostgreSQL (app_db) is not running on " + APP_DB_URL);
                return;
            }
            const user = await repo.findUserByUsername("analyst_b");
            assert.ok(user, "User should exist");
            assert.equal(user.id, "usr_analyst_b");
            assert.equal(user.email, "analyst-b@example.com");
        });

        it("finds seeded Administrator by email", async (t) => {
            if (!dbAvailable || !repo) {
                t.skip("PostgreSQL (app_db) is not running on " + APP_DB_URL);
                return;
            }
            const user = await repo.findUserByEmail("admin@example.com");
            assert.ok(user, "User should exist");
            assert.equal(user.role, "admin");
            assert.equal(user.username, "admin_user");
        });

        it("returns null for non-existent user", async (t) => {
            if (!dbAvailable || !repo) {
                t.skip("PostgreSQL (app_db) is not running on " + APP_DB_URL);
                return;
            }
            const user = await repo.findUserById("non_existent_id");
            assert.equal(user, null);
        });

        it("lists all seeded users", async (t) => {
            if (!dbAvailable || !repo) {
                t.skip("PostgreSQL (app_db) is not running on " + APP_DB_URL);
                return;
            }
            const users = await repo.listUsers();
            assert.ok(users.length >= 3);
            const emails = users.map((u) => u.email);
            assert.ok(emails.includes("analyst-a@example.com"));
            assert.ok(emails.includes("analyst-b@example.com"));
            assert.ok(emails.includes("admin@example.com"));
        });
    });

    describe("Session Lifecycle Queries", () => {
        const testSessionId = `test_sess_${Date.now()}`;
        const expiredSessionId = `test_expired_${Date.now()}`;

        after(async () => {
            if (repo && dbAvailable) {
                await repo.deleteSession(testSessionId).catch(() => {});
                await repo.deleteSession(expiredSessionId).catch(() => {});
            }
        });

        it("creates and retrieves an active session with joined user details", async (t) => {
            if (!dbAvailable || !repo) {
                t.skip("PostgreSQL (app_db) is not running on " + APP_DB_URL);
                return;
            }
            const oneHourLater = new Date(Date.now() + 60 * 60 * 1000);
            const created = await repo.createSession({
                id: testSessionId,
                userId: "usr_analyst_a",
                expiresAt: oneHourLater,
            });

            assert.equal(created.id, testSessionId);
            assert.equal(created.userId, "usr_analyst_a");

            const found = await repo.findSessionById(testSessionId);
            assert.ok(found, "Session with user should be found");
            assert.equal(found.session.id, testSessionId);
            assert.equal(found.user.id, "usr_analyst_a");
            assert.equal(found.user.email, "analyst-a@example.com");
            assert.equal(found.user.role, "analyst");
        });

        it("returns null for an expired session", async (t) => {
            if (!dbAvailable || !repo) {
                t.skip("PostgreSQL (app_db) is not running on " + APP_DB_URL);
                return;
            }
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            await repo.createSession({
                id: expiredSessionId,
                userId: "usr_analyst_b",
                expiresAt: oneHourAgo,
            });

            const found = await repo.findSessionById(expiredSessionId);
            assert.equal(found, null, "Expired session should not be returned");
        });

        it("deletes a session by ID (logout)", async (t) => {
            if (!dbAvailable || !repo) {
                t.skip("PostgreSQL (app_db) is not running on " + APP_DB_URL);
                return;
            }
            const deleted = await repo.deleteSession(testSessionId);
            assert.equal(deleted, true);

            const foundAfterDelete = await repo.findSessionById(testSessionId);
            assert.equal(foundAfterDelete, null);
        });

        it("cleans up expired sessions", async (t) => {
            if (!dbAvailable || !repo) {
                t.skip("PostgreSQL (app_db) is not running on " + APP_DB_URL);
                return;
            }
            const cleanedCount = await repo.deleteExpiredSessions();
            assert.ok(cleanedCount >= 1, "Should have removed at least the expired test session");
        });
    });
});
