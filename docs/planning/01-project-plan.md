# Project plan

## Objective

Build an English-to-SQL analytics interface that generates PostgreSQL queries, prevents unauthorized or destructive execution, detects schema hallucinations and likely semantic mismatches, and presents actual database results with an explained confidence score.

Example journey: ask “Which five products generated the most revenue last month?” → resolve the business definition and dates → generate SQL → verify safety and intent → show SQL and warnings → user runs the validated query → display products, revenue, evidence, and any result limits.

## Users and scope

Primary user: an analyst who understands business questions but cannot comfortably write SQL. Secondary user: an administrator who maintains approved data access and provider policy. A developer/evaluator maintains the benchmark and operational evidence.

MVP includes:

- One approved PostgreSQL connection and synthetic ecommerce dataset: customers, products, orders, order items, and categories.
- Schema metadata and glossary grounded generation; simple joins, filtering, grouping, aggregates, sorting, and top-N queries.
- Clarification for undefined metrics, ambiguous date ranges, or unsupported questions.
- Local Ollama and optional Groq adapters with identical application response contracts.
- Layered SQL policy, bounded execution, semantic verification, confidence evidence, history, feedback, and CSV export.
- Authentication, server-side ownership checks, privacy controls, automated evaluation, and deployment evidence.

Deferred: arbitrary database connections, other SQL dialects, write operations, uploading customer databases, natural-language database administration, autonomous tool loops, fine-tuning, vector search, conversational follow-ups, charts, multi-tenant enterprise access, and claims of formal compliance certification.

## Delivery phases

| Phase | Sprints | Outcome |
| --- | --- | --- |
| Prove feasibility | 1 | Threat model, parser proof, model comparison, benchmark, chosen defaults |
| Establish foundation | 2 | Fastify/React workspace, contracts, auth, fixture DB, local CI |
| Generate grounded SQL | 3 | Schema context, glossary, provider adapters, clarification flow |
| Enforce safety | 4 | Recursive AST policy, database restrictions, bounded executor |
| Assess correctness | 5 | Intent verifier, confidence evidence, refusal and regression evaluations |
| Complete the experience | 6 | Integrated SQL preview, results, history, export, feedback |
| Operate reliably | 7 | Deployment, telemetry, recovery, performance and privacy checks |
| Deliver evidence | 8 | Holdout evaluation, adversarial review, fixes, demo and release docs |

## Working rules

Build a modular monolith first. Keep generation separate from execution. All executable SQL must pass server-side validation immediately before use. Use synthetic data until policies and access controls are demonstrated. Pin model, prompt, schema, parser, and policy versions so failures are reproducible.

Do not add a repair loop until the original path is safe. Permit at most one regeneration for a schema/semantic failure, revalidate from the beginning, and never relax policy after a rejection. Provider failures do not silently transfer a private request to Groq.

## Success and release gates

- All curated destructive and unauthorized test cases are blocked before execution; database privileges independently prevent writes.
- At least 85% result-equivalent accuracy on an unseen, unambiguous, in-scope benchmark; report sample count, model version, and exceptions.
- At least 90% refusal/clarification recall on a separate curated unsupported or ambiguous set; also report false refusals on answerable questions.
- High-confidence incorrect-answer rate at most 5% on the held-out labeled set, with sample counts and statistical uncertainty. Reduce auto-eligible coverage when this gate fails.
- Meet the latency and reliability targets in NFRs on the declared test environment.
- Demonstrate a successful query, a nonexistent-column rejection, a destructive-query rejection, an ambiguous question, and a plausible-but-wrong aggregation caught by validation.
- No critical unresolved security finding; backup restoration and rollback demonstrated.

These are proposed acceptance targets, not current performance results.

## Risks and responses

| Risk | Response | Decision gate |
| --- | --- | --- |
| Valid SQL answers the wrong question | Intent slots, curated metric definitions, verifier, abstention, result-equivalence evaluation | Sprint 5 |
| Parser misses dangerous nested syntax | Default-deny supported subset, AST corpus, independent restricted role | Sprints 1 and 4 |
| SELECT invokes a dangerous function | Allowlist functions and approved relations; restrict function execution and extensions | Sprint 4 |
| Local model exceeds hardware budget | Benchmark several model sizes; record warm/cold latency and memory | Sprint 1 |
| Cloud leaks schema or user-sensitive text | Explicit provider policy, approved metadata, redaction; no result rows sent | Sprints 3 and 7 |
| Scope expands faster than solo capacity | Protect PostgreSQL-only scope; re-estimate velocity each sprint | Every review |
| Confidence becomes misleading | Publish evidence and limitations; tune on development set, evaluate once on holdout | Sprints 5 and 8 |

## Planning checkpoints

Before coding: confirm or accept provider interpretation and MVP scope. After Sprint 1: select parser, models, runtime and hardware envelope. Before public release: assess benchmark results, operational gates and known limitations. Later enhancements require an explicit scope update.
