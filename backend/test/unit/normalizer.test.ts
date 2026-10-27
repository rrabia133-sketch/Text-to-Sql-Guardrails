import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { SqlNormalizer } from "../../src/modules/guardrails/normalizer.js";

describe("Sprint 4 - Task 7: SQL Normalizer, Row-Cap Enforcement & Post-Transform Revalidation", () => {
    const normalizer = new SqlNormalizer({
        defaultLimit: 50,
        maxLimit: 100,
        maxOffset: 1000,
    });

    describe("Mandatory Row Cap Injection", () => {
        it("injects default LIMIT 50 when query omits LIMIT", () => {
            const sql = "SELECT id, name FROM customers;";
            const output = normalizer.normalize(sql);

            assert.equal(output.ok, true);
            assert.equal(output.findings.length, 0);
            assert.equal(output.result.injectedLimit, 50);
            assert.equal(output.result.clampedLimit, undefined);
            assert.equal(output.result.astModified, true);
            assert.ok(output.result.normalizedSql.includes("LIMIT (50)") || output.result.normalizedSql.includes("LIMIT 50"));
        });

        it("preserves acceptable user-defined LIMIT within bounds", () => {
            const sql = "SELECT id, name FROM customers LIMIT 25;";
            const output = normalizer.normalize(sql);

            assert.equal(output.ok, true);
            assert.equal(output.findings.length, 0);
            assert.equal(output.result.injectedLimit, undefined);
            assert.equal(output.result.clampedLimit, undefined);
            assert.equal(output.result.astModified, false);
            assert.ok(output.result.normalizedSql.includes("25"));
        });

        it("clamps excessive LIMIT > 100 down to LIMIT 100", () => {
            const sql = "SELECT id FROM orders LIMIT 500;";
            const output = normalizer.normalize(sql);

            assert.equal(output.ok, true);
            assert.equal(output.findings.length, 0);
            assert.equal(output.result.injectedLimit, undefined);
            assert.equal(output.result.clampedLimit, 100);
            assert.equal(output.result.astModified, true);
            assert.ok(output.result.normalizedSql.includes("LIMIT (100)") || output.result.normalizedSql.includes("LIMIT 100"));
        });
    });

    describe("OFFSET Bounding", () => {
        it("preserves acceptable OFFSET clause within bounds", () => {
            const sql = "SELECT id FROM orders LIMIT 20 OFFSET 50;";
            const output = normalizer.normalize(sql);

            assert.equal(output.ok, true);
            assert.ok(output.result.normalizedSql.includes("50"));
        });

        it("clamps excessive OFFSET > 1000 to max 1000", () => {
            const sql = "SELECT id FROM orders LIMIT 20 OFFSET 5000;";
            const output = normalizer.normalize(sql);

            assert.equal(output.ok, true);
            assert.equal(output.result.astModified, true);
            assert.ok(output.result.normalizedSql.includes("OFFSET (1000)") || output.result.normalizedSql.includes("OFFSET 1000"));
        });
    });

    describe("Common Table Expressions (CTEs)", () => {
        it("injects LIMIT 50 on outer query of a WITH statement", () => {
            const sql = `
                WITH active_orders AS (
                    SELECT id, customer_id FROM orders WHERE status = 'shipped'
                )
                SELECT ao.id, c.name 
                FROM active_orders ao 
                JOIN customers c ON ao.customer_id = c.id;
            `;
            const output = normalizer.normalize(sql);

            assert.equal(output.ok, true);
            assert.equal(output.result.injectedLimit, 50);

            // Re-parse to verify structure
            const reparsed = parse(output.result.normalizedSql)[0];
            assert.equal(reparsed.type, "with");
            // Check that the limit is placed on the outer statement
            assert.ok((reparsed as any).in?.limit?.limit?.value === 50);
        });
    });

    describe("Post-Transform Revalidation & Fail-Closed Safety", () => {
        it("re-validates normalized SQL to guarantee exact AST validity", () => {
            const sql = "SELECT c.name FROM customers c WHERE c.region = 'North';";
            const output = normalizer.normalize(sql);

            assert.equal(output.ok, true);
            // Verify output SQL parses into single valid statement
            const statements = parse(output.result.normalizedSql);
            assert.equal(statements.length, 1);
        });

        it("fails closed on syntactically invalid input SQL", () => {
            const sql = "SELECT * FROM;";
            const output = normalizer.normalize(sql);

            assert.equal(output.ok, false);
            assert.ok(output.findings.some(f => f.code === "SYNTAX_ERROR"));
        });

        it("fails closed on empty SQL", () => {
            const sql = "   ";
            const output = normalizer.normalize(sql);

            assert.equal(output.ok, false);
            assert.ok(output.findings.some(f => f.code === "SYNTAX_ERROR"));
        });
    });
});
