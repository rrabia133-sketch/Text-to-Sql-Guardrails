---
name: security-guardrails
description: >-
  Use this skill whenever generating, validating, reviewing, or executing SQL queries, AST parser logic, database roles, or provider egress controls. Enforces recursive AST validation, fail-closed policy, read-only transaction containment, and local-only airgap routing.
---

# SQL Security Guardrails & Privilege Containment Skill

This skill guides the implementation, verification, and adversarial testing of the Text-to-SQL system's deterministic AST security layer and database kernel privilege boundaries.

---

## 1. Core Security Principles

### 1. Fail Closed Architecture
- Any query that cannot be cleanly parsed by `pgsql-ast-parser` is rejected immediately with `SYNTAX_ERROR`.
- Any unapproved AST node type, unknown function, or unverified table identifier triggers immediate rejection.
- Never weaken or bypass guardrail rules to make an adversarial test or malformed query pass.

### 2. Defense-in-Depth
- Application AST checks are the first perimeter.
- PostgreSQL database kernel permissions (`analytics_user` with `default_transaction_read_only = on`) form the non-bypassable second perimeter.
- Even if a bug were present in the parser, the database kernel rejects writes, table drops, and schema modifications.

---

## 2. AST Validation Rules

Every generated SQL query must satisfy all of the following rules:

1. **Strictly One Statement**:
   - `astList.length === 1`.
   - Semicolon chaining (`;`) or stacked queries are rejected (`MULTIPLE_STATEMENTS`).
2. **Statement Type = SELECT**:
   - Root statement `type` must be `'select'`.
   - Modifying CTEs (`WITH ins AS (INSERT ...) SELECT ...`) are blocked.
   - `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `GRANT`, `COPY` are blocked (`FORBIDDEN_STATEMENT_TYPE`).
3. **No Locking Clauses**:
   - `FOR UPDATE`, `FOR SHARE`, `NOWAIT`, `SKIP LOCKED` are blocked (`LOCKING_CLAUSE`).
4. **Table Allowlist**:
   - Allowed tables: `customers`, `products`, `orders`, `order_items`.
   - Direct access to `pg_catalog.*`, `information_schema.*`, or `pg_toast.*` is rejected (`FORBIDDEN_CATALOG`).
5. **Approved Functions**:
   - Aggregates: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`.
   - Scalars: `DATE_TRUNC`, `EXTRACT`, `COALESCE`, `ROUND`, `LOWER`, `UPPER`.
   - System calls (`pg_sleep`, `pg_read_file`, `version`, `current_user`) are blocked (`FORBIDDEN_FUNCTION`).
6. **Mandatory Row Cap**:
   - Injected if missing: `LIMIT 50`.
   - Clamped if excessive: Maximum `LIMIT 100`.
   - Transformed query must pass complete revalidation.

---

## 3. Database Execution Boundaries

When executing queries against `analytics_db`:

1. **Credential**: Connect strictly via `analytics_user`.
2. **Transaction**: Wrap in explicit `BEGIN TRANSACTION READ ONLY; ... COMMIT;`.
3. **Timeouts**:
   - `SET LOCAL statement_timeout = '5000ms';`
   - `SET LOCAL lock_timeout = '1000ms';`
4. **Result Bounds**:
   - Row limit: 500 rows maximum (mark `truncated: true` if exceeded).
   - Byte limit: 1 MiB maximum payload.
5. **Concurrency**:
   - Max 2 concurrent queries per user.
   - Max 10 concurrent queries globally.

---

## 4. Provider Airgap & Privacy Rules

1. **Local Mode Guarantee**:
   - When `PROVIDER_MODE=local`, zero outbound network calls are made to external endpoints.
   - If Ollama is unavailable, fail closed with HTTP 503; **never** fallback silently to cloud providers.
2. **Data Minimization in Cloud Payloads**:
   - When Groq is used, send only sanitized schema definitions, glossary rules, and the user prompt.
   - Never transmit database rows, customer PII, or internal credentials.
