import { z } from "zod";

// ==========================================
// 1. CSV Export Metadata Contract
// ==========================================

export const CsvExportMetadataSchema = z.object({
    executionId: z.string(),
    artifactId: z.string(),
    fileName: z.string(),
    rowCount: z.number().int().nonnegative(),
    byteSize: z.number().int().nonnegative(),
    truncated: z.boolean(),
    exportedAt: z.string(),
    formulaInjectionNeutralized: z.boolean().default(true),
});
export type CsvExportMetadata = z.infer<typeof CsvExportMetadataSchema>;

// ==========================================
// 2. Retention Policy Configuration Contract
// ==========================================

export const DEFAULT_RETENTION_POLICY = {
    ephemeralResultTtlMinutes: 15,
    historyRetentionDays: 30,
    auditRetentionDays: 90,
} as const;

export const RetentionPolicyConfigSchema = z.object({
    ephemeralResultTtlMinutes: z.number().int().positive().default(DEFAULT_RETENTION_POLICY.ephemeralResultTtlMinutes),
    historyRetentionDays: z.number().int().positive().default(DEFAULT_RETENTION_POLICY.historyRetentionDays),
    auditRetentionDays: z.number().int().positive().default(DEFAULT_RETENTION_POLICY.auditRetentionDays),
});
export type RetentionPolicyConfig = z.infer<typeof RetentionPolicyConfigSchema>;

export const RetentionCleanupReportSchema = z.object({
    purgedResults: z.number().int().nonnegative(),
    purgedHistory: z.number().int().nonnegative(),
    purgedAuditLogs: z.number().int().nonnegative(),
    cleanedAt: z.string(),
    durationMs: z.number().nonnegative(),
});
export type RetentionCleanupReport = z.infer<typeof RetentionCleanupReportSchema>;

