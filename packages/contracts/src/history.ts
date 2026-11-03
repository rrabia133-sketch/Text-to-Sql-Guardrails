import { z } from "zod";
import { QueryArtifactStatusSchema } from "./generation.js";
import { ConfidenceBandSchema } from "./confidence.js";

// ==========================================
// 1. History Item & Paginated History Contracts
// ==========================================

export const HistoryItemSummarySchema = z.object({
    artifactId: z.string(),
    question: z.string(),
    sql: z.string(),
    status: QueryArtifactStatusSchema,
    confidenceScore: z.number().min(0).max(100).optional(),
    confidenceBand: ConfidenceBandSchema.optional(),
    provider: z.string(),
    model: z.string(),
    createdAt: z.string(),
    executedAt: z.string().optional(),
    lastExecutionStatus: z.string().optional(),
});
export type HistoryItemSummary = z.infer<typeof HistoryItemSummarySchema>;

export const PaginatedHistoryResponseSchema = z.object({
    items: z.array(HistoryItemSummarySchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
});
export type PaginatedHistoryResponse = z.infer<typeof PaginatedHistoryResponseSchema>;

// ==========================================
// 2. Feedback Contracts
// ==========================================

export const FeedbackVerdictSchema = z.enum(["correct", "incorrect"]);
export type FeedbackVerdict = z.infer<typeof FeedbackVerdictSchema>;

export const FeedbackReasonCodeSchema = z.enum([
    "wrong_metric",
    "wrong_filter",
    "wrong_date",
    "missing_rows",
    "other",
]);
export type FeedbackReasonCode = z.infer<typeof FeedbackReasonCodeSchema>;

export const SubmitFeedbackRequestSchema = z.object({
    verdict: FeedbackVerdictSchema,
    reasonCode: FeedbackReasonCodeSchema.optional(),
    notes: z.string().max(1000).optional(),
});
export type SubmitFeedbackRequest = z.infer<typeof SubmitFeedbackRequestSchema>;

export const FeedbackRecordSchema = z.object({
    id: z.string(),
    artifactId: z.string(),
    userId: z.string(),
    verdict: FeedbackVerdictSchema,
    reasonCode: FeedbackReasonCodeSchema.optional(),
    notes: z.string().optional(),
    createdAt: z.string(),
});
export type FeedbackRecord = z.infer<typeof FeedbackRecordSchema>;

