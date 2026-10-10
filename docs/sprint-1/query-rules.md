# AST Query Validation Rules & Allowed Grammar

- **Scope:** Sprint 1 AST Security Spike
- **Enforcement Level:** Pre-execution AST validation (`pgsql-ast-parser`)
- **Default Policy:** Fail Closed (Any unapproved syntax or node triggers immediate rejection)

---

## 1. Statement Rules
* **Statement Count:** Strictly **1 statement**. Chaining multiple statements via semicolons (`;`) is rejected.
* **Statement Type:** Strictly **`SELECT`**.
* **Forbidden DDL / DML:** `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `DROP`, `ALTER`, `CREATE`, `GRANT`, `REVOKE`, `COPY`, `EXPLAIN`, `VACUUM`.
* **Transaction Control:** `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT` are rejected.

---

## 2. Table & Column Boundaries
* **Table Whitelist:** Only the 4 approved schema tables:
  * `customers`, `products`, `orders`, `order_items`
* **Forbidden Catalogs:** Direct access to `pg_catalog.*`, `information_schema.*`, or `pg_toast.*` is rejected.
* **Column Validation:** Columns must belong to the referenced table schema or explicitly resolved aliases.
* **Wildcards:** `SELECT *` is rejected in production mode; queries must project explicit column names or aggregations.

---

## 3. Functions & Expressions
* **Approved Aggregate Functions:**
  * `COUNT()`, `SUM()`, `AVG()`, `MIN()`, `MAX()`
* **Approved Scalar & Date Functions:**
  * `DATE_TRUNC()`, `EXTRACT()`, `COALESCE()`, `ROUND()`, `LOWER()`, `UPPER()`
* **Strict Function Blacklist:**
  * System/OS calls: `pg_sleep()`, `pg_read_file()`, `pg_ls_dir()`, `query_to_xml()`.
  * Administrative functions: `current_user`, `session_user`, `version()`.
  * User-defined functions (UDFs).

---

## 4. Execution Guardrails
* **Mandatory Limit:** Every query must specify a `LIMIT` clause:
  * Maximum allowable: `LIMIT 100`
  * If omitted by LLM: The backend validator injects `LIMIT 50`.
* **Locking Clauses:** `FOR UPDATE`, `FOR SHARE`, `NOWAIT`, `SKIP LOCKED` are unconditionally rejected.
* **CTEs & Subqueries:** Single CTEs (`WITH ... AS (SELECT ...) SELECT ...`) are allowed only if all inner queries satisfy the same strict read-only rules.
