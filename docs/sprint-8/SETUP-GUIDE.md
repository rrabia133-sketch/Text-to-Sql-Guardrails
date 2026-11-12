# Sprint 8 — Production Setup, Deployment Runbook & Operator Guide

- **Document Version:** 1.0.0
- **Audience:** DevOps Engineers, Site Reliability Engineers (SREs), Database Administrators
- **Purpose:** Comprehensive deployment guide, configuration reference, and operational runbook for deploying and managing the Text-to-SQL Guardrails & Privilege Containment Interface (`US-18`, `DO-14`).

---

## 1. System Architecture & Topology

The production staging environment deploys a zero-trust, multi-tier containerized topology:

```mermaid
flowchart TD
    Client[Browser / Analyst Client] -->|HTTP :80| NginxProxy[Nginx Reverse Proxy :80]
    subgraph Staging Network [docker-compose.staging.yml]
        NginxProxy -->|/api/*| BackendContainer[Backend API Server :3000\nNode.js Non-Root USER node]
        NginxProxy -->|/*| FrontendContainer[Frontend UI :8080\nUnprivileged Nginx Static]
        
        subgraph Internal DB Network [internal-db-net - Isolated Bridge]
            BackendContainer -->|Port 5432\napp_user| AppDB[(app_db\nMetadata & Audits)]
            BackendContainer -->|Port 5432\nanalytics_user (Read-Only)| AnalyticsDB[(analytics_db\nE-Commerce Analytics)]
        end
    end
```

> [!IMPORTANT]
> **Network Isolation:** `analytics_db` and `app_db` are attached exclusively to `internal-db-net` with no host-exposed ports in production staging. Only the backend container has access to database ports.

---

## 2. Prerequisites & System Requirements

| Component | Minimum Requirement | Recommended Production |
| :--- | :--- | :--- |
| **Operating System** | Linux (Ubuntu 22.04 LTS / Debian 12) or macOS / Windows with WSL2 | Ubuntu 24.04 LTS / Rocky Linux 9 |
| **Container Engine** | Docker Engine 24.0+ & Docker Compose v2.20+ | Docker Engine 27.0+ |
| **Node.js Runtime** | Node.js v22.12.0 LTS or v24+ | Node.js v22 LTS |
| **Local LLM Engine** | Ollama v0.3.0+ with `qwen2.5-coder:7b` | Ollama with NVIDIA GPU (CUDA 12+) or Groq Cloud |
| **Host Memory** | 8 GB RAM (Cloud mode) / 16 GB RAM (Local Ollama mode) | 32 GB RAM + 16 GB VRAM GPU |

---

## 3. Environment Configuration Reference

Create `.env.staging` (or `.env.production`) based on the following reference matrix:

```env
# ==============================================================================
# Server Configuration
# ==============================================================================
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
LOG_LEVEL=info
CORS_ORIGIN=http://localhost

# ==============================================================================
# Provider Routing & Airgap Control
# Set to 'local' for zero-egress airgap compliance, or 'cloud' for Groq
# ==============================================================================
PROVIDER_MODE=local
OLLAMA_HOST=http://host.docker.internal:11434
OLLAMA_MODEL=qwen2.5-coder:7b
# GROQ_API_KEY=gsk_... (Required only when PROVIDER_MODE=cloud)
# GROQ_MODEL=llama-3.3-70b-versatile

# ==============================================================================
# Application Database (Metadata, Identities, Audits, Artifacts)
# ==============================================================================
APP_DB_HOST=app-db
APP_DB_PORT=5432
APP_DB_NAME=app_db
APP_DB_USER=app_user
APP_DB_PASSWORD=production_secure_app_password
APP_DB_POOL_MIN=2
APP_DB_POOL_MAX=20

# ==============================================================================
# Analytics Database (Read-Only Analytical E-Commerce Data)
# ==============================================================================
ANALYTICS_DB_HOST=analytics-db
ANALYTICS_DB_PORT=5432
ANALYTICS_DB_NAME=analytics_db
ANALYTICS_DB_USER=analytics_user
ANALYTICS_DB_PASSWORD=production_secure_analytics_password
ANALYTICS_DB_POOL_MIN=2
ANALYTICS_DB_POOL_MAX=30

# ==============================================================================
# Security & Encryption Credentials
# ==============================================================================
JWT_SECRET=super_secret_production_jwt_signing_key_min_32_bytes
BACKUP_ENCRYPTION_KEY=master_backup_passphrase_min_32_chars_long

# ==============================================================================
# Holdout Evaluation Airgap Gate (Must remain false in production)
# ==============================================================================
RUN_HOLDOUT_EVAL=false
```

---

## 4. Staging Deployment Execution

### Step 1: Clone Repository & Build Monorepo Contracts
```bash
git clone https://github.com/organization/text2sql-interface.git
cd text2sql-interface

# Install dependencies and compile TypeScript contracts
npm ci
npm run build
```

### Step 2: Build Multi-Stage Docker Images
```bash
# Build unprivileged backend image
docker build -f infra/docker/Dockerfile.backend -t text2sql-backend:latest .

# Build unprivileged Nginx frontend image
docker build -f infra/docker/Dockerfile.frontend -t text2sql-frontend:latest .
```

### Step 3: Launch Staging Topology
```bash
docker compose -f infra/compose/docker-compose.staging.yml --env-file .env.staging up -d
```

### Step 4: Apply Database Migrations
```bash
docker compose -f infra/compose/docker-compose.staging.yml exec backend npm run migrate
```

### Step 5: Verify Deployment Health
```bash
# Verify backend liveness
curl -f http://localhost/api/health/liveness

# Verify backend database readiness
curl -f http://localhost/api/health/readiness

# Inspect Prometheus metrics
curl -s http://localhost/api/v1/metrics | grep text2sql_
```

---

## 5. Operational Runbooks & Procedures

### Procedure A: Encrypted Metadata Backup
The system includes automated AES-256-GCM metadata backup using scrypt key derivation and SHA-256 integrity verification:

```bash
# Trigger an encrypted backup drill via backend service
docker compose -f infra/compose/docker-compose.staging.yml exec backend \
  npx tsx -e "
    import { BackupService } from './src/modules/backup/backup.service.js';
    import { appPool } from './src/database/app-pool.js';
    const backup = new BackupService(appPool);
    backup.createEncryptedBackup({
      outputDir: './backups',
      passphrase: process.env.BACKUP_ENCRYPTION_KEY
    }).then(meta => console.log('Backup Created:', meta));
  "
```

### Procedure B: Metadata Recovery Drill
```bash
# Restore metadata from encrypted archive
docker compose -f infra/compose/docker-compose.staging.yml exec backend \
  npx tsx -e "
    import { BackupService } from './src/modules/backup/backup.service.js';
    import { appPool } from './src/database/app-pool.js';
    const backup = new BackupService(appPool);
    backup.restoreEncryptedBackup({
      archivePath: './backups/backup-latest.tar.gz.enc',
      passphrase: process.env.BACKUP_ENCRYPTION_KEY
    }).then(res => console.log('Restore Verified:', res));
  "
```

### Procedure C: Zero-Downtime Migration Rollback
All database migrations in `database/app/migrations/` follow the expand/contract idempotency standard. If a deployment must be rolled back:

1. Roll back the backend container image to the previous release tag:
   ```bash
   docker service update --image text2sql-backend:previous-tag text2sql-stack_backend
   ```
2. The schema remains backwards-compatible due to non-destructive column additions.
3. For emergency schema downgrade:
   ```bash
   # Run isolated migration rollback drill
   npm run test -- backend/test/integration/migration-rollback.test.ts
   ```

### Procedure D: Emergency Provider Failover / Airgap Enforcement
If cloud egress must be immediately cut off due to security policy or incident:

1. Update `.env.staging`:
   ```env
   PROVIDER_MODE=local
   ```
2. Reload backend configuration without downtime:
   ```bash
   docker compose -f infra/compose/docker-compose.staging.yml exec backend kill -HUP 1
   ```
3. Verify that zero external packets leave the network:
   ```bash
   npm run test -- backend/test/security/egress-lockdown.test.ts
   ```

---

## 6. Observability, Alerting & Metrics Reference

The system exposes Prometheus-compatible metrics at `GET /api/v1/metrics`:

| Metric Name | Type | Description | Alerting Threshold |
| :--- | :---: | :--- | :--- |
| `text2sql_requests_total` | Counter | Total requests partitioned by method, route, and status | Status 5xx rate over 1% |
| `text2sql_request_duration_seconds` | Histogram | Request latency distributions (p50, p90, p99) | p95 over 3.0s |
| `text2sql_active_requests` | Gauge | Currently executing in-flight requests | Value over 50 concurrent |
| `text2sql_guardrail_rejections_total`| Counter | Intercepted malicious or unparsed SQL attempts | Surge over 10 / min |
| `text2sql_confidence_scores` | Histogram | Distribution of computed confidence scores | P50 score drop under 70 |
| `text2sql_db_connection_pool_active` | Gauge | Active connections in appPool and analyticsPool | Pool saturation over 85% |

