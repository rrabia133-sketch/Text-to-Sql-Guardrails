# Sprint 3 — Grounded Generation and Provider Policy

- **Duration:** 2 Weeks (Baseline)
- **Status:** 🟡 **IN PROGRESS**
- **Sprint Goal:** Deliver schema-grounded text-to-SQL generation with strict provider privacy controls: approved schema allowlist and versioned business glossary, deterministic relative date resolution, interchangeable Ollama (local) and Groq (cloud) adapters, enforce local-only airgap routing, structured JSON response validation, ambiguity detection with clarification dialogues, bounded retry and deadline management, cloud budget ledger, query artifact storage, and an early preview UI.
- **Reference Guides:**
  - Sprint Plan: [07-sprint-plan.md](../planning/07-sprint-plan.md#sprint-3--grounded-generation-and-provider-policy)
  - User Stories: [06-user-stories.md](../planning/06-user-stories.md#us-05--grounding)
  - Architecture: [05-architecture.md](../planning/05-architecture.md)
  - DevOps Plan: [08-devops-plan.md](../planning/08-devops-plan.md#tasks)
  - Functional Requirements: [02-functional-requirements.md](../planning/02-functional-requirements.md)
  - Sprint 1 Glossary & Rules: [glossary.md](../sprint-1/glossary.md), [query-rules.md](../sprint-1/query-rules.md)

---

## Sprint Backlog & Status

| Work Item | Type | Title | SP | Status | Progress |
| :--- | :--- | :--- | :---: | :---: | :--- |
| [US-05–08](US-05-08.md) | Story | Grounded Generation & Provider Policy (US-05, US-06, US-07, US-08) | 23 | 🟡 In Progress | 0 / 17 Tasks (0%) |
| [DO-05](DO-05.md) | DevOps | Secure Provider Configuration, Deadlines & Egress Guard | — | ⚪ Pending | 0 / 4 Tasks (0%) |

---

## Sprint 3 Task Board

| Task # | Name | Assigned To | Status | Output Artifact |
| :---: | :--- | :--- | :--- | :--- |
| **01** | Schema introspection allowlist & sanitized catalog service | [US-05–08](US-05-08.md#task-1-schema-introspection-allowlist--sanitized-catalog-service) | ⚪ **PENDING** | `backend/src/modules/schema/schema.service.ts` |
| **02** | Versioned business glossary & metric definition registry | [US-05–08](US-05-08.md#task-2-versioned-business-glossary--metric-definition-registry) | ⚪ **PENDING** | `packages/contracts/src/glossary.ts`, `backend/src/modules/schema/glossary.ts` |
| **03** | Deterministic analytics timezone & relative date resolver | [US-05–08](US-05-08.md#task-3-deterministic-analytics-timezone--relative-date-resolver) | ⚪ **PENDING** | `backend/src/modules/intent/date-resolver.ts` |
| **04** | Define generation & provider contracts in shared package | [US-05–08](US-05-08.md#task-4-define-generation--provider-contracts-in-shared-package) | ⚪ **PENDING** | `packages/contracts/src/generation.ts`, `packages/contracts/src/provider.ts` |
| **05** | Versioned prompt templates & schema grounding context builder | [US-05–08](US-05-08.md#task-5-versioned-prompt-templates--schema-grounding-context-builder) | ⚪ **PENDING** | `backend/src/modules/generation/prompts/` |
| **06** | Unified LLM provider interface & base abstractions | [US-05–08](US-05-08.md#task-6-unified-llm-provider-interface--base-abstractions) | ⚪ **PENDING** | `backend/src/modules/providers/provider.interface.ts` |
| **07** | Implement Ollama local provider adapter | [US-05–08](US-05-08.md#task-7-implement-ollama-local-provider-adapter) | ⚪ **PENDING** | `backend/src/modules/providers/ollama.provider.ts` |
| **08** | Implement Groq cloud provider adapter with token redact | [US-05–08](US-05-08.md#task-8-implement-groq-cloud-provider-adapter-with-token-redact) | ⚪ **PENDING** | `backend/src/modules/providers/groq.provider.ts` |
| **09** | Provider policy routing engine & local-only airgap guard | [US-05–08](US-05-08.md#task-9-provider-policy-routing-engine--local-only-airgap-guard) | ⚪ **PENDING** | `backend/src/modules/providers/provider.router.ts` |
| **10** | Daily cloud budget ledger & quota enforcement | [US-05–08](US-05-08.md#task-10-daily-cloud-budget-ledger--quota-enforcement) | ⚪ **PENDING** | `database/app/migrations/03-provider-budget-ledger.sql`, `budget.service.ts` |
| **11** | Structured JSON response parser & schema validation | [US-05–08](US-05-08.md#task-11-structured-json-response-parser--schema-validation) | ⚪ **PENDING** | `backend/src/modules/generation/output-validator.ts` |
| **12** | Bounded generation retry handler & deadline manager | [US-05–08](US-05-08.md#task-12-bounded-generation-retry-handler--deadline-manager) | ⚪ **PENDING** | `backend/src/modules/generation/retry.handler.ts` |
| **13** | Ambiguity detection engine & clarification response generator | [US-05–08](US-05-08.md#task-13-ambiguity-detection-engine--clarification-response-generator) | ⚪ **PENDING** | `backend/src/modules/intent/clarification.service.ts` |
| **14** | Query artifact persistence repository & ownership isolation | [US-05–08](US-05-08.md#task-14-query-artifact-persistence-repository--ownership-isolation) | ⚪ **PENDING** | `backend/src/modules/generation/query-artifact.repository.ts` |
| **15** | Fastify generation, provider, and schema API routes | [US-05–08](US-05-08.md#task-15-fastify-generation-provider-and-schema-api-routes) | ⚪ **PENDING** | `backend/src/modules/generation/generation.routes.ts` |
| **16** | Frontend generation shell, SQL preview & clarification UI | [US-05–08](US-05-08.md#task-16-frontend-generation-shell-sql-preview--clarification-ui) | ⚪ **PENDING** | `frontend/src/features/query/`, `ClarificationModal.tsx` |
| **17** | Automated provider contract, retry, and airgap egress tests | [US-05–08](US-05-08.md#task-17-automated-provider-contract-retry-and-airgap-egress-tests) | ⚪ **PENDING** | `backend/test/generation/`, `test/security/provider-isolation.test.ts` |

---

## Sprint 3 Exit Gate Checklist

Before advancing to Sprint 4 (SQL guardrails and restricted execution), all of the following exit criteria must be met:

- [ ] **Contract Equivalence:** Both Ollama and Groq provider adapters pass automated contract tests and emit identical structured JSON output shapes.
- [ ] **Local-Only Privacy Airgap:** When `PROVIDER_MODE=local`, zero outbound network calls are made to external cloud services; provider failure fails closed without silent cloud fallback.
- [ ] **Approved Schema Grounding:** Generation prompt context is strictly bounded to the allowlisted schema and versioned glossary; hidden columns and system tables are never exposed to LLMs.
- [ ] **Deterministic Date Resolution:** Relative time expressions (e.g. "last quarter", "yesterday") resolve to deterministic ISO-8601 bounds using the configured analytics timezone.
- [ ] **Structured Validation & Closed Failure:** Malformed model responses, hallucinated non-JSON output, or schema violations are caught, trigger at most one bounded retry, and fail closed safely without executing SQL.
- [ ] **Clarification Flow:** Underspecified questions (e.g. ambiguous metrics or missing date ranges) produce specific clarification dialogues rather than invented assumptions.
- [ ] **Budget & Deadline Controls:** Outbound cloud calls respect daily dollar budgets and per-request timeouts (15s cloud, 30s local); budget exhaustion returns a user-friendly 429 response.
- [ ] **Artifact Ownership:** Generated query artifacts are securely persisted in `app_db` linked to the submitting user, with an unexecuted preview state.
- [ ] **No Execution in Sprint 3:** The pipeline produces query previews and clarification artifacts ONLY; database execution remains completely disabled until Sprint 4.
