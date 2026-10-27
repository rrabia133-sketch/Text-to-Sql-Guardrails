import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../../plugins/auth.js";
import { ArtifactGate } from "./artifact-gate.js";
import { ConcurrencyManager } from "./concurrency-manager.js";
import { CancellationService } from "./cancellation.service.js";
import { ExecutionRepository } from "./execution.repository.js";
import { RestrictedExecutor } from "./restricted-executor.js";
import { AuditLogger } from "./audit-logger.js";
import { QueryArtifactRepository } from "../generation/query-artifact.repository.js";

export interface ExecutionRoutesOptions {
    artifactGate?: ArtifactGate;
    concurrencyManager?: ConcurrencyManager;
    cancellationService?: CancellationService;
    executionRepo?: ExecutionRepository;
    restrictedExecutor?: RestrictedExecutor;
    auditLogger?: AuditLogger;
    queryArtifactRepo?: QueryArtifactRepository;
}

export const executionRoutes: FastifyPluginAsync<ExecutionRoutesOptions> = async (
    fastify,
    opts
) => {
    const queryArtifactRepo = opts.queryArtifactRepo || new QueryArtifactRepository();
    const artifactGate = opts.artifactGate || new ArtifactGate(queryArtifactRepo);
    const concurrencyManager = opts.concurrencyManager || new ConcurrencyManager();
    const cancellationService = opts.cancellationService || new CancellationService();
    const executionRepo = opts.executionRepo || new ExecutionRepository();
    const restrictedExecutor = opts.restrictedExecutor || new RestrictedExecutor();
    const auditLogger = opts.auditLogger || new AuditLogger();

    // -------------------------------------------------------------
    // POST /api/v1/queries/:id/execute
    // -------------------------------------------------------------
    fastify.post<{ Params: { id: string }; Body?: { idempotencyKey?: string } }>(
        "/queries/:id/execute",
        { preHandler: [requireAuth] },
        async (request, reply) => {
            const artifactId = request.params.id;
            const userId = request.user!.id;
            const executionId = `exec_${randomUUID()}`;

            // 1. Immutable Artifact Ownership & Expiry Verification
            const gateResult = await artifactGate.verify(artifactId, userId);
            if (!gateResult.ok) {
                const statusMap: Record<string, number> = {
                    ARTIFACT_NOT_FOUND: 404,
                    ARTIFACT_NOT_OWNED: 403,
                    ARTIFACT_EXPIRED: 410,
                    TRANSACTION_VIOLATION: 409,
                    HASH_MISMATCH: 400,
                };
                const statusCode = statusMap[gateResult.errorCode || ""] || 400;

                return reply.status(statusCode).send({
                    statusCode,
                    error: gateResult.errorCode,
                    message: gateResult.errorMessage,
                    timestamp: new Date().toISOString(),
                });
            }

            const artifact = gateResult.artifact!;

            // 2. Active Concurrency Bound Check (Max 2 user, 10 global)
            const acquireResult = concurrencyManager.acquire(userId, executionId);
            if (!acquireResult.allowed) {
                return reply.status(429).send({
                    statusCode: 429,
                    error: "Too Many Requests",
                    message: "Active query concurrency limit exceeded. Please wait for current executions to complete.",
                    timestamp: new Date().toISOString(),
                });
            }

            let clientAborted = false;

            try {
                // 3. Create execution session in database
                await executionRepo.create({
                    id: executionId,
                    artifactId,
                    userId,
                    status: "running",
                    sqlExecuted: artifact.generatedSql,
                });

                // 4. Register with Cancellation Service
                cancellationService.register(executionId, userId);

                // Handle client socket disconnect mid-flight
                request.raw.on("close", () => {
                    if (!reply.raw.writableEnded) {
                        clientAborted = true;
                        cancellationService.cancel(executionId, userId).catch(() => { });
                    }
                });

                // 5. Dispatch via Restricted Database Executor
                const execResult = await restrictedExecutor.execute(artifact.generatedSql);

                if (!execResult.ok) {
                    await executionRepo.update(executionId, {
                        status: "failed",
                        executionTimeMs: execResult.executionTimeMs,
                        errorCode: execResult.errorCode,
                        errorMessage: execResult.errorMessage,
                    });

                    await queryArtifactRepo.updateStatus(artifactId, "failed");

                    await auditLogger.log({
                        userId,
                        action: "QUERY_EXECUTION_FAILED",
                        resourceId: executionId,
                        details: {
                            artifactId,
                            errorCode: execResult.errorCode,
                            errorMessage: execResult.errorMessage,
                            executionTimeMs: execResult.executionTimeMs,
                        },
                        ipAddress: request.ip,
                    });

                    const statusCode = execResult.errorCode === "EXECUTION_TIMEOUT" ? 504 : 400;
                    return reply.status(statusCode).send({
                        executionId,
                        artifactId,
                        code: execResult.errorCode,
                        message: execResult.errorMessage,
                        executionTimeMs: execResult.executionTimeMs,
                        timestamp: new Date().toISOString(),
                    });
                }

                // 6. Success: Update Execution and Artifact State
                await executionRepo.update(executionId, {
                    status: "completed",
                    executionTimeMs: execResult.executionTimeMs,
                    rowCount: execResult.rowCount,
                    byteSize: execResult.byteSize,
                    truncated: execResult.truncated,
                });

                await queryArtifactRepo.updateStatus(artifactId, "completed");

                await auditLogger.log({
                    userId,
                    action: "QUERY_EXECUTION_COMPLETED",
                    resourceId: executionId,
                    details: {
                        artifactId,
                        rowCount: execResult.rowCount,
                        byteSize: execResult.byteSize,
                        truncated: execResult.truncated,
                        executionTimeMs: execResult.executionTimeMs,
                    },
                    ipAddress: request.ip,
                });

                return reply.status(200).send({
                    executionId,
                    artifactId,
                    status: "completed",
                    columns: execResult.columns,
                    rows: execResult.rows,
                    rowCount: execResult.rowCount,
                    byteSize: execResult.byteSize,
                    executionTimeMs: execResult.executionTimeMs,
                    truncated: execResult.truncated,
                    executedAt: new Date().toISOString(),
                });
            } finally {
                concurrencyManager.release(userId, executionId);
                cancellationService.unregister(executionId);
            }
        }
    );

    // -------------------------------------------------------------
    // GET /api/v1/executions/:id
    // -------------------------------------------------------------
    fastify.get<{ Params: { id: string } }>(
        "/executions/:id",
        { preHandler: [requireAuth] },
        async (request, reply) => {
            const executionId = request.params.id;
            const userId = request.user!.id;

            const record = await executionRepo.findById(executionId);
            if (!record) {
                return reply.status(404).send({
                    statusCode: 404,
                    error: "Not Found",
                    message: `Execution '${executionId}' was not found.`,
                    timestamp: new Date().toISOString(),
                });
            }

            if (record.userId !== userId) {
                return reply.status(403).send({
                    statusCode: 403,
                    error: "Forbidden",
                    message: `Access denied. Execution '${executionId}' belongs to another user.`,
                    timestamp: new Date().toISOString(),
                });
            }

            return reply.status(200).send(record);
        }
    );

    // -------------------------------------------------------------
    // POST /api/v1/executions/:id/cancel
    // -------------------------------------------------------------
    fastify.post<{ Params: { id: string } }>(
        "/executions/:id/cancel",
        { preHandler: [requireAuth] },
        async (request, reply) => {
            const executionId = request.params.id;
            const userId = request.user!.id;

            const record = await executionRepo.findById(executionId);
            if (!record) {
                return reply.status(404).send({
                    statusCode: 404,
                    error: "Not Found",
                    message: `Execution '${executionId}' was not found.`,
                    timestamp: new Date().toISOString(),
                });
            }

            if (record.userId !== userId) {
                return reply.status(403).send({
                    statusCode: 403,
                    error: "Forbidden",
                    message: `Access denied. Execution '${executionId}' belongs to another user.`,
                    timestamp: new Date().toISOString(),
                });
            }

            const cancelResult = await cancellationService.cancel(executionId, userId);

            await executionRepo.update(executionId, {
                status: "cancelled",
                errorMessage: "Execution cancelled by user request.",
            });

            await auditLogger.log({
                userId,
                action: "QUERY_EXECUTION_CANCELLED",
                resourceId: executionId,
                details: { cancelledBy: userId },
                ipAddress: request.ip,
            });

            return reply.status(200).send({
                executionId,
                cancelled: true,
                message: cancelResult.message,
                timestamp: new Date().toISOString(),
            });
        }
    );
};
