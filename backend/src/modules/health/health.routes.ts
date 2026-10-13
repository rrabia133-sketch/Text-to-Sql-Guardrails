import type { FastifyPluginAsync } from "fastify";
import type { HealthResponse, ReadinessResponse } from "@text2sql/contracts";
import type { IDatabaseChecker } from "./health.service.js";

export interface HealthRoutesOptions {
    dbChecker: IDatabaseChecker;
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (
    fastify,
    opts
) => {
    const { dbChecker } = opts;

    // Liveness probe: verifies the Fastify Node process is running
    fastify.get("/health", async (): Promise<HealthResponse> => {
        const uptime = Math.floor(process.uptime());
        return {
            status: "ok",
            version: "0.1.0",
            uptime,
            uptimeSeconds: uptime,
            timestamp: new Date().toISOString(),
        };
    });

    // Readiness probe: verifies end-to-end connectivity to analytics_db and app_db
    fastify.get("/ready", async (_req, reply): Promise<ReadinessResponse> => {
        const checkResults = await dbChecker.checkHealth();

        const isReady =
            checkResults.analyticsDb.status === "connected" &&
            checkResults.appDb.status === "connected";

        const response: ReadinessResponse = {
            status: isReady ? "ready" : "not_ready",
            timestamp: new Date().toISOString(),
            checks: checkResults,
        };

        if (!isReady) {
            reply.status(503);
        }

        return response;
    });
};
