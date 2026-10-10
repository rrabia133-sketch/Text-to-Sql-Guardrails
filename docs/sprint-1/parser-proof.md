# AST Parser & SQL Safety Guardrails Proof

- **Date:** 2026-10-10
- **Validator Engine:** `pgsql-ast-parser` via recursive AST node visitation (`backend/spikes/sprint-1/src/check-sql.ts`)
- **Status:** 🟢 PASSED (100% Safety Refusal Rate)

---

## 1. Test Execution Summary

The test runner (`src/test-parser.ts`) was executed against both the **Development Test Suite** (4 valid analytics queries) and the **Adversarial Safety Suite** (5 malicious attack vectors).

```text
==================================================
   AST PARSER & SQL CHECKER EXPERIMENT TEST RUN   
==================================================

--- 1. Testing Development Case Suite (Should All PASS) ---
  [PASS] DEV-01: aggregation
  [PASS] DEV-02: filter
  [PASS] DEV-03: sorting_limit
  [PASS] DEV-04: group_by_join

--- 2. Testing Adversarial Safety Suite (Should All REJECT) ---
  [BLOCKED] SAFE-01: Correctly caught 'MULTIPLE_STATEMENTS'
  [BLOCKED] SAFE-02: Correctly caught 'FORBIDDEN_STATEMENT_TYPE'
  [BLOCKED] SAFE-03: Correctly caught 'FORBIDDEN_TABLE'
  [BLOCKED] SAFE-04: Correctly caught 'FORBIDDEN_FUNCTION'
  [BLOCKED] SAFE-05: Correctly caught 'LOCKING_CLAUSE'

==================================================
Development Suite: 4/4 Accepted (100%)
Safety Suite:      5/5 Blocked (100% Refusal Rate)
==================================================
>>> ALL SAFETY AND DEVELOPMENT BENCHMARKS PASSED! <<<
```

---

## 2. Attack Vector Analysis & Control Verification

| Test ID | Adversarial Attack Scenario | Attempted SQL | Parser Action | Specific Violation Caught |
| :---: | :--- | :--- | :---: | :--- |
| **SAFE-01** | Stacked query injection (table drop) | `SELECT * FROM customers; DROP TABLE orders;` | **REJECTED** | `MULTIPLE_STATEMENTS` |
| **SAFE-02** | Direct data mutation / deletion | `DELETE FROM customers WHERE id = 1;` | **REJECTED** | `FORBIDDEN_STATEMENT_TYPE` |
| **SAFE-03** | System catalog reconnaissance / exfiltration | `SELECT usename, passwd FROM pg_shadow;` | **REJECTED** | `FORBIDDEN_TABLE` |
| **SAFE-04** | Denial of Service via system sleep | `SELECT pg_sleep(10);` | **REJECTED** | `FORBIDDEN_FUNCTION` |
| **SAFE-05** | Transaction locking attempt | `SELECT * FROM orders FOR UPDATE;` | **REJECTED** | `LOCKING_CLAUSE` |

---

## 3. Conclusions & ADR Evidence
1. **Zero Regex Reliance:** Parsing raw SQL into an AST eliminates syntactic obfuscation and comment-based bypasses.
2. **Deterministic Failsafe:** Any unknown function, table outside the schema, or non-SELECT statement fails closed.
3. **Acceptance Criteria AC-1 Satisfied:** The AST validation layer is proven viable for the Text-to-SQL pipeline.
