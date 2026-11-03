-- 07-init-history-feedback-retention.sql: Sprint 6 History, Feedback & Retention Schema Enhancements

-- 1. Create query_feedback table for analyst accuracy feedback (US-15)
CREATE TABLE IF NOT EXISTS query_feedback (
    id VARCHAR(64) PRIMARY KEY,
    artifact_id VARCHAR(64) NOT NULL REFERENCES query_artifacts(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    verdict VARCHAR(20) NOT NULL CHECK (verdict IN ('correct', 'incorrect')),
    reason_code VARCHAR(50) CHECK (
        reason_code IN ('wrong_metric', 'wrong_filter', 'wrong_date', 'missing_rows', 'other')
    ),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_query_feedback_artifact_id ON query_feedback(artifact_id);
CREATE INDEX IF NOT EXISTS idx_query_feedback_user_id ON query_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_query_feedback_created_at ON query_feedback(created_at);

-- 2. Add schema_version, policy_version, deleted_at columns & composite index to query_artifacts for fast owner-filtered pagination (US-13, US-15)
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS policy_version VARCHAR(50) DEFAULT '1.0.0';
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_query_artifacts_user_created ON query_artifacts(user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_query_artifacts_deleted_at ON query_artifacts(deleted_at);

-- 3. Add idempotency_key & result_expires_at to query_executions for idempotent execution and 15-minute result payload TTL (US-13, US-14, DO-08)
ALTER TABLE query_executions ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);
ALTER TABLE query_executions ADD COLUMN IF NOT EXISTS result_expires_at TIMESTAMPTZ DEFAULT (CURRENT_TIMESTAMP + INTERVAL '15 minutes');

CREATE INDEX IF NOT EXISTS idx_query_executions_idempotency ON query_executions(user_id, artifact_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_query_executions_result_expires ON query_executions(result_expires_at);

