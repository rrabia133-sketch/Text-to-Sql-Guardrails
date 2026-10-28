import { z } from "zod";

// ==========================================
// 1. Execution Status & Lifecycle
// ==========================================

export const ExecutionStatusSchema = z.enum([
    "pending",
    "running",
    "completed",
    "failed",
    "timed_out",
    "cancelled",
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

// ==========================================
// 2. Column Metadata & Type Mapping
// ==========================================

export const JsDataTypeSchema = z.enum([
    "string",
    "number",
    "boolean",
    "date",
    "object",
    "null",
]);
export type JsDataType = z.infer<typeof JsDataTypeSchema>;

export const ColumnTypeMetadataSchema = z.object({
    name: z.string().min(1),
    pgType: z.string().min(1),
    jsType: JsDataTypeSchema,
    nullable: z.boolean().default(true),
});
export type ColumnTypeMetadata = z.infer<typeof ColumnTypeMetadataSchema>;

import { ReviewAcknowledgementSchema } from "./confidence.js";

// ==========================================
// 3. Execution Request Contract
// ==========================================

export const ExecuteQueryRequestSchema = z.object({
    artifactId: z.string().min(1),
    idempotencyKey: z.string().optional(),
    acknowledgement: ReviewAcknowledgementSchema.optional(),
});
export type ExecuteQueryRequest = z.infer<typeof ExecuteQueryRequestSchema>;

// ==========================================
// 4. Execution Error Contract & Codes
// ==========================================

export const ExecutionErrorCodeSchema = z.enum([
    "ARTIFACT_NOT_FOUND",
    "ARTIFACT_EXPIRED",
    "ARTIFACT_NOT_OWNED",
    "HASH_MISMATCH",
    "EXECUTION_TIMEOUT",
    "ROW_CAP_EXCEEDED",
    "BYTE_CAP_EXCEEDED",
    "CONCURRENCY_LIMIT_EXCEEDED",
    "TRANSACTION_VIOLATION",
    "DATABASE_ERROR",
    "CLIENT_CANCELLED",
    "REVIEW_ACKNOWLEDGEMENT_REQUIRED",
    "SEMANTIC_VALIDATION_FAILED",
    "BLOCKED_CONFIDENCE_BAND",
]);
export type ExecutionErrorCode = z.infer<typeof ExecutionErrorCodeSchema>;

export const ExecutionErrorResponseSchema = z.object({
    executionId: z.string().optional(),
    artifactId: z.string(),
    code: ExecutionErrorCodeSchema,
    message: z.string(),
    executionTimeMs: z.number().nonnegative().default(0),
    timestamp: z.string(),
});
export type ExecutionErrorResponse = z.infer<typeof ExecutionErrorResponseSchema>;

// ==========================================
// 5. Successful Execution Result Contract
// ==========================================

export const ExecutionResultResponseSchema = z.object({
    executionId: z.string(),
    artifactId: z.string(),
    status: ExecutionStatusSchema,
    columns: z.array(ColumnTypeMetadataSchema),
    rows: z.array(z.record(z.string(), z.unknown())),
    rowCount: z.number().int().nonnegative(),
    byteSize: z.number().int().nonnegative(),
    executionTimeMs: z.number().nonnegative(),
    truncated: z.boolean(),
    executedAt: z.string(),
});
export type ExecutionResultResponse = z.infer<typeof ExecutionResultResponseSchema>;

// ==========================================
// 6. Execution Detail / Audit Summary
// ==========================================

export const ExecutionSummarySchema = z.object({
    id: z.string(),
    artifactId: z.string(),
    userId: z.string(),
    status: ExecutionStatusSchema,
    sqlExecuted: z.string(),
    executionTimeMs: z.number().int().nonnegative(),
    rowCount: z.number().int().nonnegative(),
    byteSize: z.number().int().nonnegative(),
    truncated: z.boolean(),
    errorCode: ExecutionErrorCodeSchema.optional(),
    errorMessage: z.string().optional(),
    createdAt: z.string(),
});
export type ExecutionSummary = z.infer<typeof ExecutionSummarySchema>;
