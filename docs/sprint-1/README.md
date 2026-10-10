# Sprint 1 — Feasibility and Design Decisions

- **Duration:** 2 Weeks (Baseline)
- **Status:** 🟡 IN PROGRESS
- **Sprint Goal:** Establish feasibility evidence for AST SQL parsing, PostgreSQL privilege containment, and local vs. cloud LLM generation before building application features.
- **Reference Guide:** [11-sprint-1-development-plan.md](../../planning/11-sprint-1-development-plan.md)

---

## Sprint Backlog & Status

| Work Item | Type | Title | SP | Status | Progress |
| :--- | :--- | :--- | :---: | :---: | :--- |
| [US-01](US-01.md) | Story | Feasibility Evidence & Safety Guardrails | 8 | 🟡 In Progress | 8 / 12 Tasks (67%) |
| [DO-01](DO-01.md) | DevOps | Environment, Threat Model & Cost Boundaries | — | 🟡 In Progress | 2 / 4 Tasks (50%) |

---

## Sprint 1 Task Board

| Task # | Name | Assigned To | Status | Output Artifact |
| :---: | :--- | :--- | :---: | :--- |
| **01** | Check tools and machine environment | US-01 / DO-01 | 🟢 **COMPLETED** | [`docs/sprint-1/environment.md`](../../sprint-1/environment.md) |
| **02** | Create workspace folders & spike package | US-01 | 🟢 **COMPLETED** | `backend/spikes/sprint-1/`, [`scope.md`](../../sprint-1/scope.md) |
| **03** | Design data schema and glossary | US-01 | 🟢 **COMPLETED** | [`data-design.md`](data-design.md), [`glossary.md`](glossary.md) |
| **04** | Build disposable PostgreSQL fixture | US-01 | 🟢 **COMPLETED** | `compose.yaml` (port 5434), `sql/*.sql` |
| **05** | Define query rules, threats & risks | US-01 / DO-01 | 🟢 **COMPLETED** | [`query-rules.md`](query-rules.md), [`threat-model.md`](threat-model.md) |
| **06** | Curate test cases & benchmark rules | US-01 | 🟢 **COMPLETED** | `cases/` (dev, holdout, safety), [`benchmark.md`](benchmark.md) |
| **07** | AST parser and SQL checker spike | US-01 | 🟢 **COMPLETED** | `src/check-sql.ts`, [`parser-proof.md`](parser-proof.md) |
| **08** | Independent DB permission tests | US-01 | 🟢 **COMPLETED** | `sql/04-roles.sql`, [`db-proof.md`](db-proof.md) |
| **09** | Local model experiment (Ollama) | US-01 | ⚪ Not Started | `src/local-model.ts` |
| **10** | Cloud comparison runner (Groq) | US-01 / DO-01 | ⚪ Not Started | `src/compare-providers.ts`, [`provider-comparison.md`](../../sprint-1/provider-comparison.md) |
| **11** | Record architecture decision records | US-01 / DO-01 | ⚪ Not Started | `docs/sprint-1/decisions/*.md` |
| **12** | Sprint 1 exit review & gate verification | US-01 | ⚪ Not Started | [`docs/sprint-1/exit-review.md`](../../sprint-1/exit-review.md) |

---

## Sprint Exit Gate Checklist

Before advancing to Sprint 2 (React & Fastify application skeleton), all of the following gates must pass:

- [ ] Disposable PostgreSQL fixture reproducible and port conflict free (`compose.yaml`).
- [ ] Synthetic data glossary and hand-calculated validation queries verified.
- [ ] Development, holdout, and safety benchmark sets frozen and isolated.
- [ ] AST parser demonstrates recursive node inspection and alias resolution (`parser-proof.md`).
- [ ] Database role containment independently proven via restricted credentials (`db-proof.md`).
- [ ] Local (Ollama) vs. Cloud (Groq) viability, latency, and cost measured (`provider-comparison.md`).
- [ ] No unresolved architectural or safety blockers remaining for safe execution.
- [ ] Sprint 1 exit review formally documented in [`docs/sprint-1/exit-review.md`](../../sprint-1/exit-review.md).
