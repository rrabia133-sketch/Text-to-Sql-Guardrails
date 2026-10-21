import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config/env.js";

import { InMemoryAuthRepository } from "../helpers/in-memory-auth.repo.js";

const testConfig = { ...config, NODE_ENV: "test" as const };

describe("Auth Routes & Session Plugin Integration Tests", () => {
    let app: FastifyInstance;
    let authRepo: InMemoryAuthRepository;

    before(async () => {
        authRepo = new InMemoryAuthRepository();
        app = await buildApp({
            appConfig: testConfig,
            authRepo,
            appPool: { end: async () => {} } as any,
            dbChecker: {
                checkHealth: async () => ({
                    analyticsDb: { status: "connected", isReadOnly: true },
                    appDb: { status: "connected" },
                }),
                close: async () => {},
            } as any,
        });
        await app.ready();
    });

    after(async () => {
        await app.close();
    });

    describe("1. Authentication Guards", () => {
        it("returns HTTP 401 when accessing GET /api/auth/me without a session cookie", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/auth/me",
            });

            assert.equal(res.statusCode, 401);
            const body = JSON.parse(res.body);
            assert.equal(body.error, "Unauthorized");
        });

        it("returns HTTP 401 when accessing GET /api/auth/me with an invalid or tampered cookie", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/auth/me",
                headers: {
                    cookie: "session_id=fake_unsigned_session_token",
                },
            });

            assert.equal(res.statusCode, 401);
        });
    });

    describe("2. Login Flow", () => {
        it("returns HTTP 400 if username is missing", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: {},
            });

            assert.equal(res.statusCode, 400);
        });

        it("returns HTTP 401 for non-existent username", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { username: "ghost_user" },
            });

            assert.equal(res.statusCode, 401);
            const body = JSON.parse(res.body);
            assert.equal(body.message, "Invalid credentials");
        });

        it("successfully logs in seeded Analyst A and sets signed httpOnly cookie", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { username: "analyst_a" },
            });

            assert.equal(res.statusCode, 200);
            const body = JSON.parse(res.body);
            assert.equal(body.user.username, "analyst_a");
            assert.equal(body.user.role, "analyst");
            assert.equal(body.user.displayName, "Analyst Alice");
            assert.ok(body.sessionId);

            // Assert Set-Cookie header contains session_id and is HttpOnly
            const setCookie = res.headers["set-cookie"];
            assert.ok(setCookie, "Set-Cookie header must be present");
            const cookieString = Array.isArray(setCookie) ? setCookie[0] : setCookie;
            assert.ok(cookieString.includes("session_id="));
            assert.ok(cookieString.includes("HttpOnly"));
        });
    });

    describe("3. Session Lifecycle (Login -> /me -> Logout -> /me)", () => {
        it("persists identity across requests and clears on logout", async () => {
            // Step 1: Login as admin
            const loginRes = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { username: "admin_user" },
            });
            assert.equal(loginRes.statusCode, 200);

            const setCookieHeader = loginRes.headers["set-cookie"];
            assert.ok(setCookieHeader);
            const cookieVal = Array.isArray(setCookieHeader)
                ? setCookieHeader[0]
                : setCookieHeader;

            // Step 2: Access GET /api/auth/me with the cookie
            const meRes = await app.inject({
                method: "GET",
                url: "/api/auth/me",
                headers: {
                    cookie: cookieVal,
                },
            });

            assert.equal(meRes.statusCode, 200);
            const meBody = JSON.parse(meRes.body);
            assert.equal(meBody.user.username, "admin_user");
            assert.equal(meBody.user.role, "admin");

            // Step 3: Logout
            const logoutRes = await app.inject({
                method: "POST",
                url: "/api/auth/logout",
                headers: {
                    cookie: cookieVal,
                },
            });
            assert.equal(logoutRes.statusCode, 200);

            // Step 4: Re-attempting /me with revoked session returns 401
            const meAfterLogout = await app.inject({
                method: "GET",
                url: "/api/auth/me",
                headers: {
                    cookie: cookieVal,
                },
            });
            assert.equal(meAfterLogout.statusCode, 401);
        });
    });

    describe("4. Seed Users List", () => {
        it("GET /api/auth/users returns available accounts", async () => {
            const res = await app.inject({
                method: "GET",
                url: "/api/auth/users",
            });

            assert.equal(res.statusCode, 200);
            const users = JSON.parse(res.body);
            assert.ok(users.length >= 3);
            const usernames = users.map((u: { username: string }) => u.username);
            assert.ok(usernames.includes("analyst_a"));
            assert.ok(usernames.includes("analyst_b"));
            assert.ok(usernames.includes("admin_user"));
        });
    });
});
