import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config/env.js";
import type { IDatabaseChecker } from "../../src/modules/health/health.service.js";
import type { HealthResponse, ReadinessResponse } from "@text2sql/contracts";

const testConfig = { ...config, NODE_ENV: "test" as const };

describe("Health & Readiness Integration Tests", () => {
    describe("GET /health (Liveness probe)", () => {
        it("returns HTTP 200 with service liveness information", async () => {
            const mockDbChecker: IDatabaseChecker = {
                checkHealth: async () => ({
                    analyticsDb: { status: "connected", isReadOnly: true, latencyMs: 5 },
                    appDb: { status: "connected", latencyMs: 5 },
                }),
            };

            const app = await buildApp({
                dbChecker: mockDbChecker,
                appConfig: testConfig,
            });

            const res = await app.inject({
                method: "GET",
                url: "/health",
            });

            assert.equal(res.statusCode, 200);

            const body = JSON.parse(res.body) as HealthResponse;
            assert.equal(body.status, "ok");
            assert.equal(typeof body.timestamp, "string");
            assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
            assert.equal(typeof body.uptime, "number");
            assert.ok((body.uptime ?? 0) >= 0);
            assert.equal(body.version, "0.1.0");

            await app.close();
        });
    });

    describe("GET /ready (Readiness probe)", () => {
        it("returns HTTP 200 with status 'ready' when both databases are connected", async () => {
            const healthyChecker: IDatabaseChecker = {
                checkHealth: async () => ({
                    analyticsDb: {
                        status: "connected",
                        isReadOnly: true,
                        latencyMs: 12,
                    },
                    appDb: {
                        status: "connected",
                        latencyMs: 8,
                    },
                }),
            };

            const app = await buildApp({ dbChecker: healthyChecker, appConfig: testConfig });

            const res = await app.inject({
                method: "GET",
                url: "/ready",
            });

            assert.equal(res.statusCode, 200);

            const body = JSON.parse(res.body) as ReadinessResponse;
            assert.equal(body.status, "ready");
            assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
            assert.equal(body.checks.analyticsDb.status, "connected");
            assert.equal(body.checks.analyticsDb.isReadOnly, true);
            assert.equal(body.checks.analyticsDb.latencyMs, 12);
            assert.equal(body.checks.appDb.status, "connected");
            assert.equal(body.checks.appDb.latencyMs, 8);

            await app.close();
        });

        it("returns HTTP 503 with status 'not_ready' when analytics_db fails", async () => {
            const analyticsDownChecker: IDatabaseChecker = {
                checkHealth: async () => ({
                    analyticsDb: {
                        status: "disconnected",
                        isReadOnly: false,
                    },
                    appDb: {
                        status: "connected",
                        latencyMs: 6,
                    },
                }),
            };

            const app = await buildApp({ dbChecker: analyticsDownChecker, appConfig: testConfig });

            const res = await app.inject({
                method: "GET",
                url: "/ready",
            });

            assert.equal(res.statusCode, 503);

            const body = JSON.parse(res.body) as ReadinessResponse;
            assert.equal(body.status, "not_ready");
            assert.equal(body.checks.analyticsDb.status, "disconnected");
            assert.equal(body.checks.appDb.status, "connected");

            await app.close();
        });

        it("returns HTTP 503 with status 'not_ready' when app_db fails", async () => {
            const appDownChecker: IDatabaseChecker = {
                checkHealth: async () => ({
                    analyticsDb: {
                        status: "connected",
                        isReadOnly: true,
                        latencyMs: 10,
                    },
                    appDb: {
                        status: "disconnected",
                    },
                }),
            };

            const app = await buildApp({ dbChecker: appDownChecker, appConfig: testConfig });

            const res = await app.inject({
                method: "GET",
                url: "/ready",
            });

            assert.equal(res.statusCode, 503);

            const body = JSON.parse(res.body) as ReadinessResponse;
            assert.equal(body.status, "not_ready");
            assert.equal(body.checks.analyticsDb.status, "connected");
            assert.equal(body.checks.appDb.status, "disconnected");

            await app.close();
        });

        it("returns HTTP 503 with status 'not_ready' when both databases fail", async () => {
            const bothDownChecker: IDatabaseChecker = {
                checkHealth: async () => ({
                    analyticsDb: {
                        status: "disconnected",
                        isReadOnly: false,
                    },
                    appDb: {
                        status: "disconnected",
                    },
                }),
            };

            const app = await buildApp({ dbChecker: bothDownChecker, appConfig: testConfig });

            const res = await app.inject({
                method: "GET",
                url: "/ready",
            });

            assert.equal(res.statusCode, 503);

            const body = JSON.parse(res.body) as ReadinessResponse;
            assert.equal(body.status, "not_ready");
            assert.equal(body.checks.analyticsDb.status, "disconnected");
            assert.equal(body.checks.appDb.status, "disconnected");

            await app.close();
        });
    });
});
