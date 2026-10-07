# Proposed project foundation: Node.js + Fastify + React

This is a design only. None of the directories, source files, package manifests, containers or workflow files below are scaffolded now.

## Proposed monorepo

```text
text-to-sql-interface/
  README.md
  package.json                  # future npm-workspace manifest
  package-lock.json
  .env.example                  # placeholders only
  .gitignore
  AGENTS.md                     # future coding-agent instructions
  apps/
    api/
      src/
        app.ts                  # Fastify composition, no listen side effect
        server.ts               # process lifecycle
        config/                 # validated runtime settings
        plugins/                # identity, DB pools, limits, observability
        modules/
          auth/
          schema-catalog/
          glossary/
          providers/            # interface, ollama, groq, fake
          queries/              # state machine and artifacts
          guardrails/           # AST traversal and reference policy
          semantic-validation/
          confidence/
          execution/            # sole analytics query credential owner
          history/
          feedback/
          audit/
        lib/                    # small shared backend utilities
      test/
        unit/
        integration/
        security/
    web/
      src/
        app/                    # routing, identity and top-level layout
        features/
          ask-question/
          clarification/
          sql-preview/
          validation-evidence/
          results/
          history/
          feedback/
          settings/
        components/             # accessible reusable UI primitives
        lib/                    # typed API client
        styles/
      test/
  packages/
    contracts/                  # transport schemas/types; no server secrets
    domain/                     # pure intent/findings/scoring types and rules
    sql-analysis/               # selected parser wrapper, resolver, AST policy
    evaluation/                 # versioned runners and result comparison
    test-fixtures/              # synthetic data and provider fakes
  database/
    app/migrations/             # application metadata only
    analytics/schema/           # synthetic analytics schema
    analytics/seeds/
    roles/                      # separately reviewed permissions
  prompts/
    intent/
    sql-generation/
    semantic-verification/
    manifests/                  # versions and supported models
  evals/
    development/
    holdout/                    # controlled; excluded from agent tuning
    adversarial/
    reports/
  tests/e2e/
  infra/
    docker/
    compose/
    deployment/                 # provider-specific choice comes later
    monitoring/
  .github/workflows/            # proposed checks/build/deploy
  docs/
    planning/                   # the current planning pack
    adr/
    api/
    runbooks/
    evaluation/
  .agents/
    roles/
    tasks/
    reviews/
    templates/
```

## Dependency rules

Web depends on public contracts only, never backend configuration or provider SDKs. API composes modules and imports domain/contracts/SQL analysis. Domain rules have no Fastify, provider or DB dependency. SQL analysis exposes a narrow parsed/validated-query contract; execution accepts that contract plus stored artifact identity, not arbitrary client strings.

Providers have no executor access. Semantic validation cannot weaken guardrails. Application writer DB pool and analytics restricted pool are separate registrations with distinct types and configuration. Keep module route handlers thin; orchestration belongs to services and pure checks belong to policy modules.

## Initial foundation tasks when coding is authorized

1. Pin supported runtime/framework and chosen parser/model decisions from Sprint 1.
2. Create npm workspaces and TypeScript configuration, then establish formatting/lint/type/build scripts.
3. Create testable Fastify composition, validated config, health routes and public contracts.
4. Create React routing, identity boundary, basic question page and typed API client.
5. Add synthetic fixture, separate roles and app migrations; prove DB restrictions.
6. Add fake provider and tests before attaching live adapters.
7. Add CI and setup documentation, then implement pipeline stories in dependency order.

Proposed script responsibilities: `dev`, `build`, `lint`, `typecheck`, `test:unit`, `test:integration`, `test:security`, `test:e2e`, `eval:dev` and release-controlled `eval:holdout`. These names describe future commands and are not currently runnable.

## UI flow

Ask → clarify if needed → preview SQL/assumptions/evidence → Run eligible artifact → inspect results/export → feedback/history. Show provider and local-only status visibly. Confidence uses readable labels and evidence, not color alone. Disabled Run explains the actual blocking reason without exposing parser internals.
