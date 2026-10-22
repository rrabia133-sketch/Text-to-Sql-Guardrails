-- 03-provider-budget-ledger.sql: Daily Cloud Budget & LLM Usage Ledger in app_db

CREATE TABLE IF NOT EXISTS provider_usage_ledger (
    id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    provider VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
    request_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_provider_usage_date ON provider_usage_ledger(date);
CREATE INDEX IF NOT EXISTS idx_provider_usage_provider ON provider_usage_ledger(provider);
