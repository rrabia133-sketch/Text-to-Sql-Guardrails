import type { FastifyPluginAsync } from "fastify";
import { SubmitFeedbackRequestSchema } from "@text2sql/contracts";
import { requireAuth } from "../../plugins/auth.js";
import { HistoryRepository } from "./history.repository.js";
import { QueryArtifactRepository } from "../generation/query-artifact.repository.js";
import { AuditLogger } from "../execution/audit-logger.js";

export interface HistoryRoutesOptions {
    historyRepo?: HistoryRepository;
    queryArtifactRepo?: QueryArtifactRepository;
    auditLogger?: AuditLogger;
}

export const historyRoutes: FastifyPluginAsync<HistoryRoutesOptions> = async (
    fastify,
    opts
) => {
    const historyRepo = opts.historyRepo || new HistoryRepository();
    const queryArtifactRepo = opts.queryArtifactRepo || new QueryArtifactRepository();
    const auditLogger = opts.auditLogger || new AuditLogger();

    // -------------------------------------------------------------
    // GET /history (Paginated Analyst Query History)
    // -------------------------------------------------------------
    fastify.get<{ Querystring: { limit?: string; offset?: string } }>(
        "/history",
        { preHandler: [requireAuth] },
        async (request, reply) => {
            const userId = request.user!.id;
            const limit = Math.min(100, Math.max(1, parseInt(request.query?.limit || "20", 10) || 20));
            const offset = Math.max(0, parseInt(request.query?.offset || "0", 10) || 0);

            const result = await historyRepo.listUserHistory(userId, { limit, offset });
            return reply.status(200).send(result);
        }
    );

    // -------------------------------------------------------------
    // DELETE /history/:artifactId (Owner-Scoped Soft Deletion)
    // -------------------------------------------------------------
    fastify.delete<{ Params: { artifactId: string } }>(
        "/history/:artifactId",
        { preHandler: [requireAuth] },
        async (request, reply) => {
            const userId = request.user!.id;
            const artifactId = request.params.artifactId;

            const res = await historyRepo.deleteUserArtifact(userId, artifactId);
            if (!res.ok) {
                if (res.status === "FORBIDDEN") {
                    return reply.status(403).send({
                        statusCode: 403,
                        error: "FORBIDDEN",
                        message: `Access denied. Artifact '${artifactId}' belongs to another user.`,
                        timestamp: new Date().toISOString(),
                    });
                }
                return reply.status(404).send({
                    statusCode: 404,
                    error: "ARTIFACT_NOT_FOUND",
                    message: `Query artifact '${artifactId}' was not found.`,
                    timestamp: new Date().toISOString(),
                });
            }

            await auditLogger.log({
                userId,
                action: "QUERY_ARTIFACT_DELETED",
                resourceId: artifactId,
                details: { artifactId },
                ipAddress: request.ip,
            });

            return reply.status(200).send({
                ok: true,
                artifactId,
                deletedAt: new Date().toISOString(),
            });
        }
    );

    // -------------------------------------------------------------
    // POST /queries/:id/feedback (Submit Analyst Feedback)
    // -------------------------------------------------------------
    fastify.post<{ Params: { id: string }; Body: unknown }>(
        "/queries/:id/feedback",
        { preHandler: [requireAuth] },
        async (request, reply) => {
            const userId = request.user!.id;
            const artifactId = request.params.id;

            // 1. Validate request body against schema
            const parsed = SubmitFeedbackRequestSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.status(400).send({
                    statusCode: 400,
                    error: "Bad Request",
                    message: "Invalid feedback payload.",
                    issues: parsed.error.issues,
                    timestamp: new Date().toISOString(),
                });
            }

            // 2. Verify artifact existence and ownership isolation
            const artifact = await queryArtifactRepo.findById(artifactId);
            if (!artifact) {
                return reply.status(404).send({
                    statusCode: 404,
                    error: "ARTIFACT_NOT_FOUND",
                    message: `Query artifact '${artifactId}' was not found.`,
                    timestamp: new Date().toISOString(),
                });
            }

            if (artifact.userId !== userId) {
                return reply.status(403).send({
                    statusCode: 403,
                    error: "FORBIDDEN",
                    message: `Access denied. Query artifact '${artifactId}' belongs to another user.`,
                    timestamp: new Date().toISOString(),
                });
            }

            // 3. Persist feedback record
            const record = await historyRepo.saveFeedback({
                artifactId,
                userId,
                verdict: parsed.data.verdict,
                reasonCode: parsed.data.reasonCode,
                notes: parsed.data.notes,
            });

            // 4. Audit log feedback submission
            await auditLogger.log({
                userId,
                action: "QUERY_FEEDBACK_SUBMITTED",
                resourceId: artifactId,
                details: {
                    feedbackId: record.id,
                    verdict: record.verdict,
                    reasonCode: record.reasonCode,
                },
                ipAddress: request.ip,
            });

            return reply.status(201).send(record);
        }
    );

    // -------------------------------------------------------------
    // GET /queries/:id/feedback (Get Artifact Feedback)
    // -------------------------------------------------------------
    fastify.get<{ Params: { id: string } }>(
        "/queries/:id/feedback",
        { preHandler: [requireAuth] },
        async (request, reply) => {
            const userId = request.user!.id;
            const artifactId = request.params.id;

            const artifact = await queryArtifactRepo.findById(artifactId);
            if (!artifact) {
                return reply.status(404).send({
                    statusCode: 404,
                    error: "ARTIFACT_NOT_FOUND",
                    message: `Query artifact '${artifactId}' was not found.`,
                    timestamp: new Date().toISOString(),
                });
            }

            if (artifact.userId !== userId) {
                return reply.status(403).send({
                    statusCode: 403,
                    error: "FORBIDDEN",
                    message: `Access denied. Query artifact '${artifactId}' belongs to another user.`,
                    timestamp: new Date().toISOString(),
                });
            }

            const feedback = await historyRepo.getFeedbackForArtifact(artifactId, userId);
            if (!feedback) {
                return reply.status(404).send({
                    statusCode: 404,
                    error: "FEEDBACK_NOT_FOUND",
                    message: `No feedback recorded for artifact '${artifactId}'.`,
                    timestamp: new Date().toISOString(),
                });
            }

            return reply.status(200).send(feedback);
        }
    );
};

