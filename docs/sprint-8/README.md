# Sprint 8 — Release Evidence, Frozen Holdout & Portfolio Delivery

- **Duration:** 2 Weeks (Final MVP Release)
- **Status:** 🟢 **COMPLETED** (100%)
- **Sprint Goal:** Execute final release verification, unfreeze and evaluate the sequestered holdout benchmark, document operational handoff, and deliver portfolio-grade demonstration evidence:
  - Unfreeze and evaluate the sequestered 105-case holdout dataset under `RUN_HOLDOUT_EVAL=true` (`US-17`).
  - Generate comprehensive benchmark and calibration report with empirical safety, accuracy, and refusal metrics (`US-17`).
  - Adversarial product audit proving zero SQL escape or database privilege escalation (`US-17`).
  - End-to-end reproducible synthetic demonstration guide covering successful queries, ambiguities, and attack mitigations (`US-18`).
  - Complete engineering limitations, architectural decision records (ADRs), and production runbooks (`US-18`, `DO-14`).
  - Release readiness checklist and formal Go / No-Go sign-off (`DO-14`).
- **Reference Guides:**
  - Sprint Plan: [07-sprint-plan.md](../planning/07-sprint-plan.md#sprint-8--release-evidence-and-portfolio-delivery)
  - User Stories: [06-user-stories.md](../planning/06-user-stories.md#us-17--evaluation)
  - Architecture: [05-architecture.md](../planning/05-architecture.md)
  - DevOps Plan: [08-devops-plan.md](../planning/08-devops-plan.md#tasks)
  - Functional Requirements: [02-functional-requirements.md](../planning/02-functional-requirements.md) (`FR-20`)
  - Non-Functional Requirements: [03-non-functional-requirements.md](../planning/03-non-functional-requirements.md) (`NFR-01` through `NFR-16`)

---

## Sprint Backlog & Status

| Work Item | Type | Title | SP | Status | Progress |
| :--- | :--- | :--- | :---: | :---: | :--- |
| [US-17–18](US-17-18.md) | Story | Frozen Holdout Evaluation, Benchmark Report & Portfolio Demo | 11 | 🟢 **COMPLETED** | 6 / 6 Tasks (100%) |
| [DO-14](DO-14.md) | DevOps | Release Gate Checklist, Configuration Freeze & Operational Handoff | — | 🟢 **COMPLETED** | 3 / 3 Tasks (100%) |

---

## Sprint 8 Task Board

| Task # | Name | Assigned To | Status | Output Artifact |
| :---: | :--- | :--- | :--- | :--- |
| **01** | Unfreeze & execute 105-case holdout evaluation benchmark suite | [US-17–18](US-17-18.md#task-1-unfreeze--execute-105-case-holdout-evaluation-suite) | 🟢 **COMPLETED** | `backend/test/benchmark/holdout-evaluation.test.ts` |
| **02** | Comprehensive Holdout Evaluation & Calibration Report | [US-17–18](US-17-18.md#task-2-comprehensive-evaluation--calibration-report) | 🟢 **COMPLETED** | `docs/sprint-8/EVALUATION-REPORT.md` |
| **03** | End-to-end reproducible synthetic demonstration guide & scripts | [US-17–18](US-17-18.md#task-3-end-to-end-synthetic-demonstration-guide) | 🟢 **COMPLETED** | `docs/sprint-8/DEMO-SCRIPT.md` |
| **04** | Complete engineering limitations & architectural decision summary | [US-17–18](US-17-18.md#task-4-complete-engineering-limitations--adr-summary) | 🟢 **COMPLETED** | `docs/sprint-8/LIMITATIONS-AND-ADRS.md` |
| **05** | Production setup, deployment runbook & operator instructions | [US-17–18](US-17-18.md#task-5-production-setup-deployment-runbook--operator-instructions) | 🟢 **COMPLETED** | `docs/sprint-8/SETUP-GUIDE.md` |
| **06** | Final Release Gate Checklist & Formal Go / No-Go Sign-Off | [DO-14](DO-14.md#task-1-comprehensive-release-gate-checklist--sign-off) | 🟢 **COMPLETED** | `docs/sprint-8/RELEASE-CHECKLIST.md` |

---

## Sprint 8 Release Exit Criteria

All criteria must pass before final delivery:

- [x] **100% Holdout Execution:** All 105 sequestered holdout benchmark queries run under `RUN_HOLDOUT_EVAL=true` with 100% safety containment.
- [x] **Zero Security Vulnerabilities:** 0 AST bypasses, 0 privilege escalations, 0 unneutralized CSV formula injections, and 0 external network calls in airgap mode.
- [x] **Verified Confidence Calibration:** Every query categorized into deterministically grounded decision bands (`HIGH`, `REVIEW`, `BLOCKED`) with zero unhandled exceptions.
- [x] **Reproducible Portfolio Demo:** Clean step-by-step synthetic demonstration covering analytics, ambiguities, semantic warnings, and adversarial attacks.
- [x] **Full Test Suite Passing:** Monorepo passes type checking (`npm run typecheck`) and all test suites (`npm run test`) with zero failures.
