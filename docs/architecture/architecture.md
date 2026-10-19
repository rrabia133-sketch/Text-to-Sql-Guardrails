# Text-to-SQL Platform — Comprehensive System Architecture

- **Document Version:** 1.0.0
- **Status:** APPROVED & ACTIVE
- **Target Audience:** Systems Architects, Core Developers, Security Engineers, DevOps
- **Date:** 2026-10-16
- **Traceability:**
  - Sprint Plans: [Sprint 1](../sprint-1/README.md), [Sprint 2](../sprint-2/US-02-04.md)
  - Architecture Guide: [05-architecture.md](../planning/05-architecture.md)
  - ADRs: [ADR 01 (Core Stack)](../sprint-1/decisions/01-core-stack.md), [ADR 02 (AST Parser)](../sprint-1/decisions/02-ast-parser.md), [ADR 03 (Database Isolation)](../sprint-1/decisions/03-database-isolation.md), [ADR 04 (LLM Strategy)](../sprint-1/decisions/04-llm-provider-strategy.md)

---

## 1. Executive Summary & Architectural Vision

The **Text-to-SQL Interface** is a secure, enterprise-grade AI query assistant that translates natural language questions into safe, optimized PostgreSQL analytical queries. 

Unlike naive Text-to-SQL wrappers that pipe unvetted LLM output directly into database execution engines, this platform enforces a **zero-trust, multi-layered defense-in-depth architecture**:
1. **Zero Browser Privilege:** The client browser holds zero database credentials and zero LLM provider API keys.
2. **Deterministic AST Guardrails:** Every generated SQL string is parsed into an Abstract Syntax Tree (AST) using `pgsql-ast-parser` and evaluated against recursive deny-rules before execution is ever scheduled.
3. **Kernel-Level Database Isolation:** Analytical queries run exclusively as `analytics_user` with `default_transaction_read_only = on` and a kernel `statement_timeout = '5s'`. Application state (users, sessions, query artifacts) resides in an isolated logical database (`app_db`) managed by a distinct role (`app_user`).
4. **Hard Data Privacy Boundaries:** Zero database rows are transmitted to LLM providers. Prompts contain strictly allowlisted metadata, schema types, and approved glossary definitions.
5. **Two-Phase Artifact Workflow:** Query generation and query execution are decoupled. Generating a query creates an immutable, owned query artifact with transparent evidence scoring. Executing a query requires an explicit user command referencing the artifact ID, never raw client-supplied SQL.

---

## 2. High-Level Architecture (C4 Level 1 & Level 2)

### 2.1 System Context Diagram (C4 Level 1)

The system context illustrates the human actors, internal platform boundaries, and external integration points.

```mermaid
flowchart TD
    subgraph Users ["Human Actors"]
        Analyst["Data Analyst / Business User<br/>(Natural Language Queries)"]
        Admin["System Administrator<br/>(Audit, Roles & Policies)"]
    end

    subgraph Platform ["Text-to-SQL Secure Platform"]
        UI["React Web Application<br/>(Vite, TypeScript, Tailwind)"]
        API["Fastify Modular Monolith Gateway<br/>(Node.js 22 LTS, Strict Contracts)"]
    end

    subgraph DatabaseCluster ["PostgreSQL 16 Cluster (Port 5434)"]
        AppDB[("Application Database (app_db)<br/>Users, Sessions, Audit, Artifacts")]
        AnalyticsDB[("Analytics Warehouse (analytics_db)<br/>Synthetic Fixture, Read-Only")]
    end

    subgraph LLMProviders ["Inference Engines"]
        OllamaEngine["Local Ollama Service<br/>(qwen2.5-coder:7b, 100% Offline)"]
        GroqEngine["Cloud Groq API<br/>(llama-3.1-8b-instant, Low-Latency)"]
    end

    Analyst -->|"HTTPS / Secure Cookies"| UI
    Admin -->|"HTTPS / Role Guards"| UI
    UI -->|"JSON DTOs / SameSite Lax Cookies"| API
    API -->|"CRUD / Metadata Connection Pool"| AppDB
    API -->|"Read-Only / 5s Timeout Pool"| AnalyticsDB
    API -->|"Local HTTP REST (Port 11434)"| OllamaEngine
    API -->|"TLS Egress (Restricted Budget)"| GroqEngine
```

---

### 2.2 Container Architecture Diagram (C4 Level 2)

The platform is organized as a clean npm-workspace monorepo separating client presentation, shared typed contracts, and backend micro-modules.

```mermaid
flowchart TB
    subgraph ClientContainer ["Frontend Container (apps/web or frontend/)"]
        direction TB
        ReactApp["React 18 + Vite SPA"]
        AuthContext["Auth State & Switcher Context"]
        QueryConsole["Query Console & Results Grid"]
        ConfidenceBadge["Confidence & Evidence Visualizer"]
        
        ReactApp --> AuthContext
        ReactApp --> QueryConsole
        ReactApp --> ConfidenceBadge
    end

    subgraph ContractPackage ["Shared Package (packages/contracts)"]
        Contracts["TypeScript Interfaces & Schemas<br/>(Health, Auth, Query DTOs, Guardrails)"]
    end

    subgraph BackendContainer ["Backend Gateway (backend/)"]
        direction TB
        FastifyServer["Fastify Core HTTP Server (Port 3001)"]
        
        subgraph Middlewares ["Security Plugins & Middlewares"]
            CorsPlugin["@fastify/cors (Origin Whitelist)"]
            CookiePlugin["@fastify/cookie (Signed Session Cookies)"]
            AuthPlugin["Auth Plugin (Session Resolution & requireAuth)"]
            OwnershipGuard["IDOR & Ownership Guard (Resource Owner Check)"]
        end

        subgraph CoreModules ["Core Domain Modules"]
            AuthMod["Auth Module<br/>(Login, Logout, /me, Switcher)"]
            HealthMod["Health & Readiness Module<br/>(Liveness & DB Connectivity)"]
            OrchestratorMod["Query Orchestrator<br/>(Intent Resolution & Prompting)"]
            ASTGuardrailMod["AST Policy & Guardrails<br/>(pgsql-ast-parser Engine)"]
            SemanticVerifMod["Semantic Verifier & Scorer<br/>(Confidence Calculator)"]
            ExecutionMod["Execution Service<br/>(Cursor Chunking & Revalidation)"]
        end

        FastifyServer --> Middlewares
        Middlewares --> CoreModules
    end

    subgraph DataStorage ["Database Storage (infra/compose)"]
        direction TB
        subgraph AppDBIsolation ["app_db (App User Role)"]
            UsersTable[("users")]
            SessionsTable[("sessions")]
            ArtifactsTable[("query_artifacts")]
            AuditTable[("query_audit_logs")]
        end

        subgraph AnalyticsDBIsolation ["analytics_db (Analytics User Role)"]
            CustomersTable[("customers")]
            ProductsTable[("products")]
            OrdersTable[("orders")]
            OrderItemsTable[("order_items")]
        end
    end

    ClientContainer -->|"Imports Types"| ContractPackage
    BackendContainer -->|"Imports Types"| ContractPackage
    ClientContainer -->|"REST / JSON"| FastifyServer
    AuthMod -->|"Metadata Pool"| AppDBIsolation
    ExecutionMod -->|"Restricted Read-Only Pool"| AnalyticsDBIsolation
```

---

## 3. Low-Level Architecture (C4 Level 3 — Component Breakdown)

### 3.1 Authentication, Identity & Session Subsystem

Authentication is built around server-side state in `app_db` paired with cryptographic cookie signing:
- **Cookie Security:** Cookies are stamped with `HttpOnly`, `SameSite=Lax`, `Path=/`, and signed using Fastify's secret (`SESSION_SECRET`).
- **Session Lifecycles:** Sessions persist with an `expires_at` timestamp. Expired sessions are rejected automatically during database resolution (`expires_at > CURRENT_TIMESTAMP`).
- **Identity Resolution:** On incoming requests, `authPlugin` unsigns the cookie, fetches `SessionWithUser` via `AuthRepository.findSessionById`, and decorates `request.user` and `request.sessionId`.
- **PreHandler Guard:** `requireAuth` immediately terminates unauthenticated calls with HTTP 401.

```mermaid
sequenceDiagram
    autonumber
    actor Analyst as Analyst (Browser)
    participant Fastify as Fastify Server
    participant Plugin as authPlugin (Hook)
    participant Repo as AuthRepository
    participant DB as app_db (PostgreSQL)

    Analyst->>Fastify: POST /api/auth/login { username: "analyst_a" }
    Fastify->>Repo: findUserByUsername("analyst_a")
    Repo->>DB: SELECT * FROM users WHERE username = $1
    DB-->>Repo: User record (id: "usr_analyst_a")
    Fastify->>Repo: createSession({ id: UUID, userId, expiresAt })
    Repo->>DB: INSERT INTO sessions VALUES ($1, $2, $3)
    DB-->>Repo: Session record
    Fastify-->>Analyst: HTTP 200 + Set-Cookie: session_id=<signed_token>; HttpOnly; SameSite=Lax

    Note over Analyst, Fastify: Subsequent Authenticated Request
    Analyst->>Fastify: GET /api/auth/me (Cookie: session_id=<signed_token>)
    Fastify->>Plugin: preHandler Hook
    Plugin->>Plugin: unsignCookie(rawCookie)
    Plugin->>Repo: findSessionById(sessionId)
    Repo->>DB: SELECT s.*, u.* FROM sessions s JOIN users u ... WHERE s.expires_at > NOW()
    DB-->>Repo: Valid Session + User
    Plugin->>Fastify: request.user = User, request.sessionId = SessionId
    Fastify-->>Analyst: HTTP 200 { user: { id, username, role, displayName } }
```

---

### 3.2 Dual-Database Isolation & Role Containment Architecture

Security is guaranteed at the PostgreSQL kernel level via distinct logical databases, users, and connection configurations:

```mermaid
graph TB
    subgraph PostgreSQLCluster ["PostgreSQL 16 Instance (127.0.0.1:5434)"]
        direction TB

        subgraph Roles ["Database Roles"]
            AppUserRole["app_user<br/>(Password: app_password)<br/>NOSUPERUSER, NOCREATEDB"]
            AnalyticsUserRole["analytics_user<br/>(Password: analytics_password)<br/>default_transaction_read_only = on<br/>statement_timeout = '5s'"]
            MigratorRole["db_migrator<br/>(Password: migrator_password)<br/>Schema Management Only"]
        end

        subgraph LogicalDatabases ["Logical Databases"]
            subgraph AppDB ["app_db"]
                AppSchema["Schema: public<br/>(CREATE REVOKED from app_user)"]
                AppTables["Tables: users, sessions, query_artifacts, audit_logs"]
            end

            subgraph AnalyticsDB ["analytics_db"]
                AnalyticsSchema["Schema: public<br/>(CREATE REVOKED from analytics_user)"]
                AnalyticsTables["Tables: customers, products, orders, order_items"]
            end
        end

        AppUserRole -->|"CONNECT & CRUD Allowed"| AppDB
        AppUserRole -.->|"CONNECT REVOKED (Access Denied)"| AnalyticsDB
        AnalyticsUserRole -->|"CONNECT & SELECT ONLY"| AnalyticsDB
        AnalyticsUserRole -.->|"CONNECT REVOKED (Access Denied)"| AppDB
        MigratorRole -->|"DDL Migrations Only"| AppDB
        MigratorRole -->|"DDL Migrations Only"| AnalyticsDB
    end

    subgraph BackendServices ["Backend Connection Pools"]
        MetadataPool["Metadata Pool (max: 5)<br/>Connects as: app_user"]
        ExecutionPool["Execution Pool (max: 10)<br/>Connects as: analytics_user"]
    end

    MetadataPool ==> AppUserRole
    ExecutionPool ==> AnalyticsUserRole
```

#### Database Least-Privilege Matrix

| Operation | `app_user` on `app_db` | `app_user` on `analytics_db` | `analytics_user` on `analytics_db` | `analytics_user` on `app_db` |
| :--- | :---: | :---: | :---: | :---: |
| **CONNECT** | ✅ Granted | ❌ **DENIED** | ✅ Granted | ❌ **DENIED** |
| **SELECT** | ✅ Application metadata | ❌ Denied | ✅ Whitelisted analytics | ❌ Denied |
| **INSERT / UPDATE / DELETE** | ✅ Application metadata | ❌ Denied | ❌ **DENIED (Kernel 25006)** | ❌ Denied |
| **CREATE / DROP TABLE (DDL)**| ❌ **DENIED (SQLSTATE 42501)**| ❌ Denied | ❌ **DENIED (SQLSTATE 25006)** | ❌ Denied |
| **Query Timeout** | Standard | N/A | ⏱️ **Hard 5.00s (SQLSTATE 57014)** | N/A |

---

### 3.3 AST Guardrail & Safety Pipeline Architecture

The guardrail pipeline intercepts all raw SQL emitted by LLM adapters. It evaluates the query deterministically against safety rules:

```mermaid
flowchart TD
    RawSQL["Raw SQL String from LLM"] --> Step1["Step 1: AST Parser (pgsql-ast-parser)"]
    
    Step1 -->|"Parse Syntax Error"| RejectSyntax["REJECT: Invalid SQL Syntax (GUARD_PARSE_FAIL)"]
    Step1 -->|"Valid AST Tree"| Step2{"Step 2: Single Statement Check"}
    
    Step2 -->|"Multiple / Stacked Statements"| RejectStacked["REJECT: Multi-statement Injection (GUARD_MULTI_STMT)"]
    Step2 -->|"Exactly 1 Statement"| Step3{"Step 3: Root Statement Type"}
    
    Step3 -->|"NOT a SELECT statement"| RejectDML["REJECT: Non-SELECT DDL/DML (GUARD_FORBIDDEN_COMMAND)"]
    Step3 -->|"SELECT Statement"| Step4{"Step 4: Recursive Node Inspector"}
    
    subgraph RecursiveInspection ["Recursive AST Traversal"]
        direction TB
        CheckTables["Check Table Sources: Must be in {customers, products, orders, order_items}"]
        CheckCatalogs["Reject System Tables: pg_catalog.*, information_schema.*"]
        CheckFunctions["Check Function Calls: Only approved aggregates & math/date functions"]
        CheckBlacklist["Reject Malicious Functions: pg_sleep, pg_read_file, current_user"]
        CheckLocking["Reject Row Locking: FOR UPDATE, FOR SHARE, NOWAIT, SKIP LOCKED"]
    end

    Step4 --> RecursiveInspection
    RecursiveInspection -->|"Any Policy Violation Found"| RejectPolicy["REJECT: Security Policy Violation (GUARD_POLICY_FAIL)"]
    RecursiveInspection -->|"All Nodes Approved"| Step5["Step 5: Enforced Bounds Normalization"]

    Step5 --> InjectLimit["Inject LIMIT <= 100 (Default to 50 if missing)"]
    InjectLimit --> Step6["Step 6: Re-parse & Validate Transformed AST"]
    Step6 -->|"AST Mutated Safely"| ApprovedSQL["Approved Normalized SQL + Typed Parameters"]
```

#### Whitelist Specifications:
- **Allowlisted Relations:** `customers`, `products`, `orders`, `order_items`.
- **Allowlisted Aggregate Functions:** `COUNT()`, `SUM()`, `AVG()`, `MIN()`, `MAX()`.
- **Allowlisted Scalar Functions:** `DATE_TRUNC()`, `EXTRACT()`, `COALESCE()`, `ROUND()`, `LOWER()`, `UPPER()`.
- **Blacklisted Patterns:** `pg_sleep()`, `pg_read_file()`, `version()`, `SELECT INTO`, `COPY`, `UNION` with unapproved branches, subqueries containing DML.

---

### 3.4 Semantic Verification & Transparent Confidence Engine

Rather than relying on model self-confidence (which is notoriously uncalibrated), the platform evaluates query fidelity through a 4-vector deterministic scoring formula:

```mermaid
graph LR
    subgraph NaturalLanguage ["Input Analysis"]
        Prompt["Natural Language Question"] --> IntentResolver["Intent Resolver"]
        IntentResolver --> Slots["Intent Slots<br/>(Metrics, Dimensions, Filters, Date Range)"]
    end

    subgraph GeneratedAST ["AST Inspection"]
        NormalizedSQL["Normalized SQL"] --> ASTInspector["AST Structure Extractor"]
        ASTInspector --> SchemaEvidence["Referenced Objects, Joins, Aggregations"]
    end

    subgraph VerificationEngine ["Verification & Scoring Engine"]
        Slots --> IntentCheck["1. Intent-Slot Agreement (Weight: 35%)"]
        SchemaEvidence --> IntentCheck
        
        SchemaEvidence --> GlossaryCheck["2. Glossary & Join Consistency (Weight: 30%)"]
        
        NormalizedSQL --> VerifierCheck["3. Semantic Verifier Agreement (Weight: 20%)"]
        
        NormalizedSQL --> StabilityCheck["4. Candidate Stability Scan (Weight: 15%)"]

        IntentCheck --> Aggregator["Weighted Confidence Calculator"]
        GlossaryCheck --> Aggregator
        VerifierCheck --> Aggregator
        StabilityCheck --> Aggregator
    end

    subgraph DecisionTiers ["Execution Eligibility"]
        Aggregator --> ScoreValue["Calculated Score: 0 - 100"]
        ScoreValue --> HighTier["Score >= 85: HIGH<br/>(Eligible for Direct Execution)"]
        ScoreValue --> ReviewTier["Score 65 - 84: REVIEW<br/>(Requires User Confirmation)"]
        ScoreValue --> AbstainTier["Score < 65: ABSTAIN<br/>(Execution Blocked / Clarification)"]
    end
```

---

### 3.5 Two-Phase Query Lifecycle & Execution Flow

Execution is decoupled from generation to prevent unauthorized or automatic query firing.

```mermaid
sequenceDiagram
    autonumber
    actor User as Data Analyst
    participant Web as React Web App
    participant Orch as Query Orchestrator
    participant LLM as LLM Engine (Ollama / Groq)
    participant Guard as AST Guardrail Service
    participant Scorer as Confidence Scorer
    participant AppDB as app_db (Metadata)
    participant Exec as Execution Service
    participant AnalyticsDB as analytics_db (Warehouse)

    %% PHASE 1: GENERATION
    Note over User, AppDB: PHASE 1: Query Generation & Artifact Creation
    User->>Web: Submit natural language prompt
    Web->>Orch: POST /api/v1/queries { prompt } (with signed session cookie)
    Orch->>Orch: Resolve date context & timezone
    Orch->>LLM: Generate SQL (Prompt + Schema + Glossary)
    LLM-->>Orch: Raw SQL response
    Orch->>Guard: Validate AST & enforce LIMIT bounds
    Guard-->>Orch: Normalized SQL + Clean AST
    Orch->>Scorer: Evaluate 4-vector confidence
    Scorer-->>Orch: Heuristic Score (e.g. 92 - HIGH)
    Orch->>AppDB: Persist immutable query_artifact (id, sql, hash, score, owner_id)
    Orch-->>Web: Return QueryArtifact DTO (preview SQL, score, artifactId)
    Web-->>User: Display SQL preview, explanation & Confidence Badge

    %% PHASE 2: EXECUTION
    Note over User, AnalyticsDB: PHASE 2: Explicit Authorized Execution
    User->>Web: Click "Run Query"
    Web->>Exec: POST /api/v1/queries/:artifactId/execute { idempotencyKey }
    Exec->>AppDB: Fetch artifact & verify owner (request.user.id == artifact.owner_id)
    Exec->>Guard: Revalidate stored SQL against current schema version
    Exec->>AnalyticsDB: BEGIN READ ONLY (statement_timeout = '5s')
    Exec->>AnalyticsDB: Open bounded cursor & fetch results
    AnalyticsDB-->>Exec: Row chunks (capped to 100 rows / 1MB)
    Exec->>AnalyticsDB: COMMIT / RELEASE connection
    Exec->>AppDB: Record execution audit log
    Exec-->>Web: Return ExecutionResult DTO (columns, rows, executionTimeMs)
    Web-->>User: Render Interactive Data Table & Export Options
```

---

## 4. Domain Data Model (Entity Relationship Diagram)

### 4.1 Application Database (`app_db`) Schema

```mermaid
erDiagram
    users ||--o{ sessions : "owns"
    users ||--o{ query_artifacts : "generates"
    users ||--o{ query_audit_logs : "triggers"
    query_artifacts ||--o{ query_executions : "executes"

    users {
        varchar id PK "usr_..."
        varchar email "Unique user email"
        varchar username "Unique login username"
        varchar display_name "Display name"
        varchar role "'analyst' or 'admin'"
        timestamptz created_at "Account creation timestamp"
    }

    sessions {
        varchar id PK "sess_..."
        varchar user_id FK "References users(id)"
        timestamptz expires_at "Session expiration"
        timestamptz created_at "Login timestamp"
    }

    query_artifacts {
        varchar id PK "art_..."
        varchar owner_id FK "References users(id)"
        text prompt "Natural language question"
        text normalized_sql "Validated SQL statement"
        varchar sql_hash "SHA-256 hash of normalized SQL"
        varchar status "'draft', 'ready', 'rejected', 'executed'"
        integer confidence_score "0 to 100"
        jsonb validation_findings "Detailed guardrail checks"
        timestamptz expires_at "Artifact expiry (15m window)"
        timestamptz created_at "Creation timestamp"
    }

    query_executions {
        varchar id PK "exec_..."
        varchar artifact_id FK "References query_artifacts(id)"
        varchar executor_id FK "References users(id)"
        varchar idempotency_key "Unique client submission key"
        varchar state "'succeeded', 'failed', 'timed_out'"
        integer row_count "Rows returned"
        integer duration_ms "Server execution time in ms"
        timestamptz executed_at "Timestamp of execution"
    }

    query_audit_logs {
        varchar id PK "aud_..."
        varchar user_id FK "References users(id)"
        varchar action "'login', 'generate_query', 'execute_query', 'logout'"
        varchar resource_id "Referenced entity ID"
        varchar status_code "HTTP or SQL state"
        jsonb details "Redacted event context"
        timestamptz created_at "Timestamp"
    }
```

---

### 4.2 Analytics Warehouse (`analytics_db`) Synthetic Schema

```mermaid
erDiagram
    customers ||--o{ orders : "places"
    orders ||--o{ order_items : "contains"
    products ||--o{ order_items : "referenced_in"

    customers {
        varchar id PK "cust_..."
        varchar name "Customer full name"
        varchar email "Customer email address"
        varchar region "North, South, East, West"
        varchar phone "Nullable telephone"
        timestamptz created_at "Registration date"
    }

    products {
        varchar id PK "prod_..."
        varchar name "Product title"
        varchar category "Hardware, Software, Service"
        numeric unit_price "Unit price in standard currency"
        boolean is_active "Active catalog flag"
    }

    orders {
        varchar id PK "ord_..."
        varchar customer_id FK "References customers(id)"
        varchar status "'completed', 'pending', 'canceled'"
        numeric total_amount "Order total sum"
        timestamptz order_date "Placement date"
    }

    order_items {
        varchar id PK "item_..."
        varchar order_id FK "References orders(id)"
        varchar product_id FK "References products(id)"
        integer quantity "Units purchased"
        numeric unit_price "Price at sale time"
    }
```

---

## 5. Security & Threat Mitigation Architecture

The system architecture addresses all primary attack vectors identified in the Sprint 1 Threat Model:

| Threat Vector | Potential Impact | Architectural Countermeasure |
| :--- | :--- | :--- |
| **SQL Injection via LLM** | Data destruction (`DROP TABLE`, `DELETE`, `TRUNCATE`) | **Multi-tier:** AST parser rejects non-SELECT ASTs; DB `analytics_user` has `default_transaction_read_only = on` and cannot execute writes (SQLSTATE 25006). |
| **Denial of Service (DoS)** | Database CPU lockup via `pg_sleep()` or Cartesian joins | **1.** AST parser bans `pg_sleep()`.<br/>**2.** Kernel enforces `statement_timeout = '5s'` (SQLSTATE 57014).<br/>**3.** Mandatory `LIMIT <= 100` injection. |
| **System Catalog Snooping** | Schema metadata exfiltration via `pg_catalog.*` | AST parser rejects all `pg_catalog`, `information_schema`, and `pg_toast` table identifiers. |
| **Cross-User Data Leaks (IDOR)** | Analyst A viewing or running Analyst B's queries | `ownership.guard.ts` verifies `request.user.id === artifact.owner_id`. Unauthorized requests fail closed with HTTP 404/403. |
| **Sensitive Data Egress** | Proprietary database records leaked to third-party LLM | **Zero data transmission:** Prompts contain strictly schema DDL structure, column types, and glossary metrics. Data records are never sent. |
| **Session Hijacking** | Impersonation of logged-in analysts | Fastify session cookies are cryptographically signed, `HttpOnly`, `SameSite=Lax`, and invalidated server-side upon logout. |

---

## 6. Infrastructure & Deployment Topology

### 6.1 Local Development Topology

```mermaid
graph TB
    subgraph HostSystem ["Developer Workstation (Windows / Linux / macOS)"]
        direction TB

        subgraph DevProcesses ["Node.js 22 Runtime"]
            ViteDev["Vite Dev Server (Port 5173)<br/>React Frontend SPA"]
            FastifyDev["Fastify API Server (Port 3001)<br/>TypeScript Monolith"]
        end

        subgraph LocalDocker ["Docker Engine (infra/compose/compose.yaml)"]
            PostgresContainer["Container: text2sql_postgres<br/>PostgreSQL 16 Alpine<br/>Port: 127.0.0.1:5434"]
        end

        subgraph LocalAI ["Local Inference Service"]
            OllamaDaemon["Ollama Daemon (Port 11434)<br/>Model: qwen2.5-coder:7b"]
        end

        ViteDev -->|"Proxies API requests"| FastifyDev
        FastifyDev -->|"JDBC/Postgres Pool (:5434)"| PostgresContainer
        FastifyDev -->|"REST API (:11434)"| OllamaDaemon
    end
```

### 6.2 Production Staging Topology

```mermaid
graph TB
    subgraph PublicInternet ["Public Internet"]
        ClientBrowser["Client Web Browser"]
    end

    subgraph IngressLayer ["Ingress & Edge Security"]
        ReverseProxy["Reverse Proxy / Cloudflare Edge<br/>TLS Termination & Rate Limiting"]
    end

    subgraph IsolatedVPC ["Private Secure VPC"]
        direction TB

        subgraph AppTier ["Application Cluster"]
            StaticHosting["Static Web Storage (CDN)<br/>Production React Bundles"]
            APICluster["Containerized Fastify Service<br/>Horizontal Pod Autoscaling"]
        end

        subgraph StorageTier ["Database Tier"]
            AppDatabase["PostgreSQL (app_db)<br/>Primary Writer"]
            AnalyticsReplica["PostgreSQL (analytics_db)<br/>Isolated Read Replica"]
        end

        subgraph InferenceTier ["AI Inference Cluster"]
            PrivateOllama["Private GPU Worker (Ollama)<br/>VPC-Internal Network Only"]
        end
    end

    ClientBrowser -->|"HTTPS (443)"| ReverseProxy
    ReverseProxy -->|"Serve Static Assets"| StaticHosting
    ReverseProxy -->|"Route /api/*"| APICluster
    APICluster -->|"App Pool (app_user)"| AppDatabase
    APICluster -->|"Read-Only Pool (analytics_user)"| AnalyticsReplica
    APICluster -->|"Internal REST"| PrivateOllama
```

---

## 7. Architectural Decisions Summary

| ADR # | Topic | Decision | Core Rationale |
| :---: | :--- | :--- | :--- |
| **[ADR 01](../sprint-1/decisions/01-core-stack.md)** | Core Stack | **Fastify + React (Vite) + TS** | Unified TypeScript contracts, Fastify JSON validation speed, zero-overhead native Node 22 fetch. |
| **[ADR 02](../sprint-1/decisions/02-ast-parser.md)** | AST Parser | **`pgsql-ast-parser`** | Pure TypeScript AST validation, in-memory traversal (<5ms), zero WASM memory leaks, clean LIMIT injection. |
| **[ADR 03](../sprint-1/decisions/03-database-isolation.md)** | Database Isolation | **Two DBs + Least Privilege Roles** | Separation of `app_db` and `analytics_db`; hardware/kernel read-only enforcement and 5s query timeout. |
| **[ADR 04](../sprint-1/decisions/04-llm-provider-strategy.md)** | LLM Provider | **Ollama Local + Groq Cloud** | Ollama (`qwen2.5-coder:7b`) ensures 100% offline privacy; Groq (`llama-3.1-8b-instant`) provides optional ultra-fast acceleration under $5 budget. |
