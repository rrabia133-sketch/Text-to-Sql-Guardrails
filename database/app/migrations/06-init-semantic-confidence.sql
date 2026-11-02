-- 06-init-semantic-confidence.sql: Sprint 5 Semantic Validation, Confidence Scoring & Evaluation Ledger

-- 1. Expand query_artifacts status check constraint to support confidence decision band states
ALTER TABLE query_artifacts DROP CONSTRAINT IF EXISTS query_artifacts_status_check;

ALTER TABLE query_artifacts ADD CONSTRAINT query_artifacts_status_check CHECK (
    status IN (
        'preview',
        'preview_ready',
        'preview_review',
        'preview_blocked',
        'pending',
        'validating',
        'generating',
        'executing',
        'completed',
        'executed',
        'failed',
        'rejected'
    )
);

-- 2. Add semantic validation & confidence scoring columns to query_artifacts
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100);
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS confidence_band VARCHAR(20) CHECK (confidence_band IN ('HIGH', 'REVIEW', 'BLOCKED'));
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS confidence_breakdown JSONB DEFAULT '{}'::jsonb;
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS semantic_findings JSONB DEFAULT '[]'::jsonb;
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS repair_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS review_acknowledged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE query_artifacts ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_query_artifacts_confidence_band ON query_artifacts(confidence_band);

-- 3. Create semantic_evaluations table for benchmark evaluation runs (DO-07)
CREATE TABLE IF NOT EXISTS semantic_evaluations (
    id VARCHAR(64) PRIMARY KEY,
    dataset_version VARCHAR(50) NOT NULL,
    model_id VARCHAR(100) NOT NULL,
    prompt_version VARCHAR(50) NOT NULL,
    total_cases INTEGER NOT NULL DEFAULT 0,
    accuracy_score NUMERIC(5, 4) NOT NULL DEFAULT 0,
    wrong_answer_count INTEGER NOT NULL DEFAULT 0,
    refusal_recall NUMERIC(5, 4) NOT NULL DEFAULT 0,
    metrics_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_semantic_evaluations_dataset_version ON semantic_evaluations(dataset_version);
CREATE INDEX IF NOT EXISTS idx_semantic_evaluations_model_id ON semantic_evaluations(model_id);
CREATE INDEX IF NOT EXISTS idx_semantic_evaluations_created_at ON semantic_evaluations(created_at);

