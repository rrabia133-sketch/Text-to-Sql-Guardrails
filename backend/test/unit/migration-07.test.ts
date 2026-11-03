import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("Sprint 6 - Task 2: Database Migration 07-init-history-feedback-retention.sql Verification (US-15 / DO-08)", () => {
    it("verifies migration file exists and defines all required tables, columns, and indexes", async () => {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const migrationPath = path.resolve(
            __dirname,
            "../../../database/app/migrations/07-init-history-feedback-retention.sql"
        );

        const sql = await fs.readFile(migrationPath, "utf-8");

        // 1. Verify query_feedback table definition and constraints
        assert.ok(
            sql.includes("CREATE TABLE IF NOT EXISTS query_feedback"),
            "Must create query_feedback table"
        );
        assert.ok(sql.includes("artifact_id"), "query_feedback must have artifact_id");
        assert.ok(sql.includes("user_id"), "query_feedback must have user_id");
        assert.ok(sql.includes("verdict"), "query_feedback must have verdict column");
        assert.ok(
            sql.includes("'correct'") && sql.includes("'incorrect'"),
            "verdict check constraint must include 'correct' and 'incorrect'"
        );
        assert.ok(sql.includes("reason_code"), "query_feedback must have reason_code column");
        assert.ok(
            sql.includes("'wrong_metric'") &&
                sql.includes("'wrong_filter'") &&
                sql.includes("'wrong_date'") &&
                sql.includes("'missing_rows'") &&
                sql.includes("'other'"),
            "reason_code check constraint must support approved reasons"
        );
        assert.ok(sql.includes("notes TEXT"), "query_feedback must have notes column");
        assert.ok(
            sql.includes("REFERENCES query_artifacts(id) ON DELETE CASCADE"),
            "Must cascade delete on query_artifacts(id)"
        );

        // Indexes on query_feedback
        assert.ok(
            sql.includes("idx_query_feedback_artifact_id"),
            "Must create index on query_feedback(artifact_id)"
        );
        assert.ok(
            sql.includes("idx_query_feedback_user_id"),
            "Must create index on query_feedback(user_id)"
        );
        assert.ok(
            sql.includes("idx_query_feedback_created_at"),
            "Must create index on query_feedback(created_at)"
        );

        // 2. Verify query_artifacts enhancements
        assert.ok(
            sql.includes("ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS policy_version"),
            "Must add policy_version column to query_artifacts"
        );
        assert.ok(
            sql.includes("ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS deleted_at"),
            "Must add deleted_at column to query_artifacts"
        );
        assert.ok(
            sql.includes("idx_query_artifacts_user_created"),
            "Must create composite index for owner-scoped pagination"
        );
        assert.ok(
            sql.includes("idx_query_artifacts_deleted_at"),
            "Must create index on deleted_at"
        );

        // 3. Verify query_executions enhancements
        assert.ok(
            sql.includes("ALTER TABLE query_executions ADD COLUMN IF NOT EXISTS idempotency_key"),
            "Must add idempotency_key to query_executions"
        );
        assert.ok(
            sql.includes("ALTER TABLE query_executions ADD COLUMN IF NOT EXISTS result_expires_at"),
            "Must add result_expires_at to query_executions"
        );
        assert.ok(
            sql.includes("idx_query_executions_idempotency"),
            "Must index idempotency_key lookups"
        );
        assert.ok(
            sql.includes("idx_query_executions_result_expires"),
            "Must index result_expires_at for cleanup"
        );
    });

    it("verifies migration SQL is idempotent using IF NOT EXISTS clauses", async () => {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const migrationPath = path.resolve(
            __dirname,
            "../../../database/app/migrations/07-init-history-feedback-retention.sql"
        );
        const sql = await fs.readFile(migrationPath, "utf-8");

        // Every CREATE TABLE, ALTER TABLE ADD COLUMN, and CREATE INDEX must be safe for re-execution
        const createTableMatches = sql.match(/CREATE TABLE/gi) || [];
        const ifNotExistsTableMatches = sql.match(/CREATE TABLE IF NOT EXISTS/gi) || [];
        assert.equal(
            createTableMatches.length,
            ifNotExistsTableMatches.length,
            "All CREATE TABLE statements must use IF NOT EXISTS"
        );

        const addColMatches = sql.match(/ADD COLUMN/gi) || [];
        const ifNotExistsColMatches = sql.match(/ADD COLUMN IF NOT EXISTS/gi) || [];
        assert.equal(
            addColMatches.length,
            ifNotExistsColMatches.length,
            "All ADD COLUMN statements must use IF NOT EXISTS"
        );

        const createIdxMatches = sql.match(/CREATE INDEX/gi) || [];
        const ifNotExistsIdxMatches = sql.match(/CREATE INDEX IF NOT EXISTS/gi) || [];
        assert.equal(
            createIdxMatches.length,
            ifNotExistsIdxMatches.length,
            "All CREATE INDEX statements must use IF NOT EXISTS"
        );
    });
});

