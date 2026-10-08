# Development plan — React frontend and Node.js backend

Stories: US-01. DevOps: DO-01. Status: work not started.

Follow these steps in order. Build each part yourself, run its check, and then move to the next step. All files mentioned below are planned files you will create; saving this plan does not create the experiments.

Use `frontend/` for React + TypeScript and `backend/` for Node.js + Fastify + TypeScript. This naming replaces the proposed `apps/web` and `apps/api` names for this guide.

Steps 1–12 cover Sprint 1: develop backend experiments and prove feasibility. Steps 13–16 explain how to start the frontend and backend application in Sprint 2. Creating the two top-level folders can happen immediately; application execution development still depends on the safety proof.

## How the frontend and backend work together

```text
React frontend -> Node.js/Fastify backend -> AI provider
                                        -> SQL validation
                                        -> restricted PostgreSQL connection
```

The frontend collects questions and displays responses. The backend owns provider calls, validation, database access and secrets. React never connects directly to PostgreSQL or receives provider credentials. A Generate action produces a preview; a later Run action requires the completed execution safeguards.

## Step 1 — Check your tools and machine

Open PowerShell in your project folder. Run these commands separately:

```powershell
node --version
npm --version
git --version
docker --version
docker compose version
ollama --version
```

Create `docs/sprint-1/environment.md`. Record the command results, missing tools, CPU, RAM, GPU and GPU memory. Check that Docker can start. Record whether cloud access is permitted, your experiment spending cap with currency, possible deployment location and monthly budget.

Install missing tools from official instructions before the step that needs them. Verify current supported runtime versions when choosing them. Never record credentials in documentation.

**Done when:** you know which tools are available and the limits of your machine and budget.

## Step 2 — Create frontend and backend folders

Create these folders:

```text
frontend/                     # React app setup in Step 13
backend/
  spikes/sprint-1/             # Isolated Sprint 1 experiment project
    src/
    sql/
    cases/development/
    cases/holdout/
    cases/safety/
    results/
docs/sprint-1/
  decisions/
```

Initialize the experiment project:

```powershell
Set-Location 'D:\React-project\Text-to-SQL Interface\backend\spikes\sprint-1'
npm init -y
```

Use TypeScript for the experiment to match the proposed application stack. Add TypeScript and a runner, then a PostgreSQL driver when needed. Choose the parser in Step 7 before installing it. Keep the lockfile.

Update the root `.gitignore`, preserving existing rules, to ignore `node_modules/`, real `.env` files and secret files. Use `.env.example` for placeholders.

Create `docs/sprint-1/scope.md`. Confirm or revise the starting scope: synthetic ecommerce data, PostgreSQL only, read-only analytics, SQL preview before Run, no restricted-data access, local inference by default and explicitly enabled cloud inference. Write three example user questions.

Keep the experiment package separate from the later backend application package. Paths such as `src/check-sql.ts` in Steps 3–10 are relative to `backend/spikes/sprint-1/`, not to the application source folder.

**Done when:** `frontend/` and `backend/` exist, the backend experiment package exists, and scope is clear.

## Step 3 — Design the data and business meanings

Create `docs/sprint-1/data-design.md`. Start with these proposed tables:

| Table | Example columns |
| --- | --- |
| customers | id, name, region, created_at |
| products | id, name, category |
| orders | id, customer_id, status, ordered_at |
| order_items | id, order_id, product_id, quantity, unit_price |

Choose types, keys, relationships and nullability. Use appropriate decimal types for money. Explain allowed joins and whether they can duplicate totals.

Create `docs/sprint-1/glossary.md`. Define revenue, eligible order statuses, active customer, timezone, date periods and currency. Explain whether tax, refunds and discounts are represented. Fix the reference date used in tests.

**Done when:** you can explain the relationships and calculate an example revenue answer by hand.

## Step 4 — Build a disposable PostgreSQL fixture

Create these files under `backend/spikes/sprint-1/`:

| File | What to put in it |
| --- | --- |
| compose.yaml | Local PostgreSQL service, pinned supported version, loopback-only port and local storage |
| .env.example | Placeholder credentials and connection settings |
| sql/01-schema.sql | Table definitions, primary keys and foreign keys |
| sql/02-seed-small.sql | Small deterministic synthetic dataset |
| sql/03-seed-performance.sql | Reproducible larger dataset, initially targeting 100,000 orders |

Include canceled orders, customers without orders, nulls where allowed, tied totals and boundary dates. Keep the small and large fixtures separately reproducible.

From the experiment folder, run:

```powershell
docker compose up -d
docker compose ps
```

Apply schema and seed scripts using the setup credential. Record exact setup commands. Manually run queries for total revenue, monthly revenue, top customers, products without sales and an empty date period. Save reference queries/results in `cases/development/` and compare them with hand calculations.

**Done when:** reference results are correct and you can recreate the fixture.

## Step 5 — Define rules and threats before building the checker

Create `docs/sprint-1/query-rules.md` with allowed/rejected SQL examples. Start small: one SELECT, approved tables/columns, filters, approved joins, selected aggregate functions, grouping, sorting and bounded results. Explicitly decide whether CTEs, subqueries and other constructs are supported or rejected.

Reject writes, schema changes, multiple statements, SELECT INTO, locking clauses, restricted names, unsafe functions and unknown constructs. Specify schema, function and join allowlists. Use [the existing quality targets](../planning/03-non-functional-requirements.md) for proposed resource limits.

Create `docs/sprint-1/threat-model.md`. Draw the flow from question to model, SQL checker, restricted DB connection and results. Mark untrusted inputs, cloud transfers and credential boundaries.

Create `docs/sprint-1/risks.md` with risk, impact, control, planned test, owner and status. Include prompt injection, hidden writes, restricted reads, unsafe functions, expensive queries, exposed secrets and unintended cloud transfers.

**Done when:** each major threat has a control and a test. Rules are provisional until demonstrated.

## Step 6 — Create cases and benchmark rules

Create JSON/JSONL case files in the three `cases/` folders. Each case needs an ID, question or SQL, category, expected allow/reject/clarify outcome, reference answer where applicable and explanation.

1. Development: start with a small pilot covering filters, joins, totals, dates, empty results and ambiguous requests. Use it to debug and select models.
2. Holdout: curate independent unseen cases and freeze them for later release evaluation. Do not use them for model selection or tuning. Release targets require at least 100 unambiguous and 40 ambiguous/unsupported held-out cases.
3. Safety: include allowed controls, destructive SQL, restricted objects, unsafe functions, multiple statements and threats hidden inside nesting.

Create `docs/sprint-1/benchmark.md` before measuring candidates. Specify fixture/schema/glossary versions and hashes, prompt/model settings, repetitions, cold/warm runs, concurrency, deadlines and failure handling. Define result comparison for ordering, nulls and numeric precision.

Measure result accuracy, clarification/refusal behavior, malformed output, safety outcomes, latency, memory and cost per accepted answer. Record denominators and failed attempts.

**Done when:** expected outcomes are reviewed and measurement rules are fixed before testing.

## Step 7 — Develop the parser and SQL checker experiment

Review official documentation for PostgreSQL-aware AST parsers. Choose a candidate, record its exact version and install it in the experiment project.

Create `src/parser-probe.ts` to parse SQL and show the statement types and nested AST structure. An AST is the structured representation of a query. Report malformed SQL clearly.

Create `src/check-sql.ts` in this order:

1. Require one permitted statement.
2. Recursively visit every relevant AST node.
3. Reject unsupported node types and operations.
4. Check schemas, tables, columns and functions against allowlists.
5. Resolve aliases and qualified names in the correct scope.
6. Reject ambiguous or unresolved names.
7. Return allow/reject with reasons.

Create `src/test-parser.ts` to load SQL cases and compare actual outcomes with expectations. Add a package script to run it.

Test valid aliases/joins, missing names, ambiguous columns, schema qualification, nested queries, CTEs, alias shadowing and hidden unsafe operations. Unsupported nesting must be rejected. If you rewrite SQL to add a row cap, parse and validate the rewritten SQL again. Do not rely on regular expressions or only top-level inspection.

Save commands, cases and results in `docs/sprint-1/parser-proof.md`.

**Done when:** supported controls pass, dangerous cases fail and no traversal/resolution gap remains within the chosen subset. Change the parser or narrow scope if needed.

## Step 8 — Develop independent database permission tests

Create `sql/04-roles.sql` using documentation for your PostgreSQL version. Separate setup/owner credentials from the analytics login. Permit SELECT only on approved objects. Prevent effective writes, object/schema creation, temporary creation, unsafe function execution and role escalation. Check PUBLIC grants, memberships and ownership, as well as direct grants.

Create `src/test-db-permissions.ts`. Connect as the actual analytics login and directly try approved reads plus forbidden writes, table creation, temporary objects, restricted reads, unsafe routines and privilege escalation. Handle expected errors so all cases run. Verify data/schema remain unchanged.

Run these tests directly against the disposable fixture independently of the parser. Also verify read-only transaction settings and statement/lock timeouts. Read-only mode alone does not establish containment.

Save role setup, PostgreSQL version, commands and actual outcomes in `docs/sprint-1/db-proof.md`.

**Done when:** allowed reads work and forbidden operations fail under the real analytics credential. An unexplained successful forbidden operation blocks progress.

## Step 9 — Develop the local model experiment

Choose an Ollama candidate using official documentation and your hardware limits. Record exact model ID/digest where available, license and settings. Download and run it locally.

Create `src/local-model.ts` to:

1. Load a development question.
2. Include approved schema/glossary context and query rules.
3. Request structured SQL or clarification/refusal.
4. Validate the response shape and apply a deadline.
5. Record timing and failures.
6. Pass returned SQL through the checker.

Initially inspect SQL only. After Steps 7 and 8 pass, execute accepted queries only on the synthetic fixture using the restricted credential and resource bounds. Compare results against references. Measure cold/warm latency and memory.

**Done when:** local accuracy, speed, resource use and failure behavior have been measured.

## Step 10 — Develop the cloud comparison runner

Verify current Groq models, structured-output support, quotas, privacy and pricing using official documentation. Store your key in an ignored local environment file. Explicitly enable cloud testing and enforce the experiment spending cap before calls.

Create `src/cloud-model.ts` using the same response contract as the local experiment. Send synthetic questions and approved schema context only; exclude credentials and database rows.

Create `src/compare-providers.ts` to load development cases, call each provider with comparable settings, validate output, check SQL, execute accepted queries in the restricted fixture, compare answers and save every attempt. Record latency, failures, usage and measured/estimated cost. Stop cloud calls at the cap.

Test provider failures: local-only mode must not silently call cloud. Measure a small large-fixture performance run with recorded concurrency and runtime conditions.

Write `docs/sprint-1/provider-comparison.md`. Separate measurements from projections. If a provider cannot be measured, record the blocker and continue the spike or formally narrow scope.

**Done when:** local/cloud viability has evidence and you can justify a provider/model recommendation.

## Step 11 — Record decisions from the experiments

Create short files in `docs/sprint-1/decisions/` for stack/runtime, parser/subset, provider models/privacy, database containment, deployment and budget.

For each record the problem, options, choice, evidence, drawbacks and conditions for reconsideration. Record the `frontend/` and `backend/` naming choice. React/Fastify remain proposed stack choices until recorded; the next section gives the application setup sequence once Sprint 1 passes.

Update query rules, glossary, threat model and risks based on findings. Label untested deployment assumptions honestly.

**Done when:** chosen technology and supported SQL match the evidence, and remaining risks are explicit.

## Step 12 — Verify completion before Sprint 2

Create `docs/sprint-1/exit-review.md` linking evidence for each check:

- [ ] Fixture and glossary finalized and reproducible.
- [ ] Development, holdout and safety sets curated and separated.
- [ ] Benchmark specification saved.
- [ ] Parser traversal and name resolution demonstrated.
- [ ] Database privilege containment independently demonstrated.
- [ ] Local/cloud viability measured.
- [ ] Hardware, runtime, deployment and budget assumptions recorded.
- [ ] Selected stack and supported query subset documented.
- [ ] Threat model, risks and decisions updated.
- [ ] No unresolved architectural blocker remains for safe execution.

Repeat affected checks after changing policy or privileges. Save commands, versions and results for reproduction. If a gate fails, continue the experiment or narrow scope and rerun relevant checks before execution development.

## Step 13 — Set up the React frontend (Sprint 2)

After the Sprint 1 exit review passes, open PowerShell in the empty `frontend/` folder. Verify current Vite setup instructions and its supported Node.js versions, then scaffold React with TypeScript:

```powershell
Set-Location 'D:\React-project\Text-to-SQL Interface\frontend'
npm create vite@latest . -- --template react-ts
npm install
npm run dev
```

Keep the lockfile. Open the local URL printed by the development server. Replace the starter screen with a simple page title and a labeled question input. Add loading and error state placeholders. Use mock responses initially.

Organize the frontend as you add features:

```text
frontend/src/
  components/                 # Reusable UI elements
  features/ask-question/      # Question form and preview
  features/results/          # Later results table
  lib/api.ts                 # Calls to your backend
  App.tsx
```

**Done when:** the React page opens locally and `npm run build` succeeds. This is a foundation check, not completion of the product UI.

## Step 14 — Set up the Node.js backend (Sprint 2)

Initialize a new package in `backend/`, separate from `backend/spikes/sprint-1/package.json`:

```powershell
Set-Location 'D:\React-project\Text-to-SQL Interface\backend'
npm init -y
npm install fastify
npm install --save-dev typescript tsx @types/node
```

Check current Fastify runtime compatibility first. Configure TypeScript with strict checking and consistent module settings. Create:

| Backend file | Your task |
| --- | --- |
| src/app.ts | Create the Fastify app and register routes |
| src/server.ts | Start the server on a configured local port |
| src/routes/health.ts | Add `GET /health` returning a simple status object |
| src/config.ts | Validate server configuration without exposing secrets |
| .env.example | Document placeholder configuration |
| tsconfig.json | Configure TypeScript compilation |

Add package scripts for development (`tsx watch src/server.ts`), type checking (`tsc --noEmit`), build and start. Record how environment variables are loaded; do not assume `.env` files load automatically.

**Done when:** the server starts, `/health` responds, and type checking/build succeed. Database credentials stay on the backend.

## Step 15 — Connect React to the backend (Sprint 2)

1. Keep the backend running in one terminal and the frontend in another.
2. Configure a frontend development proxy for `/api` to the backend, or narrowly configure CORS for your local frontend origin.
3. Implement `frontend/src/lib/api.ts` to request the health endpoint through the configured path.
4. Display connected/loading/unavailable states in React.
5. Stop the backend and confirm the frontend displays a useful error.

Use a public backend base URL if needed. Never place database passwords or provider API keys in frontend environment variables; they are included in client-accessible builds.

**Done when:** the frontend can call the backend and handle connection failure. Set up the remaining Sprint 2 identity, ownership, separate database roles, reproducible fixture and CI tasks before claiming Sprint 2 complete.

## Step 16 — Develop the later features in order

Use this as the handoff sequence after the foundation. Each row belongs to the sprint indicated in [the original sprint plan](07-sprint-plan.md).

| Order | Backend work | Frontend work | Completion check |
| --- | --- | --- | --- |
| Sprint 3: generation | Schema/glossary context, provider adapters, response validation, deadlines, owned preview artifacts and clarification | Question form, loading state, clarification and SQL preview | A question produces a preview or clarification; generation does not execute SQL |
| Sprint 4: restricted execution | Integrate proven AST policy, DB role, ownership/expiry checks, plan limits, timeouts, cancellation and output limits | Add minimal internal execution controls if needed for testing | Adversarial, real-DB and ownership tests pass before exposure |
| Sprint 5: meaning checks | Validate dates, metrics, joins and filters; add bounded repair and confidence evidence | Display validation findings and readiness status | Critical mismatches block execution; confidence cannot override safety |
| Sprint 6: complete UI | Bounded result responses, safe CSV, history, feedback and retention | Complete Run flow, results table, SQL details, history and accessible states | Primary journeys, cross-user checks, exports and keyboard checks pass |
| Sprint 7: operations | Deployment configuration, monitoring, costs, backups and rollback | Production API configuration and deployed flow checks | Staging and operational checks pass |
| Sprint 8: release | Frozen holdout/safety evaluation and final evidence | Synthetic-data demonstration and final UI fixes | Release gates pass and limitations are documented |

Bring reusable experiment code into the backend as reviewed modules; do not simply expose the experiment runner as a public SQL execution endpoint.

## Start now

Do Step 1 first. Run the tool-version commands and create `docs/sprint-1/environment.md`. Share versions, missing tools and hardware details with your guide before proceeding to Step 2. Never share credentials.
