# Technical feasibility

## Assessment

Feasible as a bounded PostgreSQL analytics MVP. The difficult work is proving SQL policy coverage, preserving business meaning, and producing honest confidence evidence. Fastify and React integration is comparatively routine. Enterprise-grade arbitrary schemas and unrestricted SQL would substantially increase effort.

## Proposed stack

| Area | Proposal | Constraint or proof needed |
| --- | --- | --- |
| Backend | Supported Node.js LTS, Fastify, TypeScript | Select a currently supported combination at implementation and pin versions. |
| Frontend | React + Vite + TypeScript; accessible table and SQL preview | Check browser support and keyboard usability. |
| Analytics | Supported PostgreSQL release; Node PostgreSQL driver | Prove separate read-only privileges, cancellation, byte caps, and role configuration. |
| Application state | PostgreSQL in a separate database with different credentials | Store metadata/history; never reuse this writer pool for generated SQL. |
| SQL analysis | Maintained PostgreSQL-aware parser producing an AST | Select only after recursive CTE/function/alias/schema-resolution tests. No regex-only validator. |
| Local LLM | Ollama on the developer machine or private host | Select model by memory, warm/cold latency, SQL accuracy and licensing. |
| Online LLM | Groq API | Validate selected model's structured-output support, quotas, privacy policy and availability. |
| Validation | Shared JSON Schema contracts; application-side validation | Structured output constrains shape, not SQL meaning or safety. |
| Delivery | npm workspaces, Docker Compose, GitHub Actions | Docker on the development machine is a prerequisite to confirm. |
| Tests | Unit/integration tests, browser E2E, real-DB adversarial suite, benchmark runner | Fixed fixtures and deterministic reference answers are needed. |

Fastify documents support by Node LTS lines; the plan should choose a supported runtime rather than assume that a framework's minimum Node version is a suitable production choice. [Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/).

Local Ollama accepts a JSON schema for structured output; its documentation distinguishes local support from its cloud limitations. Validate responses in the application regardless. [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs).

Groq offers structured-output modes with model-dependent support and schema restrictions. Confirm the selected model and behavior during the provider spike; API failures still require handling. [Groq structured outputs](https://console.groq.com/docs/structured-outputs).

PostgreSQL read-only transactions restrict write operations but have documented exceptions, including temporary-table behavior. They are only one layer: privileges, relation/function allowlists and AST checks remain necessary. [PostgreSQL transaction modes](https://www.postgresql.org/docs/current/sql-set-transaction.html). PostgreSQL also provides statement and lock timeouts; apply bounded settings per execution context. [PostgreSQL client settings](https://www.postgresql.org/docs/current/runtime-config-client.html).

## Sprint 1 spikes

| Spike | Method | Exit evidence |
| --- | --- | --- |
| Parser suitability | Test joins, aliases, nested queries, CTEs, unions, comments, quoted names, system catalogs, unsafe functions and modifying constructs. | Supported AST subset and explicit rejects documented; parser cannot silently skip an unknown node. |
| Database containment | Try writes, temp objects, privilege changes, search-path escapes, extension functions and long-running queries under the real execution role. | Denied privileges; cancellation and pool cleanup proven. |
| Provider comparison | Run the same development questions on two viable local models and a supported Groq model. | Result accuracy, schema errors, latency, token usage and memory recorded. |
| Semantic checking | Compare intent-slot checks with a structured LLM verifier on deliberately wrong queries. | Known mismatch detection and false-positive rates reported. |
| Deployment envelope | Check local hardware, container support and one potential hosting setup. | Chosen hardware/runtime, provider quotas and rough cost worksheet. |

Allow approximately one sprint for these spikes within the eight-sprint estimate. If the parser cannot safely cover the subset, narrow SQL support or change parser before building execution. If local latency misses the target, document the limitation or choose a smaller model after measuring accuracy; cloud use remains explicit.

## Evaluation and dataset feasibility

Curate at least 80 development questions and a separately held-out set of at least 100 answerable plus 40 ambiguous/unsupported cases. Build a distinct safety corpus of at least 60 attempts. Use multiple fixture variants with nulls, duplicate names, ties, missing months, canceled orders and join duplication to expose accidentally correct SQL.

Reference SQL is human reviewed. Compare result sets with type-aware tolerances; compare ordering when requested and permit approved equivalent SQL. Pin the evaluation date/timezone. Benchmark comparisons on one fixture alone cannot prove meaning for every database state.

## Cost and unresolved dependencies

Estimate monthly online cost from requests × generation/verifier calls × input/output token use × current provider rates, adding bounded retries. Add hosting, managed database, backups, telemetry and local hardware costs. Exact prices and model choices require a later implementation-time check; this pack makes no pricing claim.

No vector database, orchestration framework or fine-tuning is required for the initial small schema. Start with explicit metadata selection and a bounded application pipeline. Reconsider only if measured schema/context limits justify it.
