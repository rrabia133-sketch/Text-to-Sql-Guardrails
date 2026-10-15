-- 01-init-identity.sql: Users, Roles, and Sessions in app_db

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(150) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('analyst', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Seed Initial Users (Analyst A, Analyst B, Administrator)
INSERT INTO users (id, email, username, display_name, role)
VALUES
    ('usr_analyst_a', 'analyst-a@example.com', 'analyst_a', 'Analyst Alice', 'analyst'),
    ('usr_analyst_b', 'analyst-b@example.com', 'analyst_b', 'Analyst Bob', 'analyst'),
    ('usr_admin_01',  'admin@example.com',     'admin_user', 'System Administrator', 'admin')
ON CONFLICT (id) DO NOTHING;
