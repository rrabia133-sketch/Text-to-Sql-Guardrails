import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "../../src/config/env.js";
import { hashPassword, verifyPassword } from "../../src/modules/auth/password.util.js";
import { SchemaService } from "../../src/modules/schema/schema.service.js";
import { buildApp } from "../../src/app.js";
import { InMemoryAuthRepository } from "../helpers/in-memory-auth.repo.js";
import { MetricsService } from "../../src/modules/metrics/metrics.service.js";
import type { Pool } from "pg";

describe("Production-Grade Hardening & Fail-Closed Verification Suite", () => {
    describe("1. Production Environment Configuration Fail-Closed Gate", () => {
        const validProdBase = {
            NODE_ENV: "production" as const,
            SESSION_SECRET: "prod_cryptographic_random_session_key_64_bytes_minimum_value",
            ANALYTICS_DB_URL: "postgresql://analytics_user:strong_pass@analytics-db:5432/analytics_db?sslmode=verify-full",
            APP_DB_URL: "postgresql://app_user:strong_pass@app-db:5432/app_db?sslmode=verify-full",
            PROVIDER_MODE: "local" as const,
        };

        it("rejects missing or default placeholder SESSION_SECRET in production", () => {
            assert.throws(
                () =>
                    validateConfig({
                        ...validProdBase,
                        SESSION_SECRET: undefined,
                    }),
                /Invalid SESSION_SECRET/
            );

            assert.throws(
                () =>
                    validateConfig({
                        ...validProdBase,
                        SESSION_SECRET: "dev-session-secret-change-in-production-min-32-chars",
                    }),
                /production environment cannot use default or placeholder development secret/
            );

            assert.throws(
                () =>
                    validateConfig({
                        ...validProdBase,
                        SESSION_SECRET: "your_dev_session_secret_min_32_characters_here",
                    }),
                /production environment cannot use default or placeholder development secret/
            );
        });

        it("rejects missing database URLs in production instead of falling back to localhost", () => {
            assert.throws(
                () =>
                    validateConfig({
                        ...validProdBase,
                        ANALYTICS_DB_URL: undefined,
                    }),
                /Invalid ANALYTICS_DB_URL/
            );

            assert.throws(
                () =>
                    validateConfig({
                        ...validProdBase,
                        APP_DB_URL: undefined,
                    }),
                /Invalid APP_DB_URL/
            );
        });

        it("rejects missing or placeholder GROQ_API_KEY when PROVIDER_MODE is cloud or hybrid in production", () => {
            assert.throws(
                () =>
                    validateConfig({
                        ...validProdBase,
                        PROVIDER_MODE: "cloud",
                        GROQ_API_KEY: "",
                    }),
                /Invalid GROQ_API_KEY/
            );

            assert.throws(
                () =>
                    validateConfig({
                        ...validProdBase,
                        PROVIDER_MODE: "hybrid",
                        GROQ_API_KEY: "your_groq_api_key_here",
                    }),
                /Invalid GROQ_API_KEY/
            );
        });

        it("validates explicit production config and applies production defaults for trustProxy and pool sizes", () => {
            const cfg = validateConfig({
                ...validProdBase,
                PROVIDER_MODE: "cloud",
                GROQ_API_KEY: "gsk_live_secret_key_9999",
            });

            assert.equal(cfg.NODE_ENV, "production");
            assert.equal(cfg.TRUST_PROXY, true);
            assert.equal(cfg.APP_DB_POOL_MAX, 20);
            assert.equal(cfg.ANALYTICS_DB_POOL_MAX, 30);
        });
    });

    describe("2. Cryptographic Password Hashing (scrypt + timingSafeEqual)", () => {
        it("hashes and verifies passwords with unique random salts", () => {
            const hash1 = hashPassword("CorrectHorseBatteryStaple!99");
            const hash2 = hashPassword("CorrectHorseBatteryStaple!99");

            assert.notEqual(hash1, hash2, "Each hash must use a unique random salt");
            assert.ok(hash1.startsWith("scrypt$"));
            assert.equal(verifyPassword("CorrectHorseBatteryStaple!99", hash1), true);
            assert.equal(verifyPassword("CorrectHorseBatteryStaple!99", hash2), true);
            assert.equal(verifyPassword("WrongPassword!99", hash1), false);
            assert.equal(verifyPassword("", hash1), false);
            assert.equal(verifyPassword("CorrectHorseBatteryStaple!99", "malformed$hash"), false);
        });
    });

    describe("3. Production Authentication, Cookie Hardening, User Enumeration Lockdown & Rate Limiting", () => {
        it("enforces password verification, Strict/Secure cookies, HSTS, and admin-only /users in production", async () => {
            const analystPasswordHash = hashPassword("AnalystProdSecret#2026");
            const adminPasswordHash = hashPassword("AdminProdSecret#2026");

            const authRepo = new InMemoryAuthRepository([
                {
                    id: "usr_analyst_prod",
                    username: "analyst_prod",
                    email: "analyst@corp.internal",
                    displayName: "Production Analyst",
                    role: "analyst",
                    passwordHash: analystPasswordHash,
                    createdAt: new Date("2026-01-01T00:00:00.000Z"),
                },
                {
                    id: "usr_admin_prod",
                    username: "admin_prod",
                    email: "admin@corp.internal",
                    displayName: "Production Admin",
                    role: "admin",
                    passwordHash: adminPasswordHash,
                    createdAt: new Date("2026-01-02T00:00:00.000Z"),
                },
            ]);

            const prodConfig = validateConfig({
                NODE_ENV: "production",
                SESSION_SECRET: "prod_cryptographic_random_session_key_64_bytes_minimum_value",
                ANALYTICS_DB_URL: "postgresql://analytics_user:pass@127.0.0.1:5434/analytics_db",
                APP_DB_URL: "postgresql://app_user:pass@127.0.0.1:5434/app_db",
                PROVIDER_MODE: "local",
                AUTH_RATE_LIMIT_MAX: 6,
                AUTH_RATE_LIMIT_WINDOW_MS: 60_000,
            });

            const app = await buildApp({
                appConfig: prodConfig,
                authRepo,
                appPool: { end: async () => {} } as unknown as Pool,
                analyticsPool: { end: async () => {} } as unknown as Pool,
                dbChecker: {
                    checkHealth: async () => ({
                        analyticsDb: { status: "connected", isReadOnly: true },
                        appDb: { status: "connected" },
                    }),
                    close: async () => {},
                },
                logger: false,
            });
            await app.ready();

            try {
                // 0. Public auth config reports passwordRequired=true in production
                const cfgRes = await app.inject({
                    method: "GET",
                    url: "/api/auth/config",
                });
                assert.equal(cfgRes.statusCode, 200);
                assert.deepEqual(JSON.parse(cfgRes.body), {
                    mode: "production",
                    passwordRequired: true,
                    registrationEnabled: true,
                });

                // 0b. Self-registration creates an analyst account with hashed password and rejects duplicates
                const regRes = await app.inject({
                    method: "POST",
                    url: "/api/auth/register",
                    payload: {
                        username: "new_analyst",
                        email: "new_analyst@corp.internal",
                        password: "StrongPassword#2026",
                        displayName: "New Analyst",
                    },
                });
                assert.equal(regRes.statusCode, 201);
                const regBody = JSON.parse(regRes.body);
                assert.equal(regBody.user.username, "new_analyst");
                assert.equal(regBody.user.role, "analyst");

                const dupRegRes = await app.inject({
                    method: "POST",
                    url: "/api/auth/register",
                    payload: {
                        username: "new_analyst",
                        email: "other@corp.internal",
                        password: "StrongPassword#2026",
                    },
                });
                assert.equal(dupRegRes.statusCode, 409);

                // 1. Anonymous user enumeration via GET /api/auth/users is blocked with 401
                const anonUsersRes = await app.inject({
                    method: "GET",
                    url: "/api/auth/users",
                });
                assert.equal(anonUsersRes.statusCode, 401);

                // 2. Passwordless login attempt is rejected with 401
                const noPassRes = await app.inject({
                    method: "POST",
                    url: "/api/auth/login",
                    payload: { username: "analyst_prod" },
                });
                assert.equal(noPassRes.statusCode, 401);

                // 3. Wrong password login attempt is rejected with 401
                const wrongPassRes = await app.inject({
                    method: "POST",
                    url: "/api/auth/login",
                    payload: { username: "analyst_prod", password: "WrongPassword" },
                });
                assert.equal(wrongPassRes.statusCode, 401);

                // 4. Valid analyst login over HTTPS proxy succeeds and sets HttpOnly + Secure + SameSite=Strict + HSTS
                const analystLoginRes = await app.inject({
                    method: "POST",
                    url: "/api/auth/login",
                    headers: { "x-forwarded-proto": "https" },
                    payload: { username: "analyst_prod", password: "AnalystProdSecret#2026" },
                });
                assert.equal(analystLoginRes.statusCode, 200);
                assert.match(
                    String(analystLoginRes.headers["strict-transport-security"]),
                    /max-age=31536000/
                );

                const analystCookieRaw = analystLoginRes.headers["set-cookie"];
                const analystCookie = Array.isArray(analystCookieRaw)
                    ? analystCookieRaw[0]
                    : String(analystCookieRaw);
                assert.match(analystCookie, /HttpOnly/i);
                assert.match(analystCookie, /Secure/i);
                assert.match(analystCookie, /SameSite=Strict/i);

                // 5. Non-admin analyst cannot enumerate GET /api/auth/users in production (403 Forbidden)
                const analystUsersRes = await app.inject({
                    method: "GET",
                    url: "/api/auth/users",
                    headers: { cookie: analystCookie },
                });
                assert.equal(analystUsersRes.statusCode, 403);

                // 6. Admin login succeeds and CAN list users in production (200 OK)
                const adminLoginRes = await app.inject({
                    method: "POST",
                    url: "/api/auth/login",
                    payload: { username: "admin_prod", password: "AdminProdSecret#2026" },
                });
                assert.equal(adminLoginRes.statusCode, 200);
                const adminCookieRaw = adminLoginRes.headers["set-cookie"];
                const adminCookie = Array.isArray(adminCookieRaw)
                    ? adminCookieRaw[0]
                    : String(adminCookieRaw);

                const adminUsersRes = await app.inject({
                    method: "GET",
                    url: "/api/auth/users",
                    headers: { cookie: adminCookie },
                });
                assert.equal(adminUsersRes.statusCode, 200);

                // 7. Exceeding AUTH_RATE_LIMIT_MAX (5 attempts) triggers 429 Too Many Requests with Retry-After
                const rateLimitedRes = await app.inject({
                    method: "POST",
                    url: "/api/auth/login",
                    payload: { username: "analyst_prod", password: "WrongPassword" },
                });
                assert.equal(rateLimitedRes.statusCode, 429);
                assert.ok(rateLimitedRes.headers["retry-after"]);
            } finally {
                await app.close();
            }
        });
    });

    describe("4. Production SchemaService Fail-Closed Introspection", () => {
        it("refuses to fallback to canonical synthetic fixture when failClosed is enabled", async () => {
            const missingPoolService = new SchemaService(null, 300_000, { failClosed: true });
            await assert.rejects(
                () => missingPoolService.getSanitizedCatalog(),
                /Fail-closed: analyticsPool is required in production mode/
            );

            const brokenPool = {
                query: async () => {
                    throw new Error("connection refused");
                },
            } as unknown as Pool;
            const brokenPoolService = new SchemaService(brokenPool, 300_000, { failClosed: true });
            await assert.rejects(
                () => brokenPoolService.getSanitizedCatalog(),
                /Fail-closed: unable to introspect live analytics_db schema/
            );
        });
    });

    describe("5. Prometheus Metrics Endpoint Bearer Token Protection", () => {
        it("enforces METRICS_BEARER_TOKEN when configured", async () => {
            const authRepo = new InMemoryAuthRepository();
            const metricsService = new MetricsService();
            const cfg = validateConfig({
                NODE_ENV: "test",
                METRICS_BEARER_TOKEN: "prom_scrape_token_2026",
            });

            const app = await buildApp({
                appConfig: cfg,
                authRepo,
                metricsService,
                appPool: { end: async () => {} } as unknown as Pool,
                analyticsPool: { end: async () => {} } as unknown as Pool,
                logger: false,
            });
            await app.ready();

            try {
                const unauthRes = await app.inject({
                    method: "GET",
                    url: "/api/v1/metrics",
                });
                assert.equal(unauthRes.statusCode, 401);

                const wrongTokenRes = await app.inject({
                    method: "GET",
                    url: "/api/v1/metrics",
                    headers: { authorization: "Bearer wrong_token" },
                });
                assert.equal(wrongTokenRes.statusCode, 401);

                const validTokenRes = await app.inject({
                    method: "GET",
                    url: "/api/v1/metrics",
                    headers: { authorization: "Bearer prom_scrape_token_2026" },
                });
                assert.equal(validTokenRes.statusCode, 200);
                assert.match(validTokenRes.payload, /# HELP http_requests_total/);
            } finally {
                await app.close();
            }
        });
    });
});
