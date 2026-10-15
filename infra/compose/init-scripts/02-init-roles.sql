-- ============================================================================
-- 01-roles.sql: Least-Privilege Database Roles & Kernel Containment
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Cluster-Level: Create Dedicated Roles (Idempotent)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    -- 1.1 Analytical query execution role (used by AST execution service)
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'analytics_user') THEN
        CREATE ROLE analytics_user WITH LOGIN PASSWORD 'analytics_password'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;

    -- 1.2 Application metadata role (used by Fastify backend runtime)
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user WITH LOGIN PASSWORD 'app_password'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;

    -- 1.3 Dedicated DDL migration role (used for CI & database migrations)
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'db_migrator') THEN
        CREATE ROLE db_migrator WITH LOGIN PASSWORD 'migrator_password'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Database Connection Isolation (Revoke PUBLIC access)
-- ----------------------------------------------------------------------------
-- By default, PostgreSQL grants CONNECT on new databases to PUBLIC.
-- We revoke this so roles can only connect to their designated database.

REVOKE CONNECT ON DATABASE analytics_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE app_db FROM PUBLIC;

-- analytics_user can ONLY connect to analytics_db
GRANT CONNECT ON DATABASE analytics_db TO analytics_user;

-- app_user can ONLY connect to app_db
GRANT CONNECT ON DATABASE app_db TO app_user;

-- db_migrator and superuser can connect to both for schema management
GRANT CONNECT ON DATABASE analytics_db TO db_migrator;
GRANT CONNECT ON DATABASE app_db TO db_migrator;


-- ----------------------------------------------------------------------------
-- 3. Permissions for analytics_db (Read-Only Kernel Enforcement)
-- ----------------------------------------------------------------------------
\c analytics_db

-- Revoke schema creation rights from public & analytics_user
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM analytics_user;

-- Grant read-only access to existing & future tables
GRANT USAGE ON SCHEMA public TO analytics_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analytics_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO analytics_user;

-- Allow db_migrator to manage DDL in analytics_db
GRANT ALL ON SCHEMA public TO db_migrator;
GRANT ALL ON ALL TABLES IN SCHEMA public TO db_migrator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO db_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO db_migrator;

-- Kernel security guardrails for analytics_user
ALTER ROLE analytics_user SET default_transaction_read_only = on;
ALTER ROLE analytics_user SET statement_timeout = '5s';


-- ----------------------------------------------------------------------------
-- 4. Permissions for app_db (Metadata CRUD, No DDL for app_user)
-- ----------------------------------------------------------------------------
\c app_db

-- Revoke schema creation from public & app_user (prevents CREATE/DROP TABLE attacks)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM app_user;

-- Grant CRUD on application metadata tables to app_user
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_user;

-- Allow db_migrator full DDL privileges to manage migrations
GRANT ALL ON SCHEMA public TO db_migrator;
GRANT ALL ON ALL TABLES IN SCHEMA public TO db_migrator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO db_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO db_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO db_migrator;
