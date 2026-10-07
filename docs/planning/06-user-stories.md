# User story document

Priorities are ordered by dependency and risk. SP means provisional relative story points, not days; recalibrate after Sprint 2. Split any story that is too large once implementation details are known.

| ID | Story | Priority | SP | Sprint | Requirements |
| --- | --- | --- | --- | --- | --- |
| US-01 | As a developer, I want feasibility evidence so that implementation starts with viable safety and model choices. | Must | 8 | 1 | FR-07, FR-20; NFR-01, NFR-05 |
| US-02 | As a developer, I want a reproducible Fastify/React workspace so that development and checks run consistently. | Must | 5 | 2 | NFR-11, NFR-13 |
| US-03 | As an analyst, I want to sign in so that my queries and results stay private. | Must | 5 | 2 | FR-01; NFR-09 |
| US-04 | As an administrator, I want an approved analytics fixture and restricted connection so that users access only permitted data. | Must | 5 | 2 | FR-02; NFR-09 |
| US-05 | As an analyst, I want schema-grounded context and business definitions so that SQL uses real data correctly. | Must | 5 | 3 | FR-03, FR-08 |
| US-06 | As an analyst, I want to ask an English question and receive SQL so that I can analyze data without writing queries. | Must | 8 | 3 | FR-04, FR-05 |
| US-07 | As an analyst, I want clarification when my question is ambiguous so that the system does not invent my intent. | Must | 5 | 3 | FR-06; NFR-03 |
| US-08 | As an administrator, I want local-only or approved Groq routing so that provider use follows privacy policy. | Must | 5 | 3 | FR-17, FR-18; NFR-08, NFR-16 |
| US-09 | As an analyst, I want unsafe SQL rejected so that generated queries cannot modify or escape approved data. | Must | 8 | 4 | FR-07, FR-08; NFR-01 |
| US-10 | As an operator, I want bounded execution so that costly queries cannot exhaust the database. | Must | 8 | 4 | FR-09, FR-13; NFR-06 |
| US-11 | As an analyst, I want semantic validation so that plausible SQL answering the wrong question is flagged. | Must | 8 | 5 | FR-10 |
| US-12 | As an analyst, I want explained confidence so that I understand uncertainty before running a query. | Must | 5 | 5 | FR-11; NFR-04 |
| US-13 | As an analyst, I want to preview and explicitly run approved SQL so that I control execution. | Must | 5 | 6 | FR-12 |
| US-14 | As an analyst, I want readable real results and bounded CSV export so that I can use the answer. | Must | 5 | 6 | FR-14, FR-15; NFR-10 |
| US-15 | As an analyst, I want private query history and feedback so that I can revisit work and report mistakes. | Must | 5 | 6 | FR-16; NFR-15 |
| US-16 | As an operator, I want observable, recoverable deployment so that I can diagnose failures and restore service. | Must | 8 | 7 | FR-19; NFR-07, NFR-12, NFR-14 |
| US-17 | As a developer, I want a held-out quality and safety report so that release claims are backed by evidence. | Must | 8 | 8 | FR-20; NFR-01–05, NFR-13 |
| US-18 | As a portfolio reviewer, I want a clear demo and limitations so that I can assess the engineering decisions. | Must | 3 | 8 | Project release gates |
| US-19 | As an analyst, I want a chart for aggregate results so that trends are easier to see. | Should | 3 | Deferred | FR-21 |

## Acceptance criteria

### US-01 — Feasibility

- Given the parser candidate, adversarial and supported SQL cases produce recorded expected outcomes.
- Given available hardware/providers, comparison records model IDs, memory, accuracy, latency and cost assumptions.
- Decisions identify supported SQL subset, chosen parser/runtime and remaining risks. No execution implementation begins before safety feasibility is established.

### US-02 — Foundation

- A clean checkout follows documented setup and runs the frontend, API and synthetic DB.
- Shared contracts reject malformed requests; formatting, linting, type checking and core tests run in CI.
- No credentials are committed; example environment values are placeholders.

### US-03 — Identity

- Unauthenticated API requests fail and expired sessions require reauthentication.
- Analyst A cannot fetch, execute, export or delete analyst B's artifacts by guessing IDs.
- Administrator actions enforce roles on the server, not only in the UI.

### US-04 — Data setup

- Seed data includes nulls, ties, canceled orders and enough records for performance tests.
- Execution credentials cannot write, create temporary objects or use unsafe routines; migration credentials are separate.
- Fixture recreation and application metadata migrations are independently documented.

### US-05 — Grounding

- Context includes only approved schema objects and glossary versions.
- Referencing a hidden or nonexistent object produces a stable finding.
- Relative dates use a recorded timezone and business definitions are available to the user.

### US-06 — Generation

- A supported English question produces schema-valid structured output from either adapter.
- Malformed output, oversized input and provider failure produce safe states and bounded retries.
- SQL and version metadata are stored as an owned artifact; no database execution occurs during generation except bounded non-executing plan inspection after safety checks.

### US-07 — Clarification

- An undefined “best” metric or missing necessary period triggers a specific clarification.
- A clarified submission retains relevant context and passes the full pipeline as a new artifact.
- Unsupported data requests abstain without inventing fields or silently changing the question.

### US-08 — Providers

- Local-only policy produces no Groq calls, including on Ollama failure.
- API keys remain backend-only; approved cloud payloads exclude rows and unapproved metadata.
- Budget exhaustion stops cloud generation with an actionable message.

### US-09 — Guardrails

- Nested writes, multi-statements, unapproved functions, system catalogs and unknown nodes are blocked.
- Aliases, CTE scopes and all query branches are recursively resolved.
- Normalization and row-cap transformation trigger another complete validation pass.

### US-10 — Execution

- Only a server-stored, owned, current artifact reaches the restricted executor.
- Slow or oversized queries honor statement, lock, row, byte and concurrency limits.
- Timeout or cancellation rolls back and releases/discards the connection correctly; DB writes fail independently of parser validation.

### US-11 — Meaning

- Wrong aggregation, missing date filter, wrong status and duplicate-producing join fixtures produce findings.
- Critical unresolved mismatch blocks execution; repair attempts do not weaken safety policy.
- An empty valid result remains distinguishable from a failed query.

### US-12 — Confidence

- Score components, unavailable evidence, versions and warnings appear in the response and UI.
- A high score cannot override policy or schema rejection.
- Development-set tuning and holdout evaluation report wrong-answer rate and coverage; uncalibrated scores are labeled heuristic.

### US-13 — Preview and Run

- SQL, parameters, interpreted period and assumptions are visible before Run.
- Client SQL replacement, expired artifacts and changed policy/schema versions are rejected.
- Medium-confidence acknowledgement is supported only for eligible queries; repeated submission uses idempotency protection.

### US-14 — Results

- Tables distinguish null, empty, failed, timed-out and truncated states, preserving returned types.
- Export checks execution ownership and uses the same bounded data; formula-like cell values are neutralized.
- Keyboard and screen-reader checks pass the main question → preview → results journey.

### US-15 — History and feedback

- History is paginated and owner-filtered; expired results cannot be retrieved or exported.
- Correct/incorrect feedback links to the artifact but does not rewrite evaluation truth.
- Retention jobs delete eligible history and ephemeral results according to policy.

### US-16 — Operations

- Deployment runs as a non-root process with protected secrets, health checks and restricted connectivity.
- Injected provider/DB failures generate correlated redacted telemetry and useful alerts.
- Application backup restoration and rollback are demonstrated and timed.

### US-17 — Evaluation

- Holdout remains separate from tuning data; reference results are human reviewed and fixture variants are used.
- Report includes safety cases, semantic accuracy, refusal quality, confidence coverage/errors, latency and known failures.
- Release gates pass or the build remains unreleased with explicit outstanding fixes.

### US-18 — Demonstration

- Reproducible demo covers successful analytics, ambiguity, hallucination and destructive requests.
- Setup guide, architecture rationale, evaluation evidence and limitations are included.
- Screenshots/video use synthetic data and contain no secrets.

## Shared definition of done

Acceptance criteria pass; relevant requirement links are verified; contracts and documentation match behavior; security-sensitive code is reviewed; lint/type/test/build checks pass; benchmark changes record versions; telemetry reveals no sensitive payload; no critical finding remains. Demo-only shortcuts must not bypass policy. Deferred US-19 is not part of the MVP gate.
