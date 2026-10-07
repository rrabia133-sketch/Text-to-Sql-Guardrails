# Sprint-by-sprint delivery plan

Baseline: one developer, eight two-week sprints, approximately sixteen calendar weeks after implementation begins. Dates are intentionally unset. Capacity is provisional; Sprint 1 is investigative, and Sprint 3 may need splitting after velocity is measured. Reserve roughly 20% of each sprint for integration, review and fixes. Re-estimate rather than remove safety work to meet a date.

## Sprint 1 — Feasibility and design decisions

Stories: **US-01**. DevOps: **DO-01**.

Tasks: finalize fixture/glossary and threat model; curate development/holdout/safety sets; compare providers; prove parser traversal and name resolution; prove DB privilege containment; record hardware, runtime, deployment and budget assumptions; prepare decision records.

Dependencies: none. Deliverables: selected stack, supported query subset, benchmark specification, threat model and risk register.

Exit: parser/DB containment demonstrated; local/cloud viability measured; no unresolved architectural blocker for safe execution. If unmet, continue the spike or narrow scope before execution development.

## Sprint 2 — Application foundation

Stories: **US-02, US-03, US-04**. DevOps: **DO-02–04**.

Tasks: create the proposed workspace; configure Fastify/React and shared contracts; create synthetic analytics fixture and separate app metadata DB; implement identity/session ownership; establish distinct database roles; add health routes and baseline CI; document local setup.

Dependencies: Sprint 1 choices. Deliverables: running skeleton, authenticated empty workspace, reproducible fixture and CI.

Exit: clean-checkout setup works; unauthorized/cross-user tests pass; analytics credential cannot write; no secrets committed.

## Sprint 3 — Grounded generation and provider policy

Stories: **US-05, US-06, US-07, US-08**. DevOps: **DO-05**.

Tasks: schema discovery allowlist; glossary/date resolver; prompt versions; provider interface and Ollama/Groq adapters; structured-response validation; clarification flow; bounded retry/deadline/budget controls; minimal generation UI and artifact storage.

Dependencies: identity, contracts, fixture. Deliverables: natural-language questions produce previews or clarification without running generated SQL.

Exit: both providers pass contract tests; local-only mode cannot call cloud; invalid outputs fail closed. Any basic UI built here supports early testing; Sprint 6 completes product interactions.

## Sprint 4 — SQL guardrails and restricted execution

Stories: **US-09, US-10**. DevOps: **DO-06**.

Tasks: recursive AST policy and scoped resolution; approved function/join checks; normalization and row-cap revalidation; plan cost gate; restricted executor/read-only transaction; time/byte/concurrency limits; cancel/cleanup; immutable artifact ownership, expiry and policy revalidation.

Dependencies: grounded artifacts and parser proof. Deliverables: internal/API safe execution path; no production exposure yet.

Exit: curated adversarial corpus blocked before execution; DB privilege tests independently pass; timeout, disconnect and byte-limit behavior verified against real PostgreSQL.

## Sprint 5 — Semantic validation and confidence

Stories: **US-11, US-12**. DevOps: **DO-07**.

Tasks: extract intent slots; validate metrics, cardinality, dates and filters; add bounded verifier/candidate evidence; implement one-repair maximum; define score components and decision bands; run development evaluation and tune abstention.

Dependencies: complete AST and execution boundaries. Deliverables: validation evidence, confidence response, review/blocked/ready states and development report.

Exit: critical mismatches cannot execute; confidence does not bypass safety; evidence and unavailable checks are explicit. Holdout remains untouched.

## Sprint 6 — Complete user experience

Stories: **US-13, US-14, US-15**. DevOps: **DO-08**.

Tasks: integrate question/clarification/preview/Run; SQL and assumptions panel; confidence explanation; typed result table; bounded safe CSV; paginated history; feedback; retention deletion; loading/empty/error/truncated states; ownership and keyboard E2E checks.

Dependencies: generation, guardrails, semantic decisions. Deliverables: complete analyst journey and administrator policy controls.

Exit: all primary flows pass browser tests; artifact substitution and cross-user access fail; accessibility and export checks pass.

## Sprint 7 — Deployment and operational readiness

Stories: **US-16**. DevOps: **DO-09–13**.

Tasks: staging environment and protected deployment workflow; production-style secrets/network boundaries; telemetry dashboards and alerts; performance tests and tuning; redaction/egress review; backup restore; rollback and dependency-failure drills.

Dependencies: full end-to-end flow. Deliverables: staging demo, operational evidence, cost controls and runbooks.

Exit: observed targets and failures reported; restore/rollback proven; release credentials and cloud policy reviewed. Reopen relevant stories when performance or privacy tests reveal defects.

## Sprint 8 — Release evidence and portfolio delivery

Stories: **US-17, US-18**. DevOps: **DO-14**.

Tasks: run frozen holdout and safety suites; adversarial product review; resolve findings; if tuning follows holdout failures, produce a fresh holdout before new claims; finalize benchmark report, setup docs, ADRs, limitations and synthetic-data demo; prepare release checklist.

Dependencies: staging and all Must stories. Deliverables: release candidate, evaluation report, demonstration and operational handoff.

Exit: all project and NFR release gates pass; critical findings closed; release decision records evidence. Schedule overrun is preferable to publishing unsupported correctness/safety claims.

## Ongoing sprint activities

Refinement at sprint start; requirement/story traceability check during review; small reviewed changes; demo against synthetic data at sprint end; update estimates and risk register in retrospective. Operational and test tasks are part of story completion, not a later optional sprint.

## Future backlog

US-19 charts, multi-turn questions, additional SQL dialects, curated connectors, larger-schema retrieval and enterprise row-level access are separate scope proposals after the MVP release. Writes remain excluded unless a future project explicitly redesigns the safety model.
