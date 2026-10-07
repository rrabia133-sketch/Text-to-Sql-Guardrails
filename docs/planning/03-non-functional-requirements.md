# Non-functional requirements

All numbers are initial engineering targets. Sprint 1 records hardware, model, fixture size, concurrency, network conditions, and warm/cold behavior; adjust impractical targets through a documented decision rather than silently weakening them.

| ID | Quality | Target and verification |
| --- | --- | --- |
| NFR-01 | Safety | Block 100% of the curated dangerous SQL corpus before execution; independent DB privilege tests pass. This measures corpus coverage, not universal safety. |
| NFR-02 | Semantic quality | At least 85% result-equivalent accuracy on at least 100 unseen unambiguous in-scope questions. Separately report schema/semantic failure categories and confidence intervals. |
| NFR-03 | Abstention | On at least 40 held-out ambiguous/unsupported cases, refusal/clarification recall at least 90%; answerable-query false refusals at most 15%. |
| NFR-04 | Confidence | High-confidence wrong-answer rate at most 5%; report high-confidence coverage, denominator, uncertainty and reliability bins. Score is not a probability before calibration evidence exists. |
| NFR-05 | Latency | Target warm p95 generation + validation: Groq 15 seconds, Ollama 45 seconds; target ordinary DB execution p95 2 seconds on a 100,000-order fixture. Exclude user think time; record failures as well as successful latency. |
| NFR-06 | Resource bounds | DB statement timeout 5 seconds, lock timeout 1 second, output at most 500 rows and 1 MiB, 2 active queries/user and 10 global. Generation deadline 60 seconds; overall request budget 90 seconds including retries. |
| NFR-07 | Reliability | Staged hosted-demo target 99% monthly API availability, measured by synthetic probes. Dependencies and degraded provider states are reported separately; no contractual SLA. |
| NFR-08 | Privacy | No secrets, raw rows, or raw sensitive questions in telemetry; approved schema metadata only for cloud. Default local-only policy until Groq is enabled. Verify using outbound-payload and log inspections. |
| NFR-09 | Access control | Every artifact/history/result endpoint checks ownership; analytics role has no writes, temp creation, unsafe function rights or administrative privileges. Cross-user and role tests are release gates. |
| NFR-10 | Accessibility | Target WCAG 2.2 AA for primary flows; keyboard navigation, focus management, labeled inputs, accessible status announcements and non-color confidence cues verified manually and with automated checks. |
| NFR-11 | Maintainability | TypeScript strict mode, validated boundary contracts, modular dependencies, pinned lockfile; domain policy tests cover supported and rejected AST constructs. Coverage metrics support review rather than substituting for behavioral tests. |
| NFR-12 | Observability | Correlate generation, validation, execution and audit records by request ID; expose latency, rejections, timeout, provider errors, cost estimates and confidence distribution. Verify with an injected failure. |
| NFR-13 | Reproducibility | Each evaluation records dataset/fixture hash, glossary/schema version, provider/model ID, prompt, policy, parser version and configuration; reruns distinguish model variability from regressions. |
| NFR-14 | Recovery | For application metadata, proposed RPO 24 hours and RTO 4 hours; encrypted daily backups and a tested restoration runbook. Analytics source recovery belongs to its owner; synthetic fixture can be recreated. |
| NFR-15 | Retention | Proposed history retention 30 days and audit retention 90 days; result payloads are ephemeral, at most 15 minutes; delete/export controls follow ownership. Confirm deployment policy before release. |
| NFR-16 | Cost | Enforce configurable per-user daily generation and global cloud budget; alert at 80% and stop new cloud requests at 100%. Sprint 1 estimates cost per accepted answer; select the actual currency budget before enabling hosted inference. |

## Verification environments

Use synthetic data in local, CI and staging. Performance tests run on a recorded fixed fixture with one and ten concurrent users. CI uses a fake provider for determinism; live model tests run separately and publish variability. Security tests exercise the actual configured PostgreSQL role, not just a mocked executor.

High-confidence coverage must accompany accuracy: refusing everything cannot satisfy the product-quality gate. Feedback cannot be used to tune the final holdout after it has been evaluated without creating a new holdout set.
