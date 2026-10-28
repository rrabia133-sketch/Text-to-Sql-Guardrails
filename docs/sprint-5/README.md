# Sprint 5 — Semantic Validation and Confidence

- **Duration:** 2 Weeks (Baseline)
- **Status:** 🟡 **IN PROGRESS**
- **Sprint Goal:** Deliver comprehensive semantic validation, intent-slot verification, automated bounded repair, transparent multi-component confidence scoring, decision bands, and evaluation benchmark tooling:
  - Structured intent slot extraction (metric, dimensions, filters, dates, timezone, granularity, sorting, row bounds).
  - Deterministic semantic validation against AST structure, glossary metrics, date boundaries, completed order statuses, and join cardinalities (detecting fanout duplication and missing aggregations).
  - Bounded verifier & independent candidate stability generator (secondary candidate comparison providing stability evidence).
  - Bounded automated repair engine with maximum 1 repair attempt (`maxRepairAttempts = 1`), strictly revalidated through the complete recursive AST guardrails pipeline without weakening security policies.
  - Transparent 4-component confidence scoring engine:
    - 35% Deterministic intent-slot agreement
    - 30% Glossary, join & aggregation evidence
    - 20% Verifier agreement
    - 15% Stability against independent candidate
  - Explicit unavailable component accounting (unavailable evidence contributes 0 and is visibly marked rather than silently renormalized away).
  - Decision bands: `high` (85–100, ready for Run), `review` (65–84, requires explicit user acknowledgement), and `blocked`/`abstain` (< 65, execution forbidden).
  - Fail-closed security guarantee: high confidence score can **never** bypass AST guardrails or schema rejection.
  - Distinguishing valid empty database results from failed or mismatched queries.
  - Database persistence for semantic findings, confidence breakdown, and review acknowledgement in `app_db`.
  - Frontend UI enhancements: confidence score card with visual gauge/bars, heuristic disclaimer label, finding badges, and review acknowledgement modal for medium-confidence queries.
  - Benchmark evaluation harness and dataset versioning (DO-07): development evaluation corpus vs. frozen holdout dataset separation.
- **Reference Guides:**
  - Sprint Plan: [07-sprint-plan.md](../planning/07-sprint-plan.md#sprint-5--semantic-validation-and-confidence)
  - User Stories: [06-user-stories.md](../planning/06-user-stories.md#us-11--meaning)
  - Architecture: [05-architecture.md](../planning/05-architecture.md#hallucination-and-meaning-checks)
  - DevOps Plan: [08-devops-plan.md](../planning/08-devops-plan.md#tasks)
  - Functional Requirements: [02-functional-requirements.md](../planning/02-functional-requirements.md) (`FR-10`, `FR-11`)
  - Non-Functional Requirements: [03-non-functional-requirements.md](../planning/03-non-functional-requirements.md) (`NFR-02`, `NFR-03`, `NFR-04`, `NFR-13`)
  - Sprint 4 Guardrails & Execution: [README.md](../sprint-4/README.md), [US-09-10.md](../sprint-4/US-09-10.md)

---

## Sprint Backlog & Status

| Work Item | Type | Title | SP | Status | Progress |
| :--- | :--- | :--- | :---: | :---: | :--- |
| [US-11–12](US-11-12.md) | Story | Semantic Validation & Explained Confidence (US-11, US-12) | 26 | 🟡 **IN PROGRESS** | 5 / 17 Tasks (29%) |
| [DO-07](DO-07.md) | DevOps | Evaluation Harness, Dataset Versioning & Holdout Separation | — | 🟡 **IN PROGRESS** | 0 / 4 Tasks (0%) |

---

## Sprint 5 Task Board

| Task # | Name | Assigned To | Status | Output Artifact |
| :---: | :--- | :--- | :--- | :--- |
| **01** | Semantic validation & confidence contracts | [US-11–12](US-11-12.md#task-1-semantic-validation--confidence-contracts) | 🟢 **COMPLETED** | `packages/contracts/src/semantic.ts`, `confidence.ts` |
| **02** | Structured intent slot extraction service | [US-11–12](US-11-12.md#task-2-structured-intent-slot-extraction-service) | 🟢 **COMPLETED** | `backend/src/modules/intent/intent-extractor.service.ts` |
| **03** | Metric definition & aggregation verifier | [US-11–12](US-11-12.md#task-3-metric-definition--aggregation-verifier) | 🟢 **COMPLETED** | `backend/src/modules/semantic/metric-verifier.ts` |
| **04** | Filter, status & temporal boundary validator | [US-11–12](US-11-12.md#task-4-filter-status--temporal-boundary-validator) | 🟢 **COMPLETED** | `backend/src/modules/semantic/filter-verifier.ts` |
| **05** | Join cardinality, fanout & duplicate row detector | [US-11–12](US-11-12.md#task-5-join-cardinality-fanout--duplicate-row-detector) | 🟢 **COMPLETED** | `backend/src/modules/semantic/cardinality-verifier.ts` |
| **06** | Glossary business rule & formula alignment checker | [US-11–12](US-11-12.md#task-6-glossary-business-rule--formula-alignment-checker) | ⚪ PLANNED | `backend/src/modules/semantic/glossary-verifier.ts` |
| **07** | Deterministic semantic validation orchestrator | [US-11–12](US-11-12.md#task-7-deterministic-semantic-validation-orchestrator) | ⚪ PLANNED | `backend/src/modules/semantic/semantic-validator.service.ts` |
| **08** | Bounded verifier & secondary candidate stability generator | [US-11–12](US-11-12.md#task-8-bounded-verifier--secondary-candidate-stability-generator) | ⚪ PLANNED | `backend/src/modules/semantic/candidate-verifier.service.ts` |
| **09** | Bounded automated repair engine (max 1 repair attempt) | [US-11–12](US-11-12.md#task-9-bounded-automated-repair-engine-max-1-repair-attempt) | ⚪ PLANNED | `backend/src/modules/semantic/repair-engine.service.ts` |
| **10** | 4-Component transparent confidence scoring engine | [US-11–12](US-11-12.md#task-10-4-component-transparent-confidence-scoring-engine) | ⚪ PLANNED | `backend/src/modules/semantic/confidence.service.ts` |
| **11** | Artifact state machine & review acknowledgement gate | [US-11–12](US-11-12.md#task-11-artifact-state-machine--review-acknowledgement-gate) | ⚪ PLANNED | `backend/src/modules/execution/artifact-state.service.ts` |
| **12** | Semantic findings database migration & repository in app_db | [US-11–12](US-11-12.md#task-12-semantic-findings-database-migration--repository-in-app_db) | ⚪ PLANNED | `database/app/migrations/06-init-semantic-confidence.sql` |
| **13** | Fastify semantic validation & confidence API routes | [US-11–12](US-11-12.md#task-13-fastify-semantic-validation--confidence-api-routes) | ⚪ PLANNED | `backend/src/modules/generation/generation.routes.ts` |
| **14** | Frontend confidence scorecard & heuristic disclaimer | [US-11–12](US-11-12.md#task-14-frontend-confidence-scorecard--heuristic-disclaimer) | ⚪ PLANNED | `frontend/src/features/query/ConfidenceCard.tsx` |
| **15** | Frontend review acknowledgement toggle & modal | [US-11–12](US-11-12.md#task-15-frontend-review-acknowledgement-toggle--modal) | ⚪ PLANNED | `frontend/src/features/query/ReviewAcknowledgementModal.tsx` |
| **16** | Automated semantic mismatch, empty result & abstention tests | [US-11–12](US-11-12.md#task-16-automated-semantic-mismatch-empty-result--abstention-tests) | ⚪ PLANNED | `backend/test/semantic/semantic-mismatch.test.ts` |
| **17** | End-to-end generation to semantic review & execution suite | [US-11–12](US-11-12.md#task-17-end-to-end-generation-to-semantic-review--execution-suite) | ⚪ PLANNED | `backend/test/integration/semantic-pipeline.test.ts` |

---

## DevOps DO-07 Task Board

| Task # | Name | Assigned To | Status | Output Artifact |
| :---: | :--- | :--- | :--- | :--- |
| **D1** | Development Evaluation Corpus & Ambiguity Fixtures | [DO-07](DO-07.md#task-1-development-evaluation-corpus--ambiguity-fixtures) | ⚪ PLANNED | `backend/test/fixtures/evaluation/development-set.json` |
| **D2** | Frozen Holdout Dataset Sequestration & Access Isolation Gate | [DO-07](DO-07.md#task-2-frozen-holdout-dataset-sequestration--access-isolation-gate) | ⚪ PLANNED | `backend/test/fixtures/evaluation/holdout-set.json` |
| **D3** | Automated Semantic Evaluation Harness & Benchmark Runner | [DO-07](DO-07.md#task-3-automated-semantic-evaluation-harness--benchmark-runner) | ⚪ PLANNED | `backend/src/modules/evaluation/benchmark-runner.ts` |
| **D4** | Confidence Calibration Ledger & Reliability Binning Report | [DO-07](DO-07.md#task-4-confidence-calibration-ledger--reliability-binning-report) | ⚪ PLANNED | `docs/sprint-5/benchmark-report.md` |

---

## Sprint 5 Exit Gate Checklist

Before advancing to Sprint 6 (Complete user experience & analyst workflow), all of the following exit criteria must be met:

- [ ] **Critical Mismatch Block:** Queries with detected semantic mismatches (wrong aggregation, missing mandatory date filter, unhandled order status, or duplicate fanout joins) are flagged with CRITICAL findings and blocked from physical execution.
- [ ] **Bounded Repair Guarantee:** Semantic repair executes at most once (`maxRepairAttempts = 1`), and the repaired SQL is revalidated through the full AST parser and security guardrails without weakening safety constraints.
- [ ] **Transparent Score Formula:** Confidence score computes deterministically across the 4 explicit components (35% intent slot, 30% glossary/join/aggregation, 20% verifier, 15% candidate stability).
- [ ] **Explicit Unavailable Evidence:** Any unavailable score component contributes 0 and is visibly labeled as unavailable; it is never silently renormalized away to artificially inflate confidence.
- [ ] **Fail-Closed Gate:** A high confidence score (85–100) is strictly subordinate to security; it can never bypass an AST guardrail violation, schema failure, or plan cost rejection.
- [ ] **Review Band Acknowledgement:** Medium-confidence queries (`review` band, 65–84) require an explicit analyst review acknowledgement before execution can be scheduled.
- [ ] **Empty Result Distinguishability:** Valid queries returning zero rows are explicitly distinguished from failed, timed-out, or semantically mismatched queries.
- [ ] **Heuristic Labeling:** All UI displays and API responses clearly label uncalibrated scores as "Heuristic Confidence" and disclaim probabilistic accuracy claims.
- [ ] **Holdout Separation Integrity:** The frozen holdout benchmark dataset remains strictly untouched and isolated from tuning scripts and prompt engineering runs.
- [ ] **Benchmark Quality Targets:** Development evaluation achieves ≤5% wrong-answer rate on high-confidence queries, ≥90% refusal/clarification recall on ambiguous queries, and ≤15% false refusal rate on supported queries.
