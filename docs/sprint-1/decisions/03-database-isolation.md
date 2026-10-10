# ADR 03: Database Isolation & Role Containment Strategy

- **Status:** Accepted
- **Deciders:** Rabia-Dev
- **Date:** 2026-10-10

## Context & Problem
Defense-in-depth requires that even if an attacker completely bypasses the AST parser, the database engine itself must reject writes and schema changes.

## Decision
1. **Dedicated User:** Execute user queries exclusively through `analytics_user`.
2. **Revocation:** Revoke all `CREATE` privileges on schema `public` and database `analytics_db`.
3. **Kernel Enforcements:** 
   - `ALTER ROLE analytics_user SET default_transaction_read_only = on;`
   - `ALTER ROLE analytics_user SET statement_timeout = '5s';`
4. **Port Allocation:** Isolated loopback binding `127.0.0.1:5434:5432`.

## Empirical Evidence
Task 8 penetration tests verified that `analytics_user` successfully executes `SELECT` while failing all `INSERT`, `DROP`, `CREATE`, and long-sleep queries with PostgreSQL error codes `25006` (read-only transaction violation) and `57014` (query timeout canceled).

## Trade-offs & Security Considerations
- **Pros:** True defense-in-depth. Even if AST parsing is bypassed, the database engine strictly prevents write attacks, privilege escalation, and resource exhaustion DoS.
- **Cons:** Cannot execute queries requiring temporary table creation (`CREATE TEMP TABLE`) or session variables.
- **Operational Requirement:** Schema migrations and test fixture seedings MUST run via a separate administrative superuser or migration pipeline (`db-init`), completely decoupled from the runtime execution pool.

## Baseline Staging & Production Deployment Requirements (DO-01 Task 4)
- **Separate Connection Pools:** The execution service must only hold credentials for `analytics_user`. Superuser/admin credentials must never be mounted into the execution container.
- **Read-Only Replica:** In production, route `analytics_user` queries to a dedicated PostgreSQL read replica rather than the primary database instance.
- **Network Isolation:** Database port must not be exposed to the public internet; bind exclusively to internal container networks or secure private subnets.
- **Resource Clamping:** Retain 5-second `statement_timeout` and CPU/memory quotas on the database container to prevent compute exhaustion.

## Conditions for Reconsideration
- If future product features require storing user queries, query histories, or dashboard configurations, these must be written to an isolated application database (e.g. `app_metadata`) with dedicated write credentials, keeping the analytical warehouse strictly read-only.
