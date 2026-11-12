# Sprint 2 — Application Foundation

- **Duration:** 2 Weeks (Baseline)
- **Status:** 🟢 **COMPLETED** (100%)
- **Sprint Goal:** Establish the core application foundation: reproducible workspace with Fastify backend and React frontend, shared TypeScript contracts, dual database architecture (`analytics_db` + `app_db`), user identity and session ownership, distinct database roles with privilege containment, health routes, baseline CI, and clean-checkout local setup documentation.
- **Reference Guides:**
  - Sprint Plan: [07-sprint-plan.md](../planning/07-sprint-plan.md#sprint-2--application-foundation)
  - User Stories: [06-user-stories.md](../planning/06-user-stories.md#us-02--foundation)
  - Architecture: [05-architecture.md](../planning/05-architecture.md)
  - Project Structure: [09-project-structure.md](../planning/09-project-structure.md)
  - DevOps Plan: [08-devops-plan.md](../planning/08-devops-plan.md)

---

## Sprint Backlog & Status

| Work Item | Type | Title | SP | Status | Progress |
| :--- | :--- | :--- | :---: | :---: | :--- |
| [US-02–04](US-02-04.md) | Story | Application Foundation (US-02, US-03, US-04) | 15 | 🟢 **COMPLETED** | 16 / 16 Tasks (100%) |
| [DO-02–04](DO-02-04.md) | DevOps | Workspace, DB Roles & CI Pipeline (DO-02–04) | — | 🟢 **COMPLETED** | 9 / 9 Tasks (100%) |

---

## Sprint 2 Task Board

| Task # | Name | Assigned To | Status | Output Artifact |
| :---: | :--- | :--- | :--- | :--- |
| **01** | Scaffold monorepo workspace & package configuration | [US-02–04](US-02-04.md#task-1-monorepo-workspace-configuration--package-layout) | 🟢 **COMPLETED** | `package.json`, `packages/`, `backend/`, `frontend/` |
| **02** | Configure Fastify backend skeleton & lifecycle | [US-02–04](US-02-04.md#task-2-scaffold-fastify-backend-application-skeleton) | 🟢 **COMPLETED** | `backend/src/app.ts`, `backend/src/server.ts`, `backend/src/config/env.ts` |
| **03** | Configure React + Vite frontend skeleton | [US-02–04](US-02-04.md#task-3-scaffold-react--vite-frontend-application-skeleton) | 🟢 **COMPLETED** | `frontend/src/App.tsx`, `frontend/vite.config.ts`, `frontend/src/index.css` |
| **04** | Define shared TypeScript contracts package | [US-02–04](US-02-04.md#task-4-define-shared-typescript-contracts-package) | 🟢 **COMPLETED** | `packages/contracts/src/index.ts` |
| **05** | Implement service health & readiness endpoints | [US-02–04](US-02-04.md#task-5-implement-service-health--readiness-endpoints) | 🟢 **COMPLETED** | `backend/src/modules/health/` (`/health`, `/ready`) |
| **06** | Configure Docker Compose dual-database topology | [US-02–04](US-02-04.md#task-6-docker-compose-multi-database-topology-analytics_db--app_db) | 🟢 **COMPLETED** | `infra/compose/compose.yaml` (port 5434) |
| **07** | Seed synthetic analytics fixture with edge cases | [US-02–04](US-02-04.md#task-7-reproduce-synthetic-analytics-fixture--seed-edge-cases) | 🟢 **COMPLETED** | `database/analytics/schema/`, `database/analytics/seeds/` |
| **08** | Implement application metadata database & migrations | [US-02–04](US-02-04.md#task-8-application-metadata-database-schema--migrations) | 🟢 **COMPLETED** | `database/app/migrations/`, `backend/src/database/migrate.ts` |
| **09** | Establish distinct database roles & kernel privileges | [US-02–04](US-02-04.md#task-9-establish-distinct-database-roles--kernel-permissions) | 🟢 **COMPLETED** | `database/roles/01-roles.sql`, `infra/compose/init-scripts/02-init-roles.sql` |
| **10** | Build database privilege denial test suite | [US-02–04](US-02-04.md#task-10-automated-database-privilege-denial--security-tests) | 🟢 **COMPLETED** | `backend/test/security/privilege-containment.test.ts` |
| **11** | Implement user identity & session ownership backend | [US-02–04](US-02-04.md#task-11-identity--session-domain-data-model--repository) | 🟢 **COMPLETED** | `backend/src/modules/auth/auth.repository.ts` |
| **12** | Fastify authentication & session plugin | [US-02–04](US-02-04.md#task-12-fastify-authentication--session-plugin) | 🟢 **COMPLETED** | `backend/src/plugins/auth.ts`, `backend/src/modules/auth/auth.routes.ts` |
| **13** | Ownership verification middleware & IDOR guards | [US-02–04](US-02-04.md#task-13-ownership-verification-middleware--idor-guards) | 🟢 **COMPLETED** | `backend/src/modules/auth/ownership.guard.ts` |
| **14** | Build authenticated frontend shell & user switcher | [US-02–04](US-02-04.md#task-14-frontend-authentication-shell--session-switcher) | 🟢 **COMPLETED** | `frontend/src/features/auth/`, `Header.tsx` |
| **15** | Build automated unauthorized & cross-user security tests | [US-02–04](US-02-04.md#task-15-automated-security--cross-user-penetration-tests) | 🟢 **COMPLETED** | `backend/test/security/cross-user-isolation.test.ts` |
| **16** | Local setup documentation & clean-checkout verification | [US-02–04](US-02-04.md#task-16-local-setup-documentation--clean-checkout-verification) | 🟢 **COMPLETED** | `docs/sprint-2/setup.md`, `README.md`, `.env.example`, `.github/workflows/ci.yml` |

---

## Sprint Exit Gate Checklist

Before advancing to Sprint 3 (Grounded generation and provider policy), all of the following exit criteria must pass:

- [x] Clean-checkout setup documented and automated (`npm run setup`, `npm run dev`) following [`docs/sprint-2/setup.md`](setup.md).
- [x] Fastify API and React web client build, share contracts (`@text2sql/contracts`), and expose health probes (`/health`, `/ready`).
- [x] Dual database fixture defined cleanly (`analytics_db` and `app_db`) on isolated loopback port `5434` (`infra/compose/compose.yaml`).
- [x] Distinct database roles enforced: `analytics_user` has strictly read-only SELECT permissions and cannot write; `app_user` can manage session/metadata without DDL.
- [x] Authentication and session ownership work: unauthenticated requests fail (`401`); Analyst A cannot access or manipulate Analyst B's query/workspace artifacts (`403`/`404`).
- [x] Cross-user access and privilege-denial tests implemented in the automated test suite (`cross-user-isolation.test.ts`, `privilege-containment.test.ts`).
- [x] Baseline CI workflow (`.github/workflows/ci.yml`) executes lint, typecheck, tests, build, and secret scan (`.gitleaks.toml`, `scripts/secret-scan.mjs`).
- [x] Zero secrets committed; `.env.example` values are placeholders and `.env` is ignored in git.
- [x] Local setup guide documented in [`docs/sprint-2/setup.md`](setup.md) and [`README.md`](../../README.md).
