
# Sprint 1 Scope: Feasibility Evidence & Safety Boundaries

## 1. Domain & Data Scope
- **Domain:** Synthetic E-commerce Analytics.
- **Tables:** `customers`, `products`, `orders`, `order_items`.
- **Database Engine:** PostgreSQL 16 (running in isolated Docker container on port `5434`).
- **Nature of Data:** 100% synthetic; no real PII or proprietary commercial data.

## 2. Query Safety & Execution Boundary
- **Allowed SQL Grammar:** Read-only analytics (`SELECT` statements only).
- **Enforced Restrictions:**
  - No writes (`INSERT`, `UPDATE`, `DELETE`).
  - No schema modifications (`DROP`, `ALTER`, `CREATE`, `TRUNCATE`).
  - No stacked queries (semicolon chaining `;`).
  - No transaction control (`BEGIN`, `COMMIT`, `ROLLBACK`) or locking clauses (`FOR UPDATE`).
  - No administrative/system functions (`pg_sleep`, `pg_read_file`, copy).
- **Execution Flow:** SQL preview is presented to the user; execution strictly requires prior AST parsing and restricted DB credentials.

## 3. Model & Provider Scope
- **Primary / Default:** Local Ollama (`qwen2.5-coder:7b`).
- **Cloud Comparison:** Groq API (strictly optional, isolated, capped at $5.00 total spend).
- **Privacy Boundary:** Only schema tables and column names are provided to LLMs. Actual database rows and credentials never leave the local environment.

## 4. Benchmark Reference Questions
1. *"What is the total revenue from completed orders in the last 30 days?"*
2. *"List the top 5 customers by spending in the European region."*
3. *"Which products have never been ordered?"*
