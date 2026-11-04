import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { ResultCacheService } from "../execution/result-cache.service.js";
import { CsvExporterService } from "./csv-exporter.service.js";
import { ExecutionRepository } from "../execution/execution.repository.js";
import { AuditLogger } from "../execution/audit-logger.js";

export interface ExportRoutesOptions {
    resultCacheService?: ResultCacheService;
    csvExporterService?: CsvExporterService;
    executionRepo?: ExecutionRepository;
    auditLogger?: AuditLogger;
}

export const exportRoutes: FastifyPluginAsync<ExportRoutesOptions> = async (
    fastify,
    opts
) => {
    const resultCacheService = opts.resultCacheService || new ResultCacheService();
    const csvExporterService = opts.csvExporterService || new CsvExporterService();
    const executionRepo = opts.executionRepo || new ExecutionRepository();
    const auditLogger = opts.auditLogger || new AuditLogger();

    // -------------------------------------------------------------
    // GET /executions/:id/export.csv
    // -------------------------------------------------------------
    fastify.get<{ Params: { id: string }; Querystring: { bom?: string } }>(
        "/executions/:id/export.csv",
        { preHandler: [requireAuth] },
        async (request, reply) => {
            const executionId = request.params.id;
            const userId = request.user!.id;
            const includeBom = request.query?.bom === "true" || request.query?.bom === "1";

            // 1. Verify execution existence and ownership containment in database repository
            const record = await executionRepo.findById(executionId);
            if (record && record.userId !== userId) {
                return reply.status(403).send({
                    statusCode: 403,
                    error: "FORBIDDEN",
                    message: `Access denied. Execution '${executionId}' belongs to another user.`,
                    timestamp: new Date().toISOString(),
                });
            }

            // 2. Retrieve ephemeral result payload from cache (15-minute TTL check)
            const lookup = resultCacheService.getExecutionResult(executionId, userId);
            if (!lookup.ok) {
                const statusMap: Record<string, number> = {
                    NOT_FOUND: 404,
                    FORBIDDEN: 403,
                    EXPIRED: 410,
                };
                const statusCode = statusMap[lookup.status] || 400;
                return reply.status(statusCode).send({
                    statusCode,
                    error: lookup.errorCode,
                    message: lookup.errorMessage,
                    timestamp: new Date().toISOString(),
                });
            }

            const cached = lookup.result!;

            // 3. Serialize to RFC 4180 formula-injection neutralized CSV
            const exportResult = csvExporterService.serialize({
                columns: cached.columns,
                rows: cached.rows,
                executionId,
                artifactId: cached.artifactId,
                includeBom,
            });

            // 4. Log CSV export audit event (performance/metadata only, zero PII or row dump)
            await auditLogger.log({
                userId,
                action: "CSV_EXPORT_DOWNLOADED",
                resourceId: executionId,
                details: {
                    artifactId: cached.artifactId,
                    rowCount: exportResult.metadata.rowCount,
                    byteSize: exportResult.metadata.byteSize,
                    truncated: exportResult.metadata.truncated,
                    fileName: exportResult.metadata.fileName,
                },
                ipAddress: request.ip,
            });

            // 5. Send file with strict security and cache headers
            return reply
                .status(200)
                .header("Content-Type", exportResult.contentType)
                .header("Content-Disposition", exportResult.contentDisposition)
                .header("X-Content-Type-Options", "nosniff")
                .header("Cache-Control", "no-store, no-cache, must-revalidate, private")
                .header("Pragma", "no-cache")
                .send(exportResult.buffer);
        }
    );
};

