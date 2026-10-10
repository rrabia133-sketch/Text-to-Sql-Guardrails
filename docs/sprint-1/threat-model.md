# Threat Model & Trust Boundaries

- **Target System:** Text-to-SQL Analytics Interface
- **Methodology:** STRIDE / Defense-in-Depth

---

## 1. Architectural Trust Boundaries

```text
[ Untrusted User / Client ]
            │  (Natural Language Question)
════════════╪══════════════════════════════════════════════════════════ [ Boundary 1: User Input ]
            ▼
[ Node.js Backend Gateway ]
  - Validates question length and rate limits
  - Injects schema metadata ONLY (never real credentials or data rows)
════════════╪══════════════════════════════════════════════════════════ [ Boundary 2: Model Egress ]
            ▼
[ LLM Provider (Ollama / Groq) ]
  - Generates proposed SQL candidate
════════════╪══════════════════════════════════════════════════════════ [ Boundary 3: Untrusted SQL ]
            ▼
[ AST SQL Safety Guardrail ]
  - Parses SQL into Abstract Syntax Tree (AST)
  - Recursively validates table/column allowlists and grammar
  - Fails closed on any ambiguity or forbidden node
════════════╪══════════════════════════════════════════════════════════ [ Boundary 4: DB Execution ]
            ▼
[ PostgreSQL 16 Database ]
  - Connects strictly as restricted read-only role (`analytics_user`)
  - DB user has ZERO write, DDL, or temp privileges
  - Strict 5-second `statement_timeout` enforced
```

---

## 2. The 5 Layers of Defense-in-Depth

1. **Input Hygiene:** Natural language questions cannot inject shell commands or hijack server logic.
2. **Context Isolation:** LLMs receive table structures only. Customer records, sales amounts, and database passwords are never sent to external providers.
3. **Deterministic AST Validation:** We never use regex or string replace to clean SQL. The raw query is parsed into a syntax tree and inspected node-by-node.
4. **Restricted Database Role:** Even if an adversarial prompt circumvents the AST parser, PostgreSQL role containment rejects writes at the database kernel level with `permission denied`.
5. **Runtime Budgeting:** Strict 5,000ms query timeout and memory limits prevent denial-of-service via query stalling.
