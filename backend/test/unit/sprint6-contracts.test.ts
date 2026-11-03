import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    HistoryItemSummarySchema,
    PaginatedHistoryResponseSchema,
    FeedbackVerdictSchema,
    FeedbackReasonCodeSchema,
    SubmitFeedbackRequestSchema,
    FeedbackRecordSchema,
    CsvExportMetadataSchema,
    RetentionPolicyConfigSchema,
    RetentionCleanupReportSchema,
    DEFAULT_RETENTION_POLICY,
} from "@text2sql/contracts";

describe("Sprint 6 - Task 1: History, Feedback, CSV Export & Retention Contracts", () => {
    describe("History Contracts", () => {
        it("parses valid HistoryItemSummary with optional confidence and execution fields", () => {
            const raw = {
                artifactId: "art_test_123",
                question: "What is total revenue for completed orders?",
                sql: "SELECT SUM(quantity * unit_price) FROM orders WHERE status = 'completed';",
                status: "preview_ready",
                confidenceScore: 92,
                confidenceBand: "HIGH",
                provider: "ollama",
                model: "qwen2.5-coder:7b",
                createdAt: new Date().toISOString(),
                executedAt: new Date().toISOString(),
                lastExecutionStatus: "completed",
            };

            const parsed = HistoryItemSummarySchema.parse(raw);
            assert.equal(parsed.artifactId, "art_test_123");
            assert.equal(parsed.status, "preview_ready");
            assert.equal(parsed.confidenceBand, "HIGH");
            assert.equal(parsed.confidenceScore, 92);
        });

        it("parses HistoryItemSummary without optional fields", () => {
            const raw = {
                artifactId: "art_basic_456",
                question: "Show customers",
                sql: "SELECT * FROM customers LIMIT 50;",
                status: "preview",
                provider: "groq",
                model: "llama-3.3-70b",
                createdAt: new Date().toISOString(),
            };

            const parsed = HistoryItemSummarySchema.parse(raw);
            assert.equal(parsed.artifactId, "art_basic_456");
            assert.equal(parsed.confidenceScore, undefined);
            assert.equal(parsed.executedAt, undefined);
        });

        it("rejects HistoryItemSummary with invalid status", () => {
            const raw = {
                artifactId: "art_invalid",
                question: "Show customers",
                sql: "SELECT 1;",
                status: "non_existent_status",
                provider: "ollama",
                model: "qwen",
                createdAt: new Date().toISOString(),
            };

            assert.throws(() => HistoryItemSummarySchema.parse(raw));
        });

        it("parses valid PaginatedHistoryResponse", () => {
            const raw = {
                items: [
                    {
                        artifactId: "art_1",
                        question: "Count orders",
                        sql: "SELECT COUNT(*) FROM orders;",
                        status: "executed",
                        provider: "ollama",
                        model: "qwen",
                        createdAt: new Date().toISOString(),
                    },
                ],
                total: 1,
                limit: 10,
                offset: 0,
                hasMore: false,
            };

            const parsed = PaginatedHistoryResponseSchema.parse(raw);
            assert.equal(parsed.items.length, 1);
            assert.equal(parsed.total, 1);
            assert.equal(parsed.hasMore, false);
        });

        it("rejects PaginatedHistoryResponse with negative pagination bounds", () => {
            assert.throws(() =>
                PaginatedHistoryResponseSchema.parse({
                    items: [],
                    total: -1,
                    limit: 10,
                    offset: 0,
                    hasMore: false,
                })
            );

            assert.throws(() =>
                PaginatedHistoryResponseSchema.parse({
                    items: [],
                    total: 0,
                    limit: 0, // limit must be positive
                    offset: 0,
                    hasMore: false,
                })
            );
        });
    });

    describe("Feedback Contracts", () => {
        it("validates FeedbackVerdict enum values", () => {
            assert.equal(FeedbackVerdictSchema.parse("correct"), "correct");
            assert.equal(FeedbackVerdictSchema.parse("incorrect"), "incorrect");
            assert.throws(() => FeedbackVerdictSchema.parse("maybe"));
        });

        it("validates FeedbackReasonCode enum values", () => {
            const validCodes = [
                "wrong_metric",
                "wrong_filter",
                "wrong_date",
                "missing_rows",
                "other",
            ];
            for (const code of validCodes) {
                assert.equal(FeedbackReasonCodeSchema.parse(code), code);
            }
            assert.throws(() => FeedbackReasonCodeSchema.parse("unsupported_reason"));
        });

        it("parses valid SubmitFeedbackRequest with and without notes", () => {
            const positive = SubmitFeedbackRequestSchema.parse({
                verdict: "correct",
            });
            assert.equal(positive.verdict, "correct");
            assert.equal(positive.reasonCode, undefined);

            const negative = SubmitFeedbackRequestSchema.parse({
                verdict: "incorrect",
                reasonCode: "wrong_metric",
                notes: "Query computed sum instead of average.",
            });
            assert.equal(negative.verdict, "incorrect");
            assert.equal(negative.reasonCode, "wrong_metric");
            assert.equal(negative.notes, "Query computed sum instead of average.");
        });

        it("rejects SubmitFeedbackRequest exceeding maximum note length", () => {
            assert.throws(() =>
                SubmitFeedbackRequestSchema.parse({
                    verdict: "incorrect",
                    notes: "a".repeat(1001),
                })
            );
        });

        it("parses valid FeedbackRecord", () => {
            const record = {
                id: "fbk_123",
                artifactId: "art_123",
                userId: "usr_analyst_01",
                verdict: "incorrect",
                reasonCode: "wrong_date",
                notes: "Date window off by 1 month",
                createdAt: new Date().toISOString(),
            };

            const parsed = FeedbackRecordSchema.parse(record);
            assert.equal(parsed.id, "fbk_123");
            assert.equal(parsed.verdict, "incorrect");
            assert.equal(parsed.reasonCode, "wrong_date");
        });
    });

    describe("CSV Export & Retention Contracts", () => {
        it("parses valid CsvExportMetadata with defaults", () => {
            const raw = {
                executionId: "exec_123",
                artifactId: "art_123",
                fileName: "query-results-exec_123.csv",
                rowCount: 42,
                byteSize: 1024,
                truncated: false,
                exportedAt: new Date().toISOString(),
            };

            const parsed = CsvExportMetadataSchema.parse(raw);
            assert.equal(parsed.executionId, "exec_123");
            assert.equal(parsed.formulaInjectionNeutralized, true);
        });

        it("rejects CsvExportMetadata with negative counts", () => {
            assert.throws(() =>
                CsvExportMetadataSchema.parse({
                    executionId: "exec_123",
                    artifactId: "art_123",
                    fileName: "test.csv",
                    rowCount: -5,
                    byteSize: 1024,
                    truncated: false,
                    exportedAt: new Date().toISOString(),
                })
            );
        });

        it("validates RetentionPolicyConfig with default constants", () => {
            assert.equal(DEFAULT_RETENTION_POLICY.ephemeralResultTtlMinutes, 15);
            assert.equal(DEFAULT_RETENTION_POLICY.historyRetentionDays, 30);
            assert.equal(DEFAULT_RETENTION_POLICY.auditRetentionDays, 90);

            const parsedDefault = RetentionPolicyConfigSchema.parse({});
            assert.equal(parsedDefault.ephemeralResultTtlMinutes, 15);
            assert.equal(parsedDefault.historyRetentionDays, 30);
            assert.equal(parsedDefault.auditRetentionDays, 90);

            const custom = RetentionPolicyConfigSchema.parse({
                ephemeralResultTtlMinutes: 20,
                historyRetentionDays: 60,
                auditRetentionDays: 180,
            });
            assert.equal(custom.ephemeralResultTtlMinutes, 20);
            assert.equal(custom.historyRetentionDays, 60);
            assert.equal(custom.auditRetentionDays, 180);
        });

        it("rejects invalid non-positive retention durations", () => {
            assert.throws(() =>
                RetentionPolicyConfigSchema.parse({
                    ephemeralResultTtlMinutes: 0,
                })
            );
            assert.throws(() =>
                RetentionPolicyConfigSchema.parse({
                    historyRetentionDays: -1,
                })
            );
        });

        it("parses valid RetentionCleanupReport", () => {
            const raw = {
                purgedResults: 12,
                purgedHistory: 5,
                purgedAuditLogs: 20,
                cleanedAt: new Date().toISOString(),
                durationMs: 45.5,
            };

            const parsed = RetentionCleanupReportSchema.parse(raw);
            assert.equal(parsed.purgedResults, 12);
            assert.equal(parsed.purgedHistory, 5);
            assert.equal(parsed.purgedAuditLogs, 20);
        });
    });
});

