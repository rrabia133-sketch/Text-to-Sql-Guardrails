# ADR 01: Core Application Stack & Runtime Selection

- **Status:** Accepted
- **Deciders:** Rabia-Dev
- **Date:** 2026-10-10

## Context & Problem
We need a robust, type-safe stack for an AI-assisted Text-to-SQL interface consisting of an interactive client and a secure validation/execution backend.

## Decision
1. **Frontend:** React with TypeScript, scaffolded with Vite in `frontend/`.
2. **Backend:** Node.js (v22 LTS) with Fastify and TypeScript in `backend/`.
3. **Workspace Organization:** Two distinct packages (`frontend/` and `backend/`) keeping dependencies clean and separated.

## Rationale
- Fastify provides high-throughput JSON schema validation (`ajv`) and significantly lower overhead than Express.
- Node 22 native `fetch` eliminates external HTTP client dependencies (such as `axios`) for Ollama and Groq REST APIs.
- End-to-end TypeScript shared types prevent schema drift between frontend requests and backend API contracts.
- React with Vite provides instant Hot Module Replacement (HMR) and optimized modern ESM bundles.

## Trade-offs & Consequences
- **Pros:** Unified TypeScript development experience across frontend and backend; Fastify's encapsulated plugin architecture promotes clean modularization for AST guardrails and database pool lifecycle.
- **Cons:** Fastify ecosystem is smaller than Express; requires TypeScript compilation tooling (`tsx` for dev, `tsc` for production build).

## Conditions for Reconsideration
- If extreme backend concurrency (>100,000 req/sec) or strict zero-garbage-collection latency is needed, consider rewriting the backend gateway in Go or Rust.
- If server-side rendering (SSR) or SEO becomes critical for public distribution, evaluate Next.js.
