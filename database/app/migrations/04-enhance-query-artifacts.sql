-- 04-enhance-query-artifacts.sql: Sprint 3 Generation Metadata & Preview Status

ALTER TABLE query_artifacts DROP CONSTRAINT IF EXISTS query_artifacts_status_check;

ALTER TABLE query_artifacts ADD CONSTRAINT query_artifacts_status_check CHECK (
    status IN ('preview', 'pending', 'validating', 'generating', 'executing', 'completed', 'failed', 'rejected')
);

ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS assumptions JSONB DEFAULT '[]'::jsonb;
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS referenced_tables TEXT[] DEFAULT '{}';
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS referenced_columns TEXT[] DEFAULT '{}';
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS explanation TEXT;
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS provider VARCHAR(50);
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS model VARCHAR(100);
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(50);
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS schema_version VARCHAR(50);
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (CURRENT_TIMESTAMP + INTERVAL '15 minutes');
