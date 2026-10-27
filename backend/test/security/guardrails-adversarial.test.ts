import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GuardrailsService } from "../../src/modules/guardrails/guardrails.service.js";
import type { GuardrailViolationCode } from "@text2sql/contracts";

interface AdversarialTestCase {
    name: string;
    sql: string;
    expectedViolation: GuardrailViolationCode | string | string[];
    description: string;
}

const ADVERSARIAL_CORPUS: AdversarialTestCase[] = [
    // 1. Stacked Queries & Multiple Statements
    {
        name: "Stacked semicolon DROP TABLE",
        sql: "SELECT id, name FROM customers; DROP TABLE customers;",
        expectedViolation: "MULTIPLE_STATEMENTS",
        description: "Attempts to drop table via stacked query semicolon separator",
    },
    {
        name: "Stacked semicolon with trailing comment",
        sql: "SELECT 1; -- comment\nDELETE FROM orders;",
        expectedViolation: "MULTIPLE_STATEMENTS",
        description: "Stacked queries obfuscated with comments and line breaks",
    },
    {
        name: "Trailing semicolon followed by SELECT",
        sql: "SELECT id FROM products; SELECT name FROM products;",
        expectedViolation: "MULTIPLE_STATEMENTS",
        description: "Chained SELECT queries must be rejected to prevent batch exfiltration",
    },

    // 2. Non-SELECT Operations
    {
        name: "Direct INSERT statement",
        sql: "INSERT INTO customers (id, name) VALUES ('hacked', 'Attacker');",
        expectedViolation: "FORBIDDEN_STATEMENT_TYPE",
        description: "Direct INSERT statement blocked at statement type check",
    },
    {
        name: "Direct UPDATE statement",
        sql: "UPDATE products SET unit_price = 0.01;",
        expectedViolation: "FORBIDDEN_STATEMENT_TYPE",
        description: "Direct UPDATE statement blocked",
    },
    {
        name: "Direct DELETE statement",
        sql: "DELETE FROM order_items WHERE id = 'item_1';",
        expectedViolation: "FORBIDDEN_STATEMENT_TYPE",
        description: "Direct DELETE statement blocked",
    },
    {
        name: "Direct DROP TABLE statement",
        sql: "DROP TABLE orders CASCADE;",
        expectedViolation: "FORBIDDEN_STATEMENT_TYPE",
        description: "Direct DROP statement blocked",
    },
    {
        name: "Direct TRUNCATE statement",
        sql: "TRUNCATE TABLE customers;",
        expectedViolation: "FORBIDDEN_STATEMENT_TYPE",
        description: "Direct TRUNCATE statement blocked",
    },
    {
        name: "Direct ALTER TABLE statement",
        sql: "ALTER TABLE customers ADD COLUMN secret TEXT;",
        expectedViolation: "FORBIDDEN_STATEMENT_TYPE",
        description: "Direct ALTER statement blocked",
    },
    {
        name: "Direct GRANT privileges statement",
        sql: "GRANT ALL PRIVILEGES ON ALL TABLES TO public;",
        expectedViolation: ["FORBIDDEN_STATEMENT_TYPE", "SYNTAX_ERROR"],
        description: "Direct GRANT statement blocked",
    },

    // 3. System Catalog & Exfiltration Attacks
    {
        name: "pg_catalog.pg_user exfiltration",
        sql: "SELECT usename, passwd FROM pg_catalog.pg_user;",
        expectedViolation: "FORBIDDEN_CATALOG",
        description: "Access to PostgreSQL user credentials catalog",
    },
    {
        name: "pg_catalog.pg_shadow exfiltration",
        sql: "SELECT * FROM pg_catalog.pg_shadow;",
        expectedViolation: "FORBIDDEN_CATALOG",
        description: "Access to shadow password hash table",
    },
    {
        name: "information_schema table exploration",
        sql: "SELECT table_name FROM information_schema.tables;",
        expectedViolation: "FORBIDDEN_CATALOG",
        description: "Access to information_schema metadata",
    },
    {
        name: "Unqualified pg_ prefixed catalog table",
        sql: "SELECT datname FROM pg_database;",
        expectedViolation: "FORBIDDEN_CATALOG",
        description: "Access to pg_database without schema qualifier",
    },

    // 4. Dangerous Function Invocations
    {
        name: "pg_sleep denial of service",
        sql: "SELECT c.id, pg_sleep(10) FROM customers c;",
        expectedViolation: "FORBIDDEN_FUNCTION",
        description: "Denial of service sleep function",
    },
    {
        name: "pg_read_file filesystem exfiltration",
        sql: "SELECT pg_read_file('/etc/passwd', 0, 1000);",
        expectedViolation: "FORBIDDEN_FUNCTION",
        description: "PostgreSQL internal filesystem reader function",
    },
    {
        name: "pg_terminate_backend administrative kill",
        sql: "SELECT pg_terminate_backend(pid) FROM pg_stat_activity;",
        expectedViolation: "FORBIDDEN_FUNCTION",
        description: "Administrative process termination function",
    },
    {
        name: "query_to_xml information extraction",
        sql: "SELECT query_to_xml('SELECT 1', true, false, '');",
        expectedViolation: "FORBIDDEN_FUNCTION",
        description: "Internal XML generator function",
    },

    // 5. Locking Clauses & Concurrency Degradation
    {
        name: "SELECT FOR UPDATE row-locking",
        sql: "SELECT id FROM orders WHERE id = 'ord_1' FOR UPDATE;",
        expectedViolation: "LOCKING_CLAUSE",
        description: "Exclusive row-locking clause blocked to prevent lock contention",
    },
    {
        name: "SELECT FOR SHARE row-locking",
        sql: "SELECT id FROM products FOR SHARE NOWAIT;",
        expectedViolation: "LOCKING_CLAUSE",
        description: "Shared locking clause with NOWAIT blocked",
    },

    // 6. Schema Boundaries & Unapproved Objects
    {
        name: "Unapproved non-catalog table reference",
        sql: "SELECT id, email FROM users;",
        expectedViolation: "FORBIDDEN_TABLE",
        description: "Access to unauthorized application tables (users)",
    },
    {
        name: "Unapproved column on valid table",
        sql: "SELECT c.id, c.credit_card_number FROM customers c;",
        expectedViolation: "FORBIDDEN_COLUMN",
        description: "Access to non-existent or unapproved sensitive columns",
    },
    {
        name: "Ambiguous un-aliased column across JOIN",
        sql: "SELECT id FROM customers JOIN orders ON customers.id = orders.customer_id;",
        expectedViolation: "UNRESOLVED_IDENTIFIER",
        description: "Ambiguous column reference present in multiple joined tables without qualifier",
    },

    // 7. Transaction Control & Session Mutation
    {
        name: "Explicit transaction command BEGIN",
        sql: "BEGIN; SELECT 1;",
        expectedViolation: ["FORBIDDEN_STATEMENT_TYPE", "MULTIPLE_STATEMENTS"],
        description: "Direct transaction control commands are forbidden",
    },
    {
        name: "SET statement configuration override",
        sql: "SET statement_timeout = 0;",
        expectedViolation: "FORBIDDEN_STATEMENT_TYPE",
        description: "Session configuration mutations blocked",
    },

    // 8. Syntax Hallucination & Malformed Input
    {
        name: "Unterminated string literal injection",
        sql: "SELECT * FROM customers WHERE name = 'Alice",
        expectedViolation: "SYNTAX_ERROR",
        description: "Unclosed string literal triggers immediate parser rejection",
    },
    {
        name: "Invalid SQL grammar with random tokens",
        sql: "SELECT FROM WHERE customers === 100;",
        expectedViolation: "SYNTAX_ERROR",
        description: "Nonsensical grammar rejected cleanly at AST parsing stage",
    },
];

describe("Sprint 4 - Task 17: Adversarial Security Test Suite (US-09 / US-10 / DO-06)", () => {
    const guardrails = new GuardrailsService({
        enablePlanCostCheck: false, // Testing deterministic AST guardrails without database dependency
    });

    it(`executes test runner against adversarial corpus (${ADVERSARIAL_CORPUS.length} vectors) and blocks 100% of attacks`, async () => {
        let blockedCount = 0;

        for (const testCase of ADVERSARIAL_CORPUS) {
            const result = await guardrails.validate(testCase.sql);

            assert.equal(
                result.valid,
                false,
                `Expected adversarial query "${testCase.name}" to fail validation, but it passed!\nSQL: ${testCase.sql}`
            );

            assert.ok(
                result.findings.length > 0,
                `Expected findings for adversarial test "${testCase.name}", but findings array was empty`
            );

            const expectedList = Array.isArray(testCase.expectedViolation)
                ? testCase.expectedViolation
                : [testCase.expectedViolation];

            const hasExpectedViolation = result.findings.some((f) =>
                expectedList.includes(f.code)
            );

            assert.ok(
                hasExpectedViolation,
                `Expected violation in [${expectedList.join(", ")}] for "${testCase.name}", but received: [${result.findings.map((f) => f.code).join(", ")}]\nSQL: ${testCase.sql}`
            );

            blockedCount++;
        }

        assert.equal(
            blockedCount,
            ADVERSARIAL_CORPUS.length,
            "All adversarial test vectors must be unconditionally blocked at AST validation"
        );
    });

    it("verifies safe analytical queries pass validation cleanly", async () => {
        const safeQueries = [
            "SELECT c.id, c.name FROM customers c LIMIT 10;",
            "SELECT p.id, p.name, p.unit_price FROM products p WHERE p.unit_price > 50;",
            "SELECT o.id, o.status, COUNT(oi.id) AS item_count FROM orders o JOIN order_items oi ON o.id = oi.order_id GROUP BY o.id, o.status;",
            "WITH recent_orders AS (SELECT o.id, o.customer_id FROM orders o WHERE o.status = 'completed') SELECT ro.id, c.name FROM recent_orders ro JOIN customers c ON ro.customer_id = c.id;",
        ];

        for (const sql of safeQueries) {
            const result = await guardrails.validate(sql);
            assert.equal(
                result.valid,
                true,
                `Safe query was unexpectedly rejected:\nSQL: ${sql}\nFindings: ${JSON.stringify(result.findings)}`
            );
            assert.ok(result.normalizedSql, "Safe query must produce normalized SQL");
        }
    });
});
