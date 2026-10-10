-- Role and Privilege Containment Policy

-- 1. Create a dedicated read-only role with no superuser or creation privileges
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'analytics_user') THEN
        CREATE ROLE analytics_user WITH LOGIN PASSWORD 'analytics_read_only_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END $$;

-- 2. Revoke default public permissions to avoid privilege creep
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE analytics_db FROM PUBLIC;

-- 3. Grant strict read-only access to existing & future tables
GRANT CONNECT ON DATABASE analytics_db TO analytics_user;
GRANT USAGE ON SCHEMA public TO analytics_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analytics_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO analytics_user;

-- 4. Enforce strict 5-second execution timeout and read-only transaction defaults
ALTER ROLE analytics_user SET default_transaction_read_only = on;
ALTER ROLE analytics_user SET statement_timeout = '5s';
