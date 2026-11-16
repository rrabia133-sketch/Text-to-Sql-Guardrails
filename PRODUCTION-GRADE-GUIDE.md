# Production-Grade Readiness & Migration Guide

This document provides a point-by-point engineering checklist and implementation guide to take the **Text-to-SQL Guardrails & Privilege Containment Interface** from its portfolio/MVP baseline to a **live, enterprise production deployment**.

---

## 1. What Is Already Production-Grade (Built-In)

Before making changes, note that the core security and execution engine already implements defense-in-depth controls:

- [x] **Deterministic AST Guardrails:** Every generated SQL query is parsed via `pgsql-ast-parser` into a single `SELECT` statement; stacked queries (`;`), DML/DDL (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `COPY`), system catalogs (`pg_*`, `information_schema`), and locking clauses (`FOR UPDATE`) are blocked fail-closed.
- [x] **Dual-Database Physical Separation:** Application metadata (`app_db`) and business data (`analytics_db`) use isolated connection pools and separate database credentials.
- [x] **PostgreSQL Kernel Read-Only Containment:** Analytical queries run inside explicit `BEGIN TRANSACTION READ ONLY; ... COMMIT;` blocks with `statement_timeout = '5s'` and `default_transaction_read_only = on`.
- [x] **Immutable Pre-Computed Query Artifacts:** `POST /api/v1/queries/:id/execute` only executes server-stored artifacts in `preview` state with SHA-256 hash verification and a 15-minute TTL.
- [x] **Airgap & Privacy Routing:** `PROVIDER_MODE=local` guarantees zero external network egress (fails closed with HTTP 503 if Ollama is unreachable).
- [x] **CSV Formula Injection Neutralization:** RFC 4180 export sanitizes cells beginning with `=`, `+`, `-`, `@`, `\t`, or `\r`.
- [x] **Zero-Leak Log Redaction & Prometheus Metrics:** Pino logger redaction masks secrets/PII, injects `x-request-id`, and exposes metrics at `GET /api/v1/metrics`.

---

## 2. Critical Code Changes Required for Real Production

### A. Replace Demo Authentication with Real Identity (Priority: P0)
- [x] **Cryptographic Password Hashing (`scrypt` + `timingSafeEqual`):**
  - Implemented in `backend/src/modules/auth/password.util.ts` and wired into `POST /api/auth/login` (`backend/src/modules/auth/auth.routes.ts`).
  - Added non-destructive Expand/Contract migration `database/app/migrations/08-enhance-users-password-hash.sql` adding `password_hash` to `users`.
  - In `NODE_ENV=production`, password verification is strictly mandatory; passwordless login attempts fail closed with `401 Unauthorized`.
- [x] **Disable Public User Enumeration in Production:**
  - `GET /api/auth/users` (`backend/src/modules/auth/auth.routes.ts`) now requires an authenticated `admin` session when `NODE_ENV=production` (`401`/`403` for anonymous or non-admin users).
- [x] **Harden Session Cookies, HSTS, Proxy Trust & Brute-Force Rate Limiting:**
  - `session_id` cookie uses `sameSite: "strict"` and `secure: true` in production.
  - Added per-IP sliding-window brute-force rate limiting (`429 Too Many Requests` + `Retry-After`) on `POST /api/auth/login`.
  - Enabled `trustProxy: true` in `backend/src/app.ts` and `Strict-Transport-Security` (HSTS) headers in `backend/src/plugins/redaction.ts` for production deployments.
- [ ] **Optional Enterprise SSO Integration:**
  - If your organization uses Okta, Auth0, or Microsoft Entra ID, connect OIDC token validation to `POST /api/auth/login`.

### B. Connect Your Real Business Schema & Glossary (Priority: P0)
- [x] **Wire Live Schema Introspection & Fail-Closed Production Mode:**
  - Updated `SchemaService` (`backend/src/modules/schema/schema.service.ts`) and `backend/src/app.ts` to enable `failClosed: true` in `NODE_ENV=production`, refusing to silently fall back to the synthetic 4-table fixture if `analytics_db` is unreachable.
- [ ] **Update Allowlisted Tables & Columns for Your Domain:**
  - Edit `ALLOWED_TABLES` and `ALLOWED_COLUMNS` in `backend/src/modules/schema/schema.types.ts` to list your production tables and safe analytical columns.
  - Explicitly omit sensitive PII/credential columns (e.g., `password_hash`, `ssn`, `tax_id`, `api_key`, `billing_token`).
- [ ] **Update Semantic Metrics & Business Glossary:**
  - Replace the e-commerce seed entries in `database/app/migrations/` (semantic metric definitions, approved join paths, and status filter rules) with your organization's official KPI formulas.
- [ ] **Add Schema RAG for Large Warehouses (If > 20 Tables):**
  - If your analytical database has dozens or hundreds of tables, index table/column descriptions using `pgvector` and retrieve only the top-K relevant tables per user prompt so you do not exceed LLM context windows.

### C. Fail-Closed Environment & Secret Validation (Priority: P0)
- [x] **Disallow Default Fallbacks in Production:**
  - Updated `validateConfig()` in `backend/src/config/env.ts` so that when `NODE_ENV === "production"`, missing `SESSION_SECRET`, default placeholder secrets, missing `APP_DB_URL`/`ANALYTICS_DB_URL`, or missing `GROQ_API_KEY` (in `cloud`/`hybrid` mode) immediately throw a startup error.
  - Added configurable `TRUST_PROXY`, `APP_DB_POOL_MAX`, `ANALYTICS_DB_POOL_MAX`, `METRICS_BEARER_TOKEN`, and `AUTH_RATE_LIMIT_MAX`.
- [x] **Protect `/api/v1/metrics`:**
  - Updated `GET /api/v1/metrics` (`backend/src/modules/metrics/metrics.routes.ts`) to enforce constant-time `Authorization: Bearer <METRICS_BEARER_TOKEN>` verification (or an authenticated `admin` session) whenever `METRICS_BEARER_TOKEN` is configured.

---

## 3. Infrastructure & Database Hardening Checklist

### A. PostgreSQL Production Topology
- [ ] **Point `ANALYTICS_DB_URL` to a Read Replica:**
  - Never run analytical Text-to-SQL queries against your primary OLTP writer instance. Connect `analyticsPool` to a dedicated PostgreSQL **Read Replica** so heavy aggregations cannot impact transactional workloads.
- [ ] **Apply Kernel-Level Role Restrictions on the Target Database:**
  - Execute the role hardening script in `database/roles/` on your production analytics database:
    ```sql
    CREATE ROLE analytics_user WITH LOGIN PASSWORD '<strong-random-password>';
    GRANT CONNECT ON DATABASE analytics_db TO analytics_user;
    GRANT USAGE ON SCHEMA public TO analytics_user;
    GRANT SELECT ON TABLE <your_allowed_tables> TO analytics_user;
    ALTER ROLE analytics_user SET default_transaction_read_only = on;
    ALTER ROLE analytics_user SET statement_timeout = '5s';
    ALTER ROLE analytics_user SET lock_timeout = '1s';
    ```
- [ ] **Enforce Encrypted Database Connections (TLS):**
  - Append `?sslmode=verify-full&sslrootcert=/path/to/ca.crt` to both `APP_DB_URL` and `ANALYTICS_DB_URL`.
- [ ] **Tune Connection Pool Sizes:**
  - In `backend/src/app.ts`, make `appPool` (`max: 5`) and `analyticsPool` (`max: 10`) configurable via `APP_DB_POOL_MAX` and `ANALYTICS_DB_POOL_MAX` environment variables, or place **PgBouncer** in front of PostgreSQL.

### B. Multi-Instance Horizontal Scaling (If Running > 1 Backend Replica)
Currently, two services store state in local Node.js process memory, which works for a single container but requires Redis when load-balancing across multiple replicas:

- [ ] **Move `ResultCacheService` to Redis:**
  - `backend/src/modules/execution/result-cache.service.ts` caches query results in memory for subsequent CSV exports. Back this with Redis (using a short 15-minute TTL and encrypted payloads) so any replica can serve a user's CSV download.
- [ ] **Move `ConcurrencyManager` to Redis:**
  - `backend/src/modules/execution/concurrency-manager.ts` tracks active per-user queries in a local `Map`. Use Redis atomic counters (`INCR` / `DECR` with expiry) to enforce concurrency limits across all replicas.
- [ ] **Add API Rate Limiting:**
  - Register `@fastify/rate-limit` (backed by Redis) on `/api/auth/login` (e.g., 5 attempts/min per IP) and `/api/v1/queries/generate` (e.g., 20 requests/min per user).

---

## 4. LLM Inference Infrastructure

Choose your operating mode based on your data governance requirements:

### Option 1: Strict Airgap Mode (`PROVIDER_MODE=local`)
- [ ] **Provision Dedicated GPU Compute:**
  - Run Ollama on an isolated internal GPU node (e.g., NVIDIA L4, A10G, or T4 with >= 16 GB VRAM) inside your private VPC.
  - Use a production coding model (`qwen2.5-coder:14b` or `qwen2.5-coder:32b` if VRAM permits, or `qwen2.5-coder:7b` for lower latency).
- [ ] **Enforce Network Egress Lockdown:**
  - Block all outbound internet traffic (`0.0.0.0/0`) from the backend and Ollama security groups/firewalls.

### Option 2: Enterprise Cloud / Hybrid Mode (`PROVIDER_MODE=cloud` or `hybrid`)
- [ ] **Sign a Zero Data Retention (ZDR) Agreement:**
  - Ensure your cloud LLM provider (Groq Enterprise, AWS Bedrock, Azure OpenAI, or Google Vertex AI) is configured with zero prompt logging and zero training on customer prompts.
- [ ] **Configure Daily Budget Caps:**
  - Set `DAILY_CLOUD_BUDGET_USD` in your production environment so the built-in budget ledger automatically halts runaway token spend.

---

## 5. Secrets Management & CI/CD Security

- [ ] **Never Commit or Store Plaintext `.env` Files on Production Servers:**
  - Inject `SESSION_SECRET`, `APP_DB_URL`, `ANALYTICS_DB_URL`, `GROQ_API_KEY`, and `BACKUP_ENCRYPTION_KEY` via **AWS Secrets Manager**, **GCP Secret Manager**, **HashiCorp Vault**, or **Kubernetes External Secrets**.
- [ ] **Keep `RUN_HOLDOUT_EVAL=false` in Production:**
  - Ensure the benchmark evaluation flag remains `false` in production environments.
- [ ] **Run Automated Release Gates on Every Deployment:**
  - Require the following CI checks to pass before promoting any container image:
    ```bash
    npm ci
    npm run build
    npm run typecheck
    npm run test
    ```

---

## 6. Day-2 Operations: Backups, Retention & Monitoring

- [ ] **Automate Encrypted Metadata Backups (`BackupService`):**
  - Schedule a daily cron job or Kubernetes `CronJob` using `backend/src/modules/backup/backup.service.ts` to create AES-256-GCM encrypted snapshots of `app_db` and upload them to immutable object storage (S3 Object Lock / GCS Bucket Lock).
- [ ] **Schedule Data Retention Purges (`RetentionService`):**
  - Trigger `RetentionService` (`POST /api/v1/retention/purge` or via scheduled worker) daily to purge expired query artifacts and rotate old audit records per your compliance policy.
- [ ] **Configure Prometheus & Alertmanager Rules:**
  - Scrape `GET /api/v1/metrics` and page on-call engineers when:
    - `text2sql_requests_total{status=~"5.."}` > 1% over 5 minutes.
    - `text2sql_guardrail_rejections_total` spikes > 10/minute (indicates active SQL injection probing or prompt drift).
    - `text2sql_request_duration_seconds` p95 > 3.0 seconds.
    - `text2sql_db_connection_pool_active` exceeds 85% pool capacity.

---

## 7. Quick Reference: Key Files to Modify

| Production Area | File to Update | What to Change |
| :--- | :--- | :--- |
| **Authentication** | `backend/src/modules/auth/auth.routes.ts` | Add SSO/OIDC or password hash verification; lock down `GET /users` |
| **Environment Config** | `backend/src/config/env.ts` | Require explicit secrets in `NODE_ENV=production`; remove dev fallbacks |
| **Schema Allowlist** | `backend/src/modules/schema/schema.types.ts` | Replace 4 demo tables with your real production tables & safe columns |
| **Live Introspection** | `backend/src/app.ts` & `schema.service.ts` | Pass `analyticsPool` to `SchemaService`; remove synthetic fallback |
| **Distributed Cache** | `backend/src/modules/execution/result-cache.service.ts` | Back result cache with Redis if deploying multiple backend containers |
| **Concurrency Gate** | `backend/src/modules/execution/concurrency-manager.ts` | Back per-user query limits with Redis if deploying multiple containers |
| **DB Kernel Roles** | `database/roles/` | Apply `analytics_user` read-only grants on your PostgreSQL read replica |
| **Docker Topology** | `infra/compose/docker-compose.staging.yml` | Add TLS termination (HTTPS) certificates and secret manager injection |
