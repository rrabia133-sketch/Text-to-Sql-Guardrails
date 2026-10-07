# DevOps document and task backlog

## Environment strategy

Local: Docker Compose for synthetic analytics/app databases, Fastify and React development processes, optional privately reachable Ollama. CI: disposable fixture databases and deterministic fake LLM. Staging: production-like topology with synthetic data and protected credentials. Public demo/release: immutable tested artifacts, no real customer data, approved provider settings and enforced budgets.

Do not expose Ollama or PostgreSQL directly to the public internet. Frontend calls the backend over HTTPS. Cloud keys and DB secrets are runtime server configuration; frontend build variables are public and cannot hold secrets.

## Proposed delivery pipeline

1. PR checks: formatting, lint, type checks, unit tests, real-DB integration/policy tests, secret scan, dependency scan and production builds.
2. Browser checks: main journey, access control, confidence/blocked states and CSV behavior using a fake provider.
3. Evaluation checks: deterministic policy corpus every PR; development semantic regression on relevant changes. Live-provider benchmark is scheduled/manual, budgeted and separate from deterministic CI.
4. Main branch: build immutable non-root container, generate SBOM, scan image, tag with commit hash, deploy to staging and run smoke probes.
5. Release: inspect security findings, evaluation report and operational gates; promote the same artifact under protected environment controls. Provider/model and prompt changes require evaluation even when application code is unchanged.
6. Rollback: return to prior container/config; compatible migrations use expand/contract. Never auto-reverse a potentially destructive migration.

This is a proposed workflow. No pipeline or deployment is created by the planning pack.

## Tasks

| ID | Sprint | Role | Task and completion evidence |
| --- | --- | --- | --- |
| DO-01 | 1 | Developer/security | Record runtime, hardware, provider policy, threat model and cost assumptions; decisions reviewed. |
| DO-02 | 2 | Developer | Define workspace scripts, locked dependencies and placeholder environment contract; clean-checkout setup verified. |
| DO-03 | 2 | Backend/operator | Define separate analytics/app/migration roles and reproducible fixture; real privilege-denial tests pass. |
| DO-04 | 2 | Operator | Establish CI lint/type/test/build and secret scanning; intentional failing change stops the pipeline. |
| DO-05 | 3 | Backend/operator | Secure Ollama/Groq configuration, deadlines, quotas and budget ledger; cloud disabled by default and private-mode egress test passes. |
| DO-06 | 4 | Backend/operator | Configure bounded pools, timeouts, cancellation, allowlists and plan limits; stress and cleanup tests recorded. |
| DO-07 | 5 | Evaluator | Version datasets/prompts/models/policies and benchmark reports; development/holdout separation enforced. |
| DO-08 | 6 | Backend/operator | Implement retention schedules, ephemeral result cleanup and CSV policy; expiry/deletion verified. |
| DO-09 | 7 | Operator | Containerize backend, build frontend and provision private DB/network/TLS; non-root startup and connectivity verified. |
| DO-10 | 7 | Operator | Add dashboards, probes and correlated redacted logs; injected failures trigger alerts without payload disclosure. |
| DO-11 | 7 | Operator | Encrypt daily metadata backups and restore to an isolated environment; measured RPO/RTO meet targets. |
| DO-12 | 7 | Operator | Prove rollback and compatible migration process; prior image restores service without losing current metadata. |
| DO-13 | 7 | Developer/security | Run dependency/container scans, access/egress review and load test; critical findings resolved and results recorded. |
| DO-14 | 8 | Release owner | Freeze report/config, complete checklist, rehearse demo and record go/no-go; promotion blocked when gates fail. |

One developer may fill these roles. The roles identify accountability, not assumed staffing.

## Configuration and secrets

Proposed configuration categories: app/analytics database URLs (distinct); identity issuer/audience/session secret; allowed frontend origin; approved analytics schema/search path; provider mode and model IDs; private Ollama endpoint; Groq API key; policy/prompt versions; generation/execution deadlines; row/byte/concurrency/rate limits; daily cloud budget and request cap; retention periods and analytics timezone.

Validate configuration at startup. Examples contain placeholders only. Use a deployment secret store, least-privilege service identities and redacted logs. Rotate credentials, test the new credential, then revoke the old one; do not leave both active indefinitely. Disable routes safely if identity or policy validation is unavailable.

## Telemetry and alerting

Track p50/p95 latency by pipeline stage/provider, rejected AST/schema/semantic findings, refusals, execution timeout rate, pool saturation, provider failures, cloud budget, accepted-answer rate, score coverage and job retention failures. User feedback is an indicator rather than a ground-truth metric.

Proposed alerts: five consecutive failed readiness probes; timeout/error rate above 5% over ten minutes with at least twenty requests; sustained pool saturation; budget at 80%/100%; backup or retention failure. Tune to demo traffic so low-volume noise does not masquerade as a meaningful incident rate.

## Runbooks to create during implementation

- Provider outage: identify dependency, stop affected calls, preserve local-only policy, communicate degraded availability and recover without silent cloud fallback.
- Slow database: inspect redacted request IDs and plans, cancel active work, check locks/pool health and tighten policy after review.
- Suspected unsafe execution: disable execution, preserve audit hashes/versions, revoke compromised credentials, investigate under restricted access and re-run adversarial checks before restoration.
- Secret exposure: revoke/rotate, remove exposure source, audit use and verify the new configuration.
- Restore/rollback: select backup/image, restore in isolation, verify ownership/retention and smoke queries, then reopen traffic.
- Model/prompt regression: pin the previous validated configuration; evaluate replacement against development and untouched holdout evidence.

## Release checklist

All Must stories complete; CI and scans pass; real-DB privilege/adversarial suite passes; quality/confidence targets documented; private routing/redaction demonstrated; migration/backup/rollback tested; provider budget configured; unresolved limitations published; synthetic demo and setup instructions reproducible.
