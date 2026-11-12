# Local Developer Setup & Clean-Checkout Guide

This guide provides step-by-step instructions to set up, build, and run the **Text-to-SQL Interface** workspace from a clean repository checkout.

---

## 1. Prerequisites

Before starting, ensure you have the following installed on your host machine:

| Prerequisite | Required Version | Verification Command |
|---|---|---|
| **Node.js** | `>= 22.0.0` (LTS) | `node --version` |
| **npm** | `>= 10.0.0` | `npm --version` |
| **Docker** | `>= 24.0.0` | `docker --version` |
| **Docker Compose** | `>= 2.20.0` | `docker compose version` |

> **OS Support:** Windows (PowerShell / Command Prompt), macOS, and Linux.

---

## 2. Step-by-Step Setup from a Clean Clone

### Step 2.1: Clone the Repository
```bash
git clone <repo-url>
cd "Text-to-SQL Interface"
```

### Step 2.2: Install Locked Dependencies
Install exact dependency versions from `package-lock.json`:
```bash
npm ci
```

### Step 2.3: Run Workspace Setup (`.env` + Shared Contracts)
Run the cross-platform workspace setup script to create `.env` from `.env.example` (if not already present) and compile `@text2sql/contracts`:
```bash
npm run setup
```

> **Security Note:** `.env.example` contains placeholder values only and `.env` is ignored by git (`.gitignore`). Never commit `.env` or real API keys.

### Step 2.4: Start the Dual PostgreSQL Container (`127.0.0.1:5434`)
Start the PostgreSQL 16 container bound strictly to loopback port `5434`. On first boot, `infra/compose/init-scripts/` initializes `analytics_db`, `app_db`, and least-privilege roles (`analytics_user`, `app_user`, `db_migrator`):
```bash
npm run db:up
```

Verify the container is healthy:
```bash
docker compose -f infra/compose/compose.yaml ps
```

### Step 2.5: Seed the Synthetic Analytics Fixture (`analytics_db`)
Load the approved 4-table e-commerce schema (`customers`, `products`, `orders`, `order_items`) and deterministic test dataset into `analytics_db`:

**Linux / macOS (bash):**
```bash
docker exec -i text2sql_postgres psql -U postgres -d analytics_db < database/analytics/schema/01-schema.sql
docker exec -i text2sql_postgres psql -U postgres -d analytics_db < database/analytics/seeds/02-seed-small.sql
```

**Windows (PowerShell):**
```powershell
Get-Content database/analytics/schema/01-schema.sql | docker exec -i text2sql_postgres psql -U postgres -d analytics_db
Get-Content database/analytics/seeds/02-seed-small.sql | docker exec -i text2sql_postgres psql -U postgres -d analytics_db
```

*(Optional)* For 100,000-order performance benchmarks, also load `database/analytics/seeds/03-seed-performance.sql`.

### Step 2.6: Apply Application Metadata Migrations (`app_db`)
Run sequential SQL migrations (`database/app/migrations/01-*.sql` through `07-*.sql`) as `db_migrator`:
```bash
npm run migrate
```

### Step 2.7: Start Backend and Frontend Development Servers
Start both the Fastify API (`http://127.0.0.1:3001`) and Vite React UI (`http://localhost:5173`) concurrently:
```bash
npm run dev
```

Verify service health probes:
- Liveness: `GET http://127.0.0.1:3001/health` → HTTP `200`
- Readiness: `GET http://127.0.0.1:3001/ready` → HTTP `200` (`analytics_db` and `app_db` connected)

---

## 3. Quality Gates & Clean-Checkout Validation Procedure

Execute the full verification pipeline from the repository root:

```bash
npm run secret-scan
npm run lint
npm run typecheck
npm run build
npm run test
```

### Clean-Checkout Reset Procedure
To reproduce a clean database + build cycle from scratch:

```bash
npm run db:reset
# Wait until `docker compose -f infra/compose/compose.yaml ps` reports healthy
# Re-apply analytics schema/seed (Step 2.5), then:
npm ci
npm run setup
npm run migrate
npm run lint
npm run typecheck
npm run test
npm run build
```

When PostgreSQL is running on `127.0.0.1:5434` and seeded, **all** tests in `npm run test`—including live PostgreSQL privilege-denial checks (`privilege-containment.test.ts`) and identity integration tests (`auth-repository.test.ts`)—execute with 0 skipped cases. When PostgreSQL is stopped, database-dependent tests gracefully skip while all unit, contract, guardrail, semantic, and mock-server integration suites run.

---

## 4. Troubleshooting

| Symptom | Cause | Resolution |
| :--- | :--- | :--- |
| `Cannot find module '@text2sql/contracts'` | Contracts not compiled yet | Run `npm run setup` or `npm run build -w packages/contracts` |
| `ECONNREFUSED 127.0.0.1:5434` | Docker daemon or Postgres container stopped | Start Docker Desktop and run `npm run db:up` |
| `permission denied for table ...` as `app_user` | Roles initialized before `db_migrator` default privileges | Run `npm run db:reset` and re-apply Step 2.5 & Step 2.6 |
| `Invalid SESSION_SECRET` on boot | Secret shorter than 32 characters | Set a `>= 32`-char string in `.env` (or re-copy `.env.example`) |
