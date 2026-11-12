import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../src/app.js";
import { InMemoryAuthRepository } from "../helpers/in-memory-auth.repo.js";
import { MetricsService } from "../../src/modules/metrics/metrics.service.js";
import type { FastifyInstance } from "fastify";

describe("Sprint 7 - Task 4 / DO-10: Prometheus Operational Metrics Endpoint (GET /api/v1/metrics)", () => {
    let app: FastifyInstance;
    let metricsService: MetricsService;

    before(async () => {
        metricsService = new MetricsService();
        const authRepo = new InMemoryAuthRepository();

        app = await buildApp({
            authRepo: authRepo as any,
            metricsService,
            logger: false,
        });
        await app.ready();
    });

    after(async () => {
        if (app) await app.close();
    });

    it("returns HTTP 200 with Prometheus text/plain exposition format", async () => {
        const res = await app.inject({
            method: "GET",
            url: "/api/v1/metrics",
        });

        assert.equal(res.statusCode, 200);
        assert.match(res.headers["content-type"] as string, /text\/plain/);
        assert.match(res.payload, /# HELP http_requests_total/);
        assert.match(res.payload, /# TYPE http_requests_total counter/);
        assert.match(res.payload, /# HELP http_request_duration_seconds/);
        assert.match(res.payload, /# TYPE db_pool_active_connections gauge/);
    });

    it("records and updates http_requests_total and latency histograms after API calls", async () => {
        // Issue several requests to health / root routes
        await app.inject({ method: "GET", url: "/api/" });
        await app.inject({ method: "GET", url: "/api/" });
        await app.inject({ method: "GET", url: "/api/health/liveness" });

        const metricsRes = await app.inject({
            method: "GET",
            url: "/api/v1/metrics",
        });

        assert.equal(metricsRes.statusCode, 200);
        assert.match(metricsRes.payload, /http_requests_total\{method="GET",route="\/api\/",status="200"\} 2/);
        assert.match(metricsRes.payload, /http_requests_total\{method="GET",route="\/api\/health\/liveness",status="200"\} 1/);
        assert.match(metricsRes.payload, /http_request_duration_seconds_bucket\{method="GET",route="\/api\/",le="\+Inf"\} 2/);
    });

    it("tracks guardrail refusal codes and cache hits", async () => {
        metricsService.recordGuardrailRefusal("UNAPPROVED_TABLE_ACCESS");
        metricsService.recordGuardrailRefusal("UNAPPROVED_TABLE_ACCESS");
        metricsService.recordGuardrailRefusal("NON_SELECT_OPERATION");
        metricsService.recordCacheHit("result");
        metricsService.recordCacheHit("idempotency");

        const metricsRes = await app.inject({
            method: "GET",
            url: "/api/v1/metrics",
        });

        assert.equal(metricsRes.statusCode, 200);
        assert.match(metricsRes.payload, /guardrail_refusals_total\{code="UNAPPROVED_TABLE_ACCESS"\} 2/);
        assert.match(metricsRes.payload, /guardrail_refusals_total\{code="NON_SELECT_OPERATION"\} 1/);
        assert.match(metricsRes.payload, /cache_hits_total\{cache="result"\} 1/);
        assert.match(metricsRes.payload, /cache_hits_total\{cache="idempotency"\} 1/);
    });
});

