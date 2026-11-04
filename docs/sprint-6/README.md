# Sprint 6 — Complete User Experience & Analyst Workflow

- **Duration:** 2 Weeks (Baseline)
- **Status:** 🟢 **COMPLETED**
- **Sprint Goal:** Deliver the complete end-to-end analyst user journey and administrator policy controls:
  - Integrated Question → Clarification → Grounded Preview → Review Acknowledgement → Explicit Run workflow (`US-13`).
  - Idempotent execution protection, artifact freshness/schema-version checks, and strict prevention of client-side SQL substitution (`US-13`).
  - Typed result table distinguishing `NULL`, empty (`0 rows`), failed, timed-out, cancelled, and truncated (`> 500 rows` or `> 1 MiB`) states (`US-14`).
  - Bounded, owner-authorized CSV export with spreadsheet formula injection neutralization (`=`, `+`, `-`, `@`, `\t`, `\r` prefixed with `'`) (`US-14`, `DO-08`).
  - WCAG 2.2 AA accessibility compliance: full keyboard navigation, focus management in modals, ARIA live status announcements, and non-color confidence cues (`US-14`, `NFR-10`).
  - Private, paginated, owner-filtered query history with artifact reload and deletion (`US-15`).
  - Analyst feedback collection (`correct` / `incorrect` + reason tags + comment) linked to artifacts without mutating ground-truth evaluation labels (`US-15`).
  - Automated retention policies & ephemeral result cleanup (`15-minute` ephemeral result payload TTL, `30-day` history retention, `90-day` audit log retention) (`US-15`, `DO-08`).
- **Reference Guides:**
  - Sprint Plan: [07-sprint-plan.md](../planning/07-sprint-plan.md#sprint-6--complete-user-experience)
  - User Stories: [06-user-stories.md](../planning/06-user-stories.md#us-13--preview-and-run)
  - Architecture: [05-architecture.md](../planning/05-architecture.md)
  - DevOps Plan: [08-devops-plan.md](../planning/08-devops-plan.md#tasks)
  - Functional Requirements: [02-functional-requirements.md](../planning/02-functional-requirements.md) (`FR-12`, `FR-14`, `FR-15`, `FR-16`)
  - Non-Functional Requirements: [03-non-functional-requirements.md](../planning/03-non-functional-requirements.md) (`NFR-09`, `NFR-10`, `NFR-15`)
  - Sprint 5 Semantic & Confidence Foundation: [README.md](../sprint-5/README.md), [US-11-12.md](../sprint-5/US-11-12.md)

---

## Sprint Backlog & Status

| Work Item | Type | Title | SP | Status | Progress |
| :--- | :--- | :--- | :---: | :---: | :--- |
| [US-13–15](US-13-15.md) | Story | Complete Analyst Journey: Preview/Run, Results/CSV, History & Feedback (US-13, US-14, US-15) | 15 | 🟢 **COMPLETED** | 15 / 15 Tasks (100%) |
| [DO-08](DO-08.md) | DevOps | Retention Schedules, Ephemeral Result Cleanup & Safe CSV Policy | — | 🟢 **COMPLETED** | 4 / 4 Tasks (100%) |

---

## Sprint 6 Task Board

| Task # | Name | Assigned To | Status | Output Artifact |
| :---: | :--- | :--- | :--- | :--- |
| **01** | History, feedback, CSV export & retention contracts | [US-13–15](US-13-15.md#task-1-history-feedback-csv-export--retention-contracts) | 🟢 **COMPLETED** | `packages/contracts/src/history.ts`, `export.ts` |
| **02** | Database migration for feedback, result cache TTL & history indexes | [US-13–15](US-13-15.md#task-2-database-migration-for-feedback-result-cache-ttl--history-indexes) | 🟢 **COMPLETED** | `database/app/migrations/07-init-history-feedback-retention.sql` |
| **03** | Idempotent execution guard & schema/policy version freshness check | [US-13–15](US-13-15.md#task-3-idempotent-execution-guard--schemapolicy-version-freshness-check) | 🟢 **COMPLETED** | `backend/src/modules/execution/artifact-gate.ts`, `result-cache.service.ts` |
| **04** | Ephemeral execution result store (15-minute TTL) & ownership lookup | [US-13–15](US-13-15.md#task-4-ephemeral-execution-result-store-15-minute-ttl--ownership-lookup) | 🟢 **COMPLETED** | `backend/src/modules/execution/result-cache.service.ts` |
| **05** | Safe CSV serializer with formula injection neutralization | [US-13–15](US-13-15.md#task-5-safe-csv-serializer-with-formula-injection-neutralization) | 🟢 **COMPLETED** | `backend/src/modules/export/csv-exporter.service.ts` |
| **06** | Fastify CSV export endpoint (`GET /api/v1/executions/:id/export.csv`) | [US-13–15](US-13-15.md#task-6-fastify-csv-export-endpoint-get-apiv1executionsidexportcsv) | 🟢 **COMPLETED** | `backend/src/modules/export/export.routes.ts` |
| **07** | Paginated owner-filtered history & feedback repository | [US-13–15](US-13-15.md#task-7-paginated-owner-filtered-history--feedback-repository) | 🟢 **COMPLETED** | `backend/src/modules/history/history.repository.ts` |
| **08** | Fastify history, artifact deletion & feedback API routes | [US-13–15](US-13-15.md#task-8-fastify-history-artifact-deletion--feedback-api-routes) | 🟢 **COMPLETED** | `backend/src/modules/history/history.routes.ts` |
| **09** | Retention cleanup service (30d history, 90d audit, 15m results) | [US-13–15](US-13-15.md#task-9-retention-cleanup-service-30d-history-90d-audit-15m-results) | 🟢 **COMPLETED** | `backend/src/modules/retention/retention.service.ts` |
| **10** | Frontend typed results table with NULL, empty, truncated & error states | [US-13–15](US-13-15.md#task-10-frontend-typed-results-table-with-null-empty-truncated--error-states) | 🟢 **COMPLETED** | `frontend/src/features/results/ResultsTablePanel.tsx` |
| **11** | Frontend CSV download action & truncation warning badge | [US-13–15](US-13-15.md#task-11-frontend-csv-download-action--truncation-warning-badge) | 🟢 **COMPLETED** | `frontend/src/features/results/CsvExportButton.tsx` |
| **12** | Frontend paginated query history drawer & artifact reload/delete | [US-13–15](US-13-15.md#task-12-frontend-paginated-query-history-drawer--artifact-reloaddelete) | 🟢 **COMPLETED** | `frontend/src/features/history/QueryHistoryPanel.tsx` |
| **13** | Frontend analyst feedback widget (helpful / incorrect + reason tags) | [US-13–15](US-13-15.md#task-13-frontend-analyst-feedback-widget-helpful--incorrect--reason-tags) | 🟢 **COMPLETED** | `frontend/src/features/feedback/FeedbackWidget.tsx` |
| **14** | WCAG 2.2 AA accessibility, keyboard shortcuts & focus management | [US-13–15](US-13-15.md#task-14-wcag-22-aa-accessibility-keyboard-shortcuts--focus-management) | 🟢 **COMPLETED** | `frontend/src/App.tsx`, `frontend/src/index.css` |
| **15** | End-to-end Sprint 6 integration, ownership, CSV & retention test suite | [US-13–15](US-13-15.md#task-15-end-to-end-sprint-6-integration-ownership-csv--retention-test-suite) | 🟢 **COMPLETED** | `backend/test/integration/sprint6-workflow.test.ts` |

---

## DevOps DO-08 Task Board

| Task # | Name | Assigned To | Status | Output Artifact |
| :---: | :--- | :--- | :--- | :--- |
| **D1** | Ephemeral Result Payload TTL (15m) & Memory Bound Enforcement | [DO-08](DO-08.md#task-1-ephemeral-result-payload-ttl-15m--memory-bound-enforcement) | 🟢 **COMPLETED** | `backend/src/modules/execution/result-cache.service.ts` |
| **D2** | Spreadsheet Formula Injection Neutralization & CSV Security Suite | [DO-08](DO-08.md#task-2-spreadsheet-formula-injection-neutralization--csv-security-suite) | 🟢 **COMPLETED** | `backend/test/security/csv-injection.test.ts` |
| **D3** | Automated History (30d) & Audit (90d) Retention Scheduler | [DO-08](DO-08.md#task-3-automated-history-30d--audit-90d-retention-scheduler) | 🟢 **COMPLETED** | `backend/src/modules/retention/retention.service.ts` |
| **D4** | Cross-User History/Export Isolation & Expiry Verification Suite | [DO-08](DO-08.md#task-4-cross-user-historyexport-isolation--expiry-verification-suite) | 🟢 **COMPLETED** | `backend/test/security/retention-export-isolation.test.ts` |

---

## Sprint 6 Exit Gate Checklist

All criteria have been met and verified by automated unit, integration, and security test suites (90/90 passing):

- [x] **Preview Before Run:** SQL, parameters, resolved temporal window, and assumptions are visibly displayed before execution; client-submitted raw SQL strings are never accepted.
- [x] **Idempotency & Version Freshness:** Duplicate Run clicks with the same `idempotencyKey` do not trigger duplicate database queries, and stale schema/policy version artifacts are rejected.
- [x] **Typed Result States:** Result UI clearly distinguishes `NULL` values, empty sets (`0 rows`), truncated sets (`> 500 rows` or `> 1 MiB`), timeouts, and errors while preserving column types.
- [x] **Safe Bounded CSV Export:** CSV export enforces execution ownership, respects the 500-row / 1 MiB cap, and neutralizes all formula-prefixed cells (`=`, `+`, `-`, `@`, `\t`, `\r`).
- [x] **Owner-Isolated Paginated History:** Analysts can browse, reload, and delete only their own query history; cross-user access returns `403` / `404`.
- [x] **Non-Mutating Feedback:** Correct/incorrect analyst feedback is persisted against the artifact ID without altering ground-truth benchmark datasets.
- [x] **Retention & Ephemeral Expiry:** Expired execution results (`> 15 minutes`) cannot be retrieved or exported, and retention purge jobs cleanly remove expired history (`> 30 days`) and audit logs (`> 90 days`).
- [x] **WCAG 2.2 AA Accessibility:** Keyboard navigation, focus trapping in modals, ARIA status announcements, and non-color confidence indicators pass verification.
