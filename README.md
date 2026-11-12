# Text-to-SQL Guardrails & Privilege Containment Interface

A high-assurance natural language **Text-to-SQL** monorepo built with deterministic AST safety guardrails, dual-database PostgreSQL privilege containment, interchangeable local/cloud LLM routing, semantic validation, and transparent confidence scoring.

---

## Key Capabilities

- **Contract-First Monorepo:** Shared TypeScript + Zod contracts in `@text2sql/contracts` (`packages/contracts`), consumed by Fastify 5 (`backend/`) and React + Vite (`frontend/`).
- **Recursive AST Guardrails (`pgsql-ast-parser`):** Strictly enforces single `SELECT` statements, blocks multi-statements/DDL/DML/CTEs with nested writes, protects system catalogs (`pg_*`, `information_schema`), whitelists approved functions and tables, enforces row caps (`LIMIT`), and validates `EXPLAIN` plan cost before dispatch.
- **Dual-Database Privilege Containment:** Isolates business data (`analytics_db`, queried strictly via read-only `analytics_user` with `default_transaction_read_only = on` and `statement_timeout = 5s`) from application metadata (`app_db`, managed by `app_user` with zero DDL rights).
- **Privacy-First Provider Routing:** Supports local Ollama (`PROVIDER_MODE=local` airgap mode with zero external egress and fail-closed HTTP 503) and budgeted Groq cloud routing.
- **Semantic Validation & Heuristic Confidence:** Checks intent-slot alignment, glossary definitions, temporal bounds, and join cardinality/fanout; applies at most one bounded repair pass (`maxRepairAttempts = 1`); and classifies queries into `HIGH`, `REVIEW`, and `BLOCKED` bands.
- **Audited Execution, Safe CSV Export & Retention:** Executes only immutable server-owned artifacts inside `BEGIN TRANSACTION READ ONLY` blocks, prevents IDOR cross-user access, neutralizes CSV formula injection, and enforces TTL retention.

---

## Workspace Structure

```text
Text-to-SQL Interface/
├── packages/contracts/     # @text2sql/contracts (shared Zod schemas & TypeScript types)
├── backend/                # Fastify 5 API, AST guardrails, semantic checks, executor
├── frontend/               # React + Vite accessible analyst interface
├── database/               # Analytics schema/seeds, app migrations, least-privilege SQL roles
├── infra/                  # Docker Compose (dev & staging), Dockerfiles, Nginx reverse proxy
├── scripts/                # Cross-platform setup, lint, and secret-scan CLI utilities
└── docs/                   # Planning pack, Sprint 1–8 records, benchmarks, and runbooks
```

---

## Quick Start

**Prerequisites:** Node.js `>= 22.0.0`, npm `>= 10.0.0`, Docker & Docker Compose.

```bash
# 1. Install locked dependencies
npm ci

# 2. Initialize .env from .env.example and build shared contracts
npm run setup

# 3. Start PostgreSQL 16 (loopback 127.0.0.1:5434)
npm run db:up

# 4. Load analytics fixture & apply app_db migrations (see docs/sprint-2/setup.md)
npm run migrate

# 5. Start backend (:3001) and frontend (:5173) dev servers
npm run dev
```

For full clean-checkout instructions (including PowerShell & Linux database seed commands), see [`docs/sprint-2/setup.md`](docs/sprint-2/setup.md). For staging deployment and operator runbooks, see [`docs/sprint-8/SETUP-GUIDE.md`](docs/sprint-8/SETUP-GUIDE.md).

---

## Workspace Scripts

| Script | Purpose |
| :--- | :--- |
| `npm run setup` | Copies `.env.example` to `.env` (if missing) and builds `@text2sql/contracts` |
| `npm run dev` | Starts backend and frontend dev servers concurrently |
| `npm run build` | Builds `@text2sql/contracts`, `@text2sql/backend`, and `@text2sql/frontend` |
| `npm run lint` | Runs `tsc --noEmit` and static code/security lint across all workspaces |
| `npm run typecheck` | Runs TypeScript type checking across all workspaces |
| `npm run test` | Runs all automated backend test suites (`node:test` via `tsx`) |
| `npm run secret-scan` | Checks `.env` git hygiene and scans tracked files for secret leaks |
| `npm run db:up` / `db:down` | Starts or stops local PostgreSQL containers (`infra/compose/compose.yaml`) |
| `npm run migrate` | Applies pending SQL migrations to `app_db` |

---

## Documentation

- **Local Onboarding:** [`docs/sprint-2/setup.md`](docs/sprint-2/setup.md)
- **Production / Staging Runbook:** [`docs/sprint-8/SETUP-GUIDE.md`](docs/sprint-8/SETUP-GUIDE.md)
- **Holdout Evaluation Report:** [`docs/sprint-8/EVALUATION-REPORT.md`](docs/sprint-8/EVALUATION-REPORT.md)
- **Synthetic Demo Script:** [`docs/sprint-8/DEMO-SCRIPT.md`](docs/sprint-8/DEMO-SCRIPT.md)
- **Limitations & ADRs:** [`docs/sprint-8/LIMITATIONS-AND-ADRS.md`](docs/sprint-8/LIMITATIONS-AND-ADRS.md)
- **Release Gate Checklist:** [`docs/sprint-8/RELEASE-CHECKLIST.md`](docs/sprint-8/RELEASE-CHECKLIST.md)

