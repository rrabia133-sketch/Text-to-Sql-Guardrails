-- 05-init-executions.sql: Query Execution Records & Concurrency Tracking in app_db

CREATE TABLE IF NOT EXISTS query_executions (
    id VARCHAR(64) PRIMARY KEY,
    artifact_id VARCHAR(64) NOT NULL REFERENCES query_artifacts(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL CHECK (
        status IN ('pending', 'running', 'completed', 'failed', 'timed_out', 'cancelled')
    ),
    sql_executed TEXT NOT NULL,
    execution_time_ms INTEGER NOT NULL DEFAULT 0,
    row_count INTEGER NOT NULL DEFAULT 0,
    byte_size INTEGER NOT NULL DEFAULT 0,
    truncated BOOLEAN NOT NULL DEFAULT FALSE,
    error_code VARCHAR(50),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_query_executions_user_id ON query_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_query_executions_artifact_id ON query_executions(artifact_id);
CREATE INDEX IF NOT EXISTS idx_query_executions_status ON query_executions(status);
CREATE INDEX IF NOT EXISTS idx_query_executions_created_at ON query_executions(created_at);
