# ADR 02: AST SQL Parser Selection

- **Status:** Accepted
- **Deciders:** Rabia-Dev
- **Date:** 2026-10-10

## Context & Problem
We must validate untrusted LLM-generated SQL queries before execution. Regex approaches are unsafe and easily bypassed via comments, whitespace, or encoding.

## Decision
We select **`pgsql-ast-parser`** as our primary SQL validator over WebAssembly wrappers (`libpg-query`).

## Empirical Evidence
In Task 7 testing, `pgsql-ast-parser`:
- Successfully parsed all 4 development analytics queries.
- Blocked 100% (5/5) of adversarial attack vectors (stacked queries, deletes, system tables, sleep DoS, locking clauses).
- Pure TypeScript implementation avoids native binary compilation and WASM memory overhead.

## Consequences & Reconsideration
- If future sprints require obscure PostgreSQL syntax not supported by the parser, evaluate WASM `libpg-query`.
