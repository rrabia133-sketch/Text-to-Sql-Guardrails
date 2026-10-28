# Sprint 4 — SQL Guardrails and Restricted Execution

- **Duration:** 2 Weeks (Baseline)
- **Status:** 🟢 **COMPLETED**
- **Sprint Goal:** Deliver comprehensive recursive AST safety guardrails, schema-scoped identifier resolution, canonical normalization, row-cap enforcement, EXPLAIN plan cost gating, and a secure, restricted PostgreSQL database execution engine:
  - Recursive AST policy engine using `pgsql-ast-parser` that fails closed against non-SELECT queries, multi-statements, nested writes, forbidden functions, system catalogs (`pg_*`, `information_schema`), locking clauses (`FOR UPDATE`), and unknown AST nodes.
  - Lexical scope tracking and identifier resolution for table aliases, Common Table Expressions (`WITH ... AS (...)`), subqueries, and column projections against approved schema tables (`customers`, `products`, `orders`, `order_items`).
  - Query normalization and mandatory row-cap enforcement (inject `LIMIT 50`, clamp to max `LIMIT 100`) with automated post-transformation revalidation.
  - Non-executing `EXPLAIN` query plan cost gate inspecting estimated execution cost before database dispatch.
  - Restricted execution engine executing strictly server-stored, owned, non-expired query artifacts with immutable hash verification.
  - Defense-in-depth database containment using dedicated `analytics_user` with kernel-enforced `default_transaction_read_only = on`, `statement_timeout = 5s`, and `lock_timeout = 1s`.
  - Resource and concurrency bounds: row cap (500 rows), byte cap (1 MiB), user concurrency (2 queries/user), and global concurrency (10 queries max).
  - Asynchronous query cancellation (`pg_cancel_backend`) and connection pool cleanup on client abort or timeout.
  - Fastify execution API endpoints (`POST /api/v1/queries/:id/execute`, `GET /api/v1/executions/:id`) and audit logging.
  - Frontend execution interaction ("Run Query" button in Preview panel, execution spinner, typed results table).
- **Reference Guides:**
  - Sprint Plan: [07-sprint-plan.md](../planning/07-sprint-plan.md#sprint-4--sql-guardrails-and-restricted-execution)
  - User Stories: [06-user-stories.md](../planning/06-user-stories.md#us-09--guardrails)
  - Architecture: [05-architecture.md](../planning/05-architecture.md#boundaries-and-components)
  - DevOps Plan: [08-devops-plan.md](../planning/08-devops-plan.md#tasks)
  - Functional Requirements: [02-functional-requirements.md](../planning/02-functional-requirements.md)
  - Sprint 1 AST & DB Foundations: [parser-proof.md](../sprint-1/parser-proof.md), [query-rules.md](../sprint-1/query-rules.md), [db-proof.md](../sprint-1/db-proof.md)

---

## Sprint Backlog & Status

| Work Item | Type | Title | SP | Status | Progress |
| :--- | :--- | :--- | :---: | :---: | :--- |
| [US-09–10](US-09-10.md) | Story | SQL Guardrails & Restricted Execution (US-09, US-10) | 24 | 🟢 **COMPLETED** | 17 / 17 Tasks (100%) |
| [DO-06](DO-06.md) | DevOps | Bounded Connection Pools, Timeouts, Cancellation & Containment | — | 🟢 **COMPLETED** | 4 / 4 Tasks (100%) |

---

## Sprint 4 Task Board

| Task # | Name | Assigned To | Status | Output Artifact |
| :---: | :--- | :--- | :--- | :--- |
| **01** | Guardrails contracts, error types & finding schemas | [US-09–10](US-09-10.md#task-1-guardrails-contracts-error-types--finding-schemas) | 🟢 **COMPLETED** | `packages/contracts/src/guardrails.ts` |
| **02** | AST parser wrapper & single SELECT statement policy | [US-09–10](US-09-10.md#task-2-ast-parser-wrapper--single-select-statement-policy) | 🟢 **COMPLETED** | `backend/src/modules/guardrails/ast-parser.service.ts` |
| **03** | Recursive AST node visitor & unknown construct blocker | [US-09–10](US-09-10.md#task-3-recursive-ast-node-visitor--unknown-construct-blocker) | 🟢 **COMPLETED** | `backend/src/modules/guardrails/node-visitor.ts` |
| **04** | Scoped identifier & alias resolution engine | [US-09–10](US-09-10.md#task-4-scoped-identifier--alias-resolution-engine) | 🟢 **COMPLETED** | `backend/src/modules/guardrails/scope-resolver.ts` |
| **05** | Allowlist schema object & catalog protection verifier | [US-09–10](US-09-10.md#task-5-allowlist-schema-object--catalog-protection-verifier) | 🟢 **COMPLETED** | `backend/src/modules/guardrails/schema-validator.ts` |
| **06** | Approved function whitelist & dangerous function blocker | [US-09–10](US-09-10.md#task-6-approved-function-whitelist--dangerous-function-blocker) | 🟢 **COMPLETED** | `backend/src/modules/guardrails/function-validator.ts` |
| **07** | SQL normalizer, row-cap enforcement & post-transform revalidation | [US-09–10](US-09-10.md#task-7-sql-normalizer-row-cap-enforcement--post-transform-revalidation) | 🟢 **COMPLETED** | `backend/src/modules/guardrails/normalizer.ts` |
| **08** | EXPLAIN plan cost gatekeeper & query complexity analyzer | [US-09–10](US-09-10.md#task-8-explain-plan-cost-gatekeeper--query-complexity-analyzer) | 🟢 **COMPLETED** | `backend/src/modules/guardrails/plan-cost-gate.ts` |
| **09** | Unified guardrails orchestrator & finding aggregation service | [US-09–10](US-09-10.md#task-9-unified-guardrails-orchestrator--finding-aggregation-service) | 🟢 **COMPLETED** | `backend/src/modules/guardrails/guardrails.service.ts` |
| **10** | Shared execution contracts & result types | [US-09–10](US-09-10.md#task-10-shared-execution-contracts--result-types) | 🟢 **COMPLETED** | `packages/contracts/src/execution.ts` |
| **11** | Execution database migration & repository in app_db | [US-09–10](US-09-10.md#task-11-execution-database-migration--repository-in-app_db) | 🟢 **COMPLETED** | `database/app/migrations/05-init-executions.sql` |
| **12** | Immutable artifact ownership, expiry & SQL hash gate | [US-09–10](US-09-10.md#task-12-immutable-artifact-ownership-expiry--sql-hash-gate) | 🟢 **COMPLETED** | `backend/src/modules/execution/artifact-gate.ts` |
| **13** | Restricted database executor with explicit read-only transaction | [US-09–10](US-09-10.md#task-13-restricted-database-executor-with-explicit-read-only-transaction) | 🟢 **COMPLETED** | `backend/src/modules/execution/restricted-executor.ts` |
| **14** | Resource limiter: statement timeout, row count & byte caps | [US-09–10](US-09-10.md#task-14-resource-limiter-statement-timeout-row-count--byte-caps) | 🟢 **COMPLETED** | `backend/src/modules/execution/resource-limiter.ts` |
| **15** | Concurrency throttle, cancellation & connection pool cleanup | [US-09–10](US-09-10.md#task-15-concurrency-throttle-cancellation--connection-pool-cleanup) | 🟢 **COMPLETED** | `backend/src/modules/execution/concurrency-manager.ts` |
| **16** | Fastify execution API routes & audit logging | [US-09–10](US-09-10.md#task-16-fastify-execution-api-routes--audit-logging) | 🟢 **COMPLETED** | `backend/src/modules/execution/execution.routes.ts` |
| **17** | Adversarial security test suite & database privilege benchmark | [US-09–10](US-09-10.md#task-17-adversarial-security-test-suite--database-privilege-benchmark) | 🟢 **COMPLETED** | `backend/test/security/guardrails-adversarial.test.ts` |

---

## DevOps DO-06 Task Board

| Task # | Name | Assigned To | Status | Output Artifact |
| :---: | :--- | :--- | :--- | :--- |
| **D1** | Bounded Analytics Connection Pool & Kernel GUC Configuration | [DO-06](DO-06.md#task-1-bounded-analytics-connection-pool--kernel-guc-configuration) | 🟢 **COMPLETED** | `backend/src/config/env.ts`, `analytics-pool.ts` |
| **D2** | Kernel Privilege Denial & Read-Only Transaction Verification | [DO-06](DO-06.md#task-2-kernel-privilege-denial--read-only-transaction-verification) | 🟢 **COMPLETED** | `backend/test/security/privilege-containment.test.ts` |
| **D3** | Asynchronous Backend Cancellation & Disconnect Cleanup | [DO-06](DO-06.md#task-3-asynchronous-backend-cancellation--disconnect-cleanup) | 🟢 **COMPLETED** | `backend/src/modules/execution/cancellation.service.ts` |
| **D4** | Resource Stress, Concurrency & Byte-Limit Verification Benchmarks | [DO-06](DO-06.md#task-4-resource-stress-concurrency--byte-limit-verification-benchmarks) | 🟢 **COMPLETED** | `backend/test/security/restricted-execution.test.ts` |

---

## Sprint 4 Exit Gate Checklist

Before advancing to Sprint 5 (Semantic validation and confidence), all of the following exit criteria must be met:

- [x] **100% Adversarial Rejection:** 100% of curated adversarial SQL injection, multi-statement, catalog traversal, locking, and destructive queries are blocked before database dispatch.
- [x] **Recursive Scope & CTE Integrity:** Table aliases and CTEs resolve accurately to the 4 allowlisted tables; unresolvable or shadow references fail closed.
- [x] **Row-Cap & Normalization Revalidation:** Missing LIMIT clauses are injected (`LIMIT 50`) and excessive limits capped (`LIMIT 100`), with the transformed query revalidated through the full AST visitor.
- [x] **EXPLAIN Plan Cost Gate:** Queries exceeding maximum planner cost threshold (`MAX_PLAN_COST = 10000`) are blocked before physical execution.
- [x] **Immutable Owned Artifact Gate:** Only server-persisted query artifacts owned by the active user with matching SQL hashes and unexpired status (`< 15 minutes`) can execute.
- [x] **Kernel Privilege Defense:** Real PostgreSQL `analytics_user` role denies write, DDL, temporary table creation, or administrative operations independently of AST validation.
- [x] **Deterministic Resource Caps:** Statement timeout (5s), lock timeout (1s), row limit (500 rows), and payload byte limit (1 MiB) are enforced and verified.
- [x] **Concurrency & Clean Cancellation:** Concurrency throttler limits active queries (2/user, 10 global), and client disconnect or cancel action terminates backend execution via `pg_cancel_backend` without leaking pool connections.
- [x] **Audit Logging Without Data Leaks:** Execution outcomes are logged in `app_db.audit_logs` without storing sensitive customer PII or query result sets.

---
