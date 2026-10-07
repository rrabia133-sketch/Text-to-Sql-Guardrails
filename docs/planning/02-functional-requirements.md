# Functional requirements

Priority: Must = MVP release requirement; Should = optional after Must items meet gates.

| ID | Priority | Requirement | Acceptance check |
| --- | --- | --- | --- |
| FR-01 | Must | Authenticate users and authorize analyst/admin actions server-side. | Unauthenticated calls fail; analysts cannot change provider or data-access policy. |
| FR-02 | Must | Use one administrator-provisioned PostgreSQL analytics connection. | Analyst supplies no host, credentials, or connection string; execution role passes privilege tests. |
| FR-03 | Must | Discover only approved tables/views, columns, types, and relationships; maintain a versioned business glossary. | Hidden relations and sensitive columns are absent from model context and rejected by validation. |
| FR-04 | Must | Accept English questions with length limits and a request identifier. | Empty and oversized questions receive clear validation errors; valid submissions enter the generation state. |
| FR-05 | Must | Generate schema-grounded PostgreSQL using interchangeable Ollama/Groq adapters. | Both adapters emit the same validated contract; provider/model versions are recorded. |
| FR-06 | Must | Request clarification rather than inventing missing definitions. | “Best customers” asks which metric; undefined revenue policy or time period is visible before generation. |
| FR-07 | Must | Parse and recursively validate one read-only query against an approved AST subset. | Multi-statements, modifying CTEs, SELECT INTO, COPY, locking, unapproved functions, and unknown AST nodes fail closed. |
| FR-08 | Must | Resolve relation and column references against approved schema metadata. | Invented names, hidden columns, invalid aliases and unsupported joins return explainable findings. |
| FR-09 | Must | Bound query cost and execution time using policy and database controls. | Statement/lock deadlines, result row/byte caps, and concurrency limits apply; costly plans are rejected. |
| FR-10 | Must | Check SQL against the question's metric, filters, time range, joins, grouping, order, and requested granularity. | Missing date filter or incorrect aggregation produces a mismatch; unverifiable meaning causes abstention. |
| FR-11 | Must | Provide a 0–100 confidence score with component evidence, warnings, and policy/version metadata. | Safety failure cannot be overridden by a high score; UI labels the score as a heuristic until calibrated. |
| FR-12 | Must | Preview SQL and assumptions before a separate Run action. | Client cannot substitute SQL; executing an expired, altered, unauthorized, or stale artifact is denied. |
| FR-13 | Must | Execute validated SQL using restricted credentials and a read-only transaction. | Write attempts fail independently at the DB; failure cancels work and releases the connection. |
| FR-14 | Must | Display actual rows, types, count, timing, empty states, and truncation information. | Empty results are not automatically treated as an incorrect answer; partial results are visibly marked. |
| FR-15 | Must | Export only the authorized returned result subset as CSV. | Caps and truncation are preserved; spreadsheet formula injection is neutralized and documented. |
| FR-16 | Must | Store an owned query history and collect correct/incorrect feedback. | Users cannot access others' artifacts/results; feedback is separate from ground-truth evaluation labels. |
| FR-17 | Must | Allow administratively approved provider selection with a private local-only mode. | Local-only requests cannot call Groq; provider unavailability returns a clear error, not silent fallback. |
| FR-18 | Must | Handle malformed output, provider outage, timeout, and validation failure safely. | At most one regeneration and bounded transient retries; no partial SQL is executed. |
| FR-19 | Must | Audit execution decisions without logging secrets or result rows. | Events identify request, user, provider, versions, policy outcome, SQL hash, timings, and reason codes. |
| FR-20 | Must | Run reproducible evaluation for answer quality, hallucination, safety, and confidence. | A report separates development and holdout sets, result equivalence, refusal quality, and confidence errors. |
| FR-21 | Should | Present aggregate results as a chart. | Chart uses only returned typed columns and shows truncation warnings. |

## Boundary rules

No SQL editing or arbitrary SQL execution endpoint in the MVP. A clarified question creates a new artifact; it cannot mutate the validated SQL silently. A user acknowledgement may permit medium-confidence queries that pass safety and contain no unresolved semantic mismatch, but cannot override a blocked query.

Cloud generation receives approved metadata and the minimized question only. Verification uses SQL, intent, and metadata; it must not transmit result rows. Result explanations are based on returned data and approved deterministic summaries, not invented model facts.

Reference behavior: “Delete last year's orders” is blocked; “Revenue by month” asks for missing business/date definitions when needed; “Top five products last month” validates revenue expression, completed-order status, calendar timezone, grouping and sort direction.
