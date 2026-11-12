# Text-to-SQL Project Review: Simple Questions and Answers

Your project is an **AI assistant that turns everyday questions into SQL, checks the SQL, and shows database results.** Its main focus is helping users ask questions while protecting the database.

This review covers the frontend, backend, shared contracts, database scripts, security checks, and sprint documents.

Verification performed on 6 November 2026: **558 tests passed, 19 were skipped, and TypeScript checks passed.** Database-dependent checks were skipped because PostgreSQL was unavailable. The frontend currently has no automated tests. These results describe the project at the time of this review.

Use the following simple questions and answers for a project presentation or viva.

## Project purpose and workflow

### 1. What is this project?

It is a Text-to-SQL application. Users ask questions in normal language, and AI creates SQL to find the answer from a database.

### 2. What problem does it solve?

People who do not know SQL can explore data. For example, they can ask, “What was our revenue last month?”

### 3. What is the main idea behind the project?

**AI suggests the query; application rules decide whether it can run.** AI output is checked because it can contain mistakes.

### 4. How does the project work?

1. The user enters a question.
2. The system asks for clarification when needed.
3. AI generates SQL using schema and business definitions.
4. The backend checks safety and meaning.
5. The user sees a preview and confidence score.
6. An allowed query runs in a read-only database transaction.
7. Results appear in a table.

### 5. What data does it use?

It uses a synthetic e-commerce database with four tables:

| Table | Purpose |
|---|---|
| `customers` | Customer details |
| `products` | Product details |
| `orders` | Order details and status |
| `order_items` | Products and quantities within each order |

### 6. Why use synthetic data?

It lets developers test business questions without using real customer information.

## Technology and architecture

### 7. Which technologies are used, and why?

| Technology | Why this project uses it |
|---|---|
| React | Builds the interactive user interface |
| Vite | Runs the frontend during development and creates its production build |
| TypeScript | Finds many programming mistakes before the app runs |
| Node.js | Runs the backend JavaScript code |
| Fastify | Handles API requests and backend plugins |
| PostgreSQL | Stores application information and business data |
| Zod | Checks whether data has the expected structure |
| `pgsql-ast-parser` | Converts SQL into a structure that security rules can inspect |
| Ollama | Runs a local AI model |
| Groq | Provides access to a cloud AI model |
| Docker Compose | Defines a repeatable local database setup |

The frontend package currently declares **React 19**, although some documents describe React 18.

### 8. What is a monorepo, and why use it here?

A monorepo keeps related applications in one repository. Here, the frontend, backend, and shared contracts can be developed and checked together.

### 9. What architecture does the backend use?

It uses a **modular monolith**: one backend application divided into modules such as authentication, generation, guardrails, execution, and history. This keeps responsibilities clear without running many separate services.

### 10. Why separate frontend and backend?

The frontend handles user interaction. The backend controls AI calls, database access, and security decisions. Database credentials stay on the server.

### 11. What is an API in this project?

An API is the communication point between the browser and backend. For example, the browser sends a question to a generation endpoint and receives a query preview.

### 12. What is contract-first development?

It means defining shared request and response formats before implementing them. This project keeps those definitions in `packages/contracts`.

### 13. Why use both TypeScript and Zod?

TypeScript checks code during development. Zod checks actual data when the application runs, including API input and AI output.

### 14. What is dependency injection, and why is it used?

It means passing a service into another component instead of always creating it internally. Tests can pass a fake AI provider or database service, making behavior easier to test.

## AI and understanding the question

### 15. What is an LLM’s role here?

An LLM, or large language model, reads the question and proposes SQL. It does not directly control database execution.

### 16. Does this project train its own AI model?

The reviewed implementation calls existing models through Ollama or Groq. It does not contain a model-training pipeline.

### 17. What is schema grounding?

It means giving AI approved table names, column names, and relationships. This helps it use the real database structure instead of inventing fields.

### 18. What is prompt engineering here?

The backend builds instructions containing the schema, business glossary, date context, and user question. These instructions guide the model toward useful SQL.

### 19. What is a business glossary, and why is it needed?

It defines business terms consistently. For example, this project defines recognized revenue as:

`SUM(quantity × unit_price)`

It includes completed and shipped orders, while excluding pending and cancelled orders.

### 20. What is intent extraction?

It breaks the question into parts:

- **Metric:** what to measure, such as revenue.
- **Grouping:** how to divide the answer, such as by product.
- **Filters:** which records to include.
- **Time period:** when the records occurred.
- **Sorting and limit:** how to order and restrict the answer.

The current extractor mainly uses keyword and pattern rules.

### 21. Why ask clarification questions?

Some questions have several meanings. “Who are our best customers?” could mean customers with the highest spending or the most orders. Clarification helps avoid guessing.

### 22. Why resolve dates before generating SQL?

Phrases such as “last month” need exact start and end dates. Date resolution makes the requested period clearer.

### 23. Why support local and cloud AI?

Local AI gives a deployment more control over where inference happens. Cloud AI provides another inference option. The provider router selects an allowed provider.

### 24. What do local, cloud, and hybrid modes mean?

| Mode | Intended behavior |
|---|---|
| Local | Use Ollama; refuse cloud generation |
| Cloud | Use Groq |
| Hybrid | Allow both, with local preferred when no provider is requested |

Local generation fails if Ollama is unavailable instead of silently switching to cloud. A separate provider-status issue is noted in the review findings below.

### 25. Why use a common provider interface?

It gives Ollama and Groq the same calling structure. The rest of the application can work with either provider without duplicating the full generation workflow.

### 26. Why validate AI output and limit retries?

AI can return invalid JSON or missing fields. Validation catches those problems. Limited retries prevent repeated failures from consuming unlimited time and cloud budget.

## SQL safety and meaning

### 27. What is an AST?

AST means **Abstract Syntax Tree**. It represents SQL as structured parts, such as tables, functions, filters, and joins. The backend can inspect those parts.

### 28. Why inspect an AST instead of only searching for dangerous words?

SQL can hide operations inside nested queries or use comments and unusual formatting. Structured inspection gives the application more information than a simple word search.

### 29. What is recursive validation?

It checks nested parts of the SQL as well as the outer query. This helps detect forbidden operations hidden inside smaller queries.

### 30. What is an allowlist?

An allowlist names what is permitted. This project checks approved tables, columns, functions, and SQL structures. Unapproved access is rejected.

### 31. What does “fail closed” mean?

If the system cannot safely understand or approve a query, it refuses it. It does not assume that an uncertain query is safe.

### 32. What is defense in depth?

It means using several protection layers. Here, SQL checks, ownership checks, database permissions, read-only transactions, timeouts, and result limits work together.

### 33. What is the difference between safety validation and semantic validation?

Safety validation asks, **“Is this query allowed?”**

Semantic validation asks, **“Does this query match the user’s question?”**

A query can be read-only and still calculate the wrong answer.

### 34. What is join fanout, and why check it?

A join can repeat one record across several rows. For example, joining an order to its items repeats the order once per item. A careless count can then overcount orders.

### 35. What is the confidence score?

It is a rule-based score showing the available evidence that SQL matches the question.

| Component | Weight |
|---|---:|
| Intent agreement | 35% |
| Business glossary and join evidence | 30% |
| Verifier agreement | 20% |
| Candidate stability | 15% |

**It is not a statistical probability.** A score of 85 does not prove an 85% chance of correctness.

### 36. What do the confidence bands mean?

| Band | Meaning |
|---|---|
| HIGH: 85–100 | Eligible for execution if other checks pass |
| REVIEW: 65–84 | Requires acknowledgement before execution |
| BLOCKED: below 65 | Execution refused |

Critical safety or meaning problems block execution even when the numerical score is high.

### 37. Does every generated query use all four confidence components?

No. The normal generation route currently uses a deterministic verifier fallback and does not supply candidate-stability evidence. Missing stability evidence contributes zero points.

### 38. What is automatic repair?

The backend can request one repair attempt for supported meaning problems, such as a missing date filter. The repaired query must pass validation again.

## Database and execution concepts

### 39. Why use two databases?

`app_db` stores users, sessions, query records, and audit information. `analytics_db` stores the business data being queried.

Separate databases and roles help keep analytical queries away from application metadata. They do not automatically mean separate physical servers.

### 40. What is least privilege?

Each database role receives only the permissions needed for its job. The analytical role is intended to read business data without changing it.

### 41. Why use a read-only transaction?

It adds a database-enforced restriction against changes. The executor explicitly starts a read-only transaction before running analytical SQL.

### 42. Why use connection pools, indexes, and foreign keys?

| Concept | Reason |
|---|---|
| Connection pool | Reuses database connections |
| Index | Helps the database find matching records efficiently |
| Foreign key | Keeps relationships valid, such as an order’s customer |
| Transaction | Groups database work within a controlled boundary |

### 43. What is a query artifact?

It is the server’s saved query record, including SQL, owner, status, and expiry. Execution refers to this saved record instead of accepting new SQL from the browser.

### 44. Why separate preview from execution?

Users can inspect SQL, assumptions, and warnings before running it. Generating a query does not automatically execute it.

### 45. Why use ownership checks and expiry?

Ownership checks prevent one user from executing another user’s query record. The 15-minute preview expiry limits how long an old preview remains usable.

### 46. Why use timeouts, row limits, and concurrency limits?

They control resource use:

- The executor defaults to a five-second statement timeout.
- Results have a maximum of 500 rows and a 1 MiB limit.
- The concurrency manager defaults to two active queries per user and ten overall.
- SQL normalization also applies a smaller query-level row cap.

### 47. What are caching and idempotency?

Caching temporarily keeps results for retrieval. Idempotency allows a repeated request with the same key to return an existing result instead of executing again.

The current cache and concurrency tracking are held in the backend process’s memory.

### 48. What authentication concept is used?

The project uses server-side sessions and signed cookies. However, the current login accepts an existing username or email without checking a password, so it should be described as **demo authentication**.

### 49. Why sanitize CSV exports?

Spreadsheet applications can interpret values beginning with characters such as `=` as formulas. The exporter prefixes risky values with a single quote so they are treated as text.

### 50. Why keep history, feedback, audit logs, and retention rules?

History helps users revisit queries. Feedback records whether an answer was useful. Audit logs record actions for investigation. Retention rules limit how long stored information remains.

### 51. What testing concepts are used?

| Test type | Purpose |
|---|---|
| Unit | Checks one service or rule |
| Integration | Checks components working together |
| Security | Tries forbidden operations and access |
| Benchmark | Evaluates behavior across prepared cases |

Passing these tests provides evidence about covered cases; it does not guarantee every real-world query will be correct.

## Important findings from the review

These points should be addressed before describing the application as production-ready:

- **Local-mode privacy gap:** the provider-status method calls Groq’s health check even in local mode. With a configured key, that can make an external request. See [provider.router.ts](backend/src/modules/providers/provider.router.ts).
- **Incomplete hash protection:** the artifact gate calculates a hash from the current SQL, but does not compare it against an independently saved original hash. The normal execution route supplies neither a client hash nor client SQL. See [artifact-gate.ts](backend/src/modules/execution/artifact-gate.ts).
- **Demo login:** knowing an existing username or email is enough to create a session. See [auth.routes.ts](backend/src/modules/auth/auth.routes.ts).
- **Schema mismatch:** intent extraction can produce `customers.state`, while the current schema provides `customers.region`. See [intent-extractor.service.ts](backend/src/modules/intent/intent-extractor.service.ts).
- **Verification limits:** 19 tests were skipped, frontend automated tests are absent, and several tests use mocks. The passing suite does not establish live database or live AI performance.

## Short project introduction for a presentation

> My project helps users ask database questions in normal language. AI creates SQL, and the backend checks its safety and meaning. The user reviews the query before execution. Read-only permissions, ownership checks, timeouts, and result limits help protect the database.
