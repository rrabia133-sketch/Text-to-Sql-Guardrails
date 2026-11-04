import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { RetentionService } from "./retention.service.js";
import { AuditLogger } from "../execution/audit-logger.js";

export interface RetentionRoutesOptions {
    retentionService?: RetentionService;
    auditLogger?: AuditLogger;
}

export const retentionRoutes: FastifyPluginAsync<RetentionRoutesOptions> = async (
    fastify,
    opts
) => {
    const retentionService = opts.retentionService || new RetentionService();
    const auditLogger = opts.auditLogger || new AuditLogger();

    // -------------------------------------------------------------
    // POST /admin/retention/run (Admin-Only Retention Trigger)
    // -------------------------------------------------------------
    fastify.post(
        "/admin/retention/run",
        { preHandler: [requireAuth] },
        async (request, reply) => {
            const user = request.user!;

            // Strict Role-Based Access Control (Admin only)
            if (user.role !== "admin") {
                return reply.status(403).send({
                    statusCode: 403,
                    error: "FORBIDDEN",
                    message: "Access denied. Retention maintenance requires administrator privileges.",
                    timestamp: new Date().toISOString(),
                });
            }

            const report = await retentionService.runCleanup();

            await auditLogger.log({
                userId: user.id,
                action: "RETENTION_CLEANUP_EXECUTED",
                resourceId: "system_retention",
                details: {
                    purgedResults: report.purgedResults,
                    purgedHistory: report.purgedHistory,
                    purgedAuditLogs: report.purgedAuditLogs,
                    durationMs: report.durationMs,
                },
                ipAddress: request.ip,
            });

            return reply.status(200).send(report);
        }
    );
};

