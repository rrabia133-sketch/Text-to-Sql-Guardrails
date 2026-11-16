import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { MetricsService } from "./metrics.service.js";

export interface MetricsRoutesOptions {
    metricsService: MetricsService;
    metricsBearerToken?: string;
}

function isValidBearerToken(authHeader: string | undefined, expectedToken: string): boolean {
    if (!authHeader || !expectedToken) {
        return false;
    }
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (!match || !match[1]) {
        return false;
    }
    const providedBuf = Buffer.from(match[1], "utf8");
    const expectedBuf = Buffer.from(expectedToken, "utf8");
    if (providedBuf.length !== expectedBuf.length) {
        return false;
    }
    return timingSafeEqual(providedBuf, expectedBuf);
}

const metricsRoutesPlugin: FastifyPluginAsync<MetricsRoutesOptions> = async (app, opts) => {
    const { metricsService, metricsBearerToken } = opts;

    // Attach request timing hook
    app.addHook("onRequest", async (request: FastifyRequest) => {
        (request as any).startTime = process.hrtime();
    });

    app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
        const startTime = (request as any).startTime as [number, number] | undefined;
        if (!startTime) return;

        const diff = process.hrtime(startTime);
        const durationMs = (diff[0] * 1e3) + (diff[1] * 1e-6);

        // Normalize route pattern to avoid high cardinality (e.g. /api/v1/queries/:id)
        const route = request.routeOptions?.url || request.url.split("?")[0];

        metricsService.recordHttpRequest({
            method: request.method,
            route,
            statusCode: reply.statusCode,
            durationMs,
        });
    });

    // Prometheus Scraping Route
    app.get(
        "/api/v1/metrics",
        {
            schema: {
                description: "Prometheus operational metrics endpoint",
                tags: ["Observability"],
                response: {
                    200: {
                        type: "string",
                        description: "Prometheus text exposition format",
                    },
                    401: {
                        type: "object",
                        properties: {
                            statusCode: { type: "number" },
                            error: { type: "string" },
                            message: { type: "string" },
                        },
                    },
                },
            },
        },
        async (request: FastifyRequest, reply: FastifyReply) => {
            if (metricsBearerToken && metricsBearerToken.trim().length > 0) {
                const isAdminSession = request.user?.role === "admin";
                const hasValidToken = isValidBearerToken(
                    request.headers.authorization,
                    metricsBearerToken.trim()
                );
                if (!isAdminSession && !hasValidToken) {
                    return reply.status(401).send({
                        statusCode: 401,
                        error: "Unauthorized",
                        message: "Valid metrics bearer token or admin session required",
                    });
                }
            }

            const prometheusData = await metricsService.exportPrometheus();
            return reply
                .header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
                .header("Cache-Control", "no-store")
                .status(200)
                .send(prometheusData);
        }
    );
};

export const metricsRoutes = fp(metricsRoutesPlugin, {
    name: "metrics-routes",
});

