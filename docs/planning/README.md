# Text-to-SQL planning pack

Status: proposed, planning only. Prepared: 7 October 2026.

This pack defines the project before implementation. It creates no application code, dependencies, database, CI workflow, infrastructure, or executable agent configuration. Directory trees and contracts are proposals.

## Read in this order

| Document | Purpose |
| --- | --- |
| [01 — Project plan](01-project-plan.md) | Scope, phases, decisions, risks, and delivery gates |
| [02 — Functional requirements](02-functional-requirements.md) | Required product behavior and acceptance checks |
| [03 — Non-functional requirements](03-non-functional-requirements.md) | Measurable quality, safety, privacy, and operational targets |
| [04 — Technical feasibility](04-technical-feasibility.md) | Stack assessment, technical spikes, constraints, and sources |
| [05 — Architecture](05-architecture.md) | Components, trust boundaries, data flow, contracts, and confidence design |
| [06 — User stories](06-user-stories.md) | Prioritized backlog with acceptance criteria and requirement links |
| [07 — Sprint plan](07-sprint-plan.md) | Sprint-by-sprint stories, tasks, dependencies, and exit gates |
| [08 — DevOps plan](08-devops-plan.md) | Environments, delivery pipeline, operational tasks, and runbooks |
| [09 — Project structure](09-project-structure.md) | Proposed Node.js/Fastify + React foundation |
| [10 — Agentic coding structure](10-agentic-coding-structure.md) | Proposed coding-agent roles, task contracts, and review workflow |
| [11 — Sprint 1 development plan](11-sprint-1-development-plan.md) | Hands-on sequence for developing and checking the Sprint 1 experiments |

## Assumptions

- “grock” means **Groq**, the online inference provider; it does not mean xAI Grok. Confirm before implementation if this interpretation is incorrect.
- Node.js + Fastify backend and React frontend; TypeScript is proposed for both.
- PostgreSQL is the first and only query dialect for the MVP. The real database initially contains synthetic ecommerce analytics data.
- Ollama supports the local/private execution path; Groq supports an explicitly enabled online path.
- One developer is the baseline. Eight two-week sprints are an initial estimate, not a delivery commitment. Re-estimate after feasibility spikes.
- MVP is a credible portfolio application with staged deployment. Enterprise compliance approval and universal query correctness are not claimed.
- A model used inside the app is distinct from a coding agent used to develop the app.

## Traceability

Requirement identifiers: `FR-*`, `NFR-*`. Backlog identifiers: `US-*`. Operational identifiers: `DO-*`. Sprint assignments appear in the story and sprint documents. A story is complete only when its acceptance criteria and the shared definition of done pass.

## Implementation decisions still to settle

Select exact model IDs and runtime versions after benchmarking; select deployment provider and monthly budget; confirm available Ollama hardware; choose a maintained PostgreSQL AST parser after its safety spike; confirm authentication provider and retention policy. Proposed defaults in this pack permit planning without treating these choices as implemented facts.
