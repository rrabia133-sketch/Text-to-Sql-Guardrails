-- 08-enhance-users-password-hash.sql: Non-destructive Expand/Contract addition of password_hash to users

ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NULL;
