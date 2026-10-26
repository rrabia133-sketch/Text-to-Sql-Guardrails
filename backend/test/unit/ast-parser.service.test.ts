import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AstParserService } from "../../src/modules/guardrails/ast-parser.service.js";

describe("Sprint 4 - Task 2: AST Parser Service & Single SELECT Statement Policy", () => {
    const parserService = new AstParserService();

    describe("Happy Path Parsing", () => {
        it("accepts a valid single SELECT query with projection, WHERE, and ORDER BY", () => {
            const sql = "SELECT id, name, email FROM customers WHERE created_at >= '2026-01-01' ORDER BY id DESC;";
            const result = parserService.parse(sql);

            assert.equal(result.ok, true);
            assert.ok(result.ast);
            assert.equal(result.findings.length, 0);
            assert.equal(result.ast.type, "select");
        });

        it("accepts a valid single WITH ... SELECT query (non-modifying CTE)", () => {
            const sql = `
                WITH high_value_orders AS (
                    SELECT customer_id, SUM(total_amount) as total
                    FROM orders
                    GROUP BY customer_id
                )
                SELECT c.name, hvo.total
                FROM customers c
                JOIN high_value_orders hvo ON c.id = hvo.customer_id;
            `;
            const result = parserService.parse(sql);

            assert.equal(result.ok, true);
            assert.ok(result.ast);
            assert.equal(result.findings.length, 0);
            assert.equal(result.ast.type, "with");
        });
    });

    describe("Syntax Error Rejection", () => {
        it("rejects empty strings and whitespace-only queries with SYNTAX_ERROR", () => {
            const emptyResult = parserService.parse("");
            assert.equal(emptyResult.ok, false);
            assert.equal(emptyResult.findings[0].code, "SYNTAX_ERROR");

            const whitespaceResult = parserService.parse("   \n\t  ");
            assert.equal(whitespaceResult.ok, false);
            assert.equal(whitespaceResult.findings[0].code, "SYNTAX_ERROR");
        });

        it("rejects syntactically malformed SQL with SYNTAX_ERROR and extracts error location", () => {
            const sql = "SELECT * FROM WHERE;";
            const result = parserService.parse(sql);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "SYNTAX_ERROR");
            assert.ok(result.findings[0].message.includes("Failed to parse SQL"));
            assert.ok(result.findings[0].location);
            assert.equal(result.findings[0].location.line, 1);
            assert.ok(result.findings[0].location.column && result.findings[0].location.column > 0);
        });
    });

    describe("Multi-Statement & Semicolon Stacking Rejection", () => {
        it("rejects stacked queries chained with semicolons (SELECT ...; DROP TABLE ...)", () => {
            const sql = "SELECT * FROM customers; DROP TABLE orders;";
            const result = parserService.parse(sql);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "MULTIPLE_STATEMENTS");
            assert.ok(result.findings[0].message.includes("Query contains 2 statements"));
            assert.equal(result.findings[0].severity, "CRITICAL");
        });

        it("rejects stacked queries disguised with SQL comments", () => {
            const sql = "SELECT id FROM products; -- comment \n DELETE FROM customers;";
            const result = parserService.parse(sql);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "MULTIPLE_STATEMENTS");
        });

        it("rejects multiple read-only SELECT queries chained together", () => {
            const sql = "SELECT 1; SELECT 2;";
            const result = parserService.parse(sql);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "MULTIPLE_STATEMENTS");
        });
    });

    describe("Forbidden Statement Types (Non-SELECT Rejection)", () => {
        it("rejects DELETE statements with FORBIDDEN_STATEMENT_TYPE", () => {
            const sql = "DELETE FROM customers WHERE id = 1;";
            const result = parserService.parse(sql);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "FORBIDDEN_STATEMENT_TYPE");
            assert.ok(result.findings[0].message.includes("delete"));
        });

        it("rejects INSERT statements with FORBIDDEN_STATEMENT_TYPE", () => {
            const sql = "INSERT INTO customers (name, email) VALUES ('Eve', 'eve@example.com');";
            const result = parserService.parse(sql);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "FORBIDDEN_STATEMENT_TYPE");
            assert.ok(result.findings[0].message.includes("insert"));
        });

        it("rejects UPDATE statements with FORBIDDEN_STATEMENT_TYPE", () => {
            const sql = "UPDATE products SET price = 0 WHERE id = 5;";
            const result = parserService.parse(sql);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "FORBIDDEN_STATEMENT_TYPE");
            assert.ok(result.findings[0].message.includes("update"));
        });

        it("rejects DDL DROP TABLE statements with FORBIDDEN_STATEMENT_TYPE", () => {
            const sql = "DROP TABLE orders CASCADE;";
            const result = parserService.parse(sql);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "FORBIDDEN_STATEMENT_TYPE");
        });

        it("rejects DDL ALTER TABLE statements with FORBIDDEN_STATEMENT_TYPE", () => {
            const sql = "ALTER TABLE customers ADD COLUMN password_hash TEXT;";
            const result = parserService.parse(sql);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "FORBIDDEN_STATEMENT_TYPE");
        });

        it("rejects modifying CTEs (e.g. WITH ... DELETE ... RETURNING ...)", () => {
            const sql = "WITH deleted_orders AS (DELETE FROM orders WHERE status = 'cancelled' RETURNING id) SELECT * FROM deleted_orders;";
            const result = parserService.parse(sql);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "FORBIDDEN_STATEMENT_TYPE");
            assert.ok(result.findings[0].message.includes("Modifying CTEs"));
            assert.equal(result.findings[0].target, "deleted_orders");
        });

        it("rejects CTEs whose final statement is non-SELECT (e.g. WITH ... DELETE)", () => {
            const sql = "WITH safe_cte AS (SELECT id FROM orders) DELETE FROM orders WHERE id IN (SELECT id FROM safe_cte);";
            const result = parserService.parse(sql);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "FORBIDDEN_STATEMENT_TYPE");
            assert.ok(result.findings[0].message.includes("Final query in WITH clause has forbidden statement type"));
        });
    });

    describe("Locking Clause Rejection", () => {
        it("rejects root SELECT queries with FOR UPDATE clause", () => {
            const sql = "SELECT * FROM orders WHERE status = 'pending' FOR UPDATE;";
            const result = parserService.parse(sql);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "LOCKING_CLAUSE");
            assert.ok(result.findings[0].message.includes("FOR UPDATE"));
        });

        it("rejects root SELECT queries with FOR SHARE clause", () => {
            const sql = "SELECT * FROM products FOR SHARE;";
            const result = parserService.parse(sql);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "LOCKING_CLAUSE");
            assert.ok(result.findings[0].message.includes("FOR SHARE"));
        });

        it("rejects locking clauses nested inside CTEs", () => {
            const sql = `
                WITH locked_orders AS (
                    SELECT * FROM orders FOR UPDATE
                )
                SELECT * FROM locked_orders;
            `;
            const result = parserService.parse(sql);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "LOCKING_CLAUSE");
            assert.ok(result.findings[0].message.includes("FOR UPDATE"));
        });
    });
});
