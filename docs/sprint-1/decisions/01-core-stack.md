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
- Fastify provides high-throughput schema validation and lower overhead than Express.
- Node 22 native `fetch` eliminates external HTTP client dependencies for Ollama/Groq APIs.
- TypeScript shared contracts prevent request/response drift between frontend and backend.

## Consequences & Reconsideration
- If extreme concurrency is required (>100k req/sec), consider Go or Rust for the backend gateway.
