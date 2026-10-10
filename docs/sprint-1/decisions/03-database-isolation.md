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
Task 8 penetration tests verified that `analytics_user` successfully executes `SELECT` while failing all `INSERT`, `DROP`, `CREATE`, and long-sleep queries with PostgreSQL error `25006` and `57014`.
