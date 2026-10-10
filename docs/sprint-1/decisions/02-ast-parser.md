# ADR 02: AST SQL Parser Selection

- **Status:** Accepted
- **Deciders:** Rabia-Dev
- **Date:** 2026-10-10

## Context & Problem
We must validate untrusted LLM-generated SQL queries before execution. Regex approaches are unsafe and easily bypassed via comments, whitespace, or encoding.

## Decision
We select **`pgsql-ast-parser`** as our primary SQL validator over WebAssembly wrappers (`libpg-query`).

## Supported SQL Subset (AC-4 & Query Rules)
The parser strictly enforces the following whitelist (see [`query-rules.md`](../query-rules.md)):
- **Statements:** Exactly 1 statement, strictly `SELECT`. Prohibits all DDL (`DROP`, `CREATE`, `ALTER`), DML (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`), and TCL (`BEGIN`, `COMMIT`).
- **Tables & Schemas:** Restricted strictly to whitelisted application tables (`customers`, `products`, `orders`, `order_items`). Direct access to `pg_catalog.*`, `information_schema.*`, and `pg_toast.*` is rejected.
- **Allowed Functions:**
  - Aggregates: `COUNT()`, `SUM()`, `AVG()`, `MIN()`, `MAX()`.
  - Date & Math: `DATE_TRUNC()`, `EXTRACT()`, `COALESCE()`, `ROUND()`, `LOWER()`, `UPPER()`.
  - Blacklist: `pg_sleep()`, `pg_read_file()`, `current_user`, and all UDFs.
- **Execution Constraints:** Mandatory `LIMIT <= 100` (defaults to 50 if omitted), prohibition of locking clauses (`FOR UPDATE`, `FOR SHARE`, `NOWAIT`, `SKIP LOCKED`).

## Empirical Evidence
In Task 7 testing, `pgsql-ast-parser`:
- Successfully parsed all 4 development analytics queries.
- Blocked 100% (5/5) of adversarial attack vectors (stacked queries, deletes, system tables, sleep DoS, locking clauses).
- Pure TypeScript implementation avoids native binary compilation and WASM memory overhead.

## Trade-offs & Consequences
- **Pros:** Zero native C/Rust dependencies, ultra-fast in-memory parsing (<5ms), complete AST AST traversal and AST mutation (e.g. injecting LIMIT clauses).
- **Cons:** Less tolerant of non-standard PostgreSQL extensions or bleeding-edge PostgreSQL grammar.

## Conditions for Reconsideration
- If future analytics queries require complex window functions or CTE constructs not supported by `pgsql-ast-parser`, evaluate WASM-compiled `libpg-query`.
