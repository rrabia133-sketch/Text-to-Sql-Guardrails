import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OutputValidator } from "../../src/modules/generation/output-validator.js";

describe("Task 11: Structured JSON Response Parser & Schema Validation (US-06)", () => {
    const validator = new OutputValidator();

    it("accepts valid JSON conforming to StructuredGenerationOutput", () => {
        const rawJson = JSON.stringify({
            sql: "SELECT id, name FROM customers LIMIT 50;",
            assumptions: ["Default limit 50 applied"],
            referencedTables: ["customers"],
            referencedColumns: ["customers.id", "customers.name"],
            explanation: "Lists customers up to 50 rows.",
        });

        const result = validator.validate(rawJson);
        assert.equal(result.valid, true);
        if (result.valid) {
            assert.equal(result.data.sql, "SELECT id, name FROM customers LIMIT 50;");
            assert.deepEqual(result.data.referencedTables, ["customers"]);
        }
    });

    it("strips markdown code fences (```json ... ```)", () => {
        const fenced = "```json\n" + JSON.stringify({
            sql: "WITH recent AS (SELECT id FROM orders WHERE status = 'completed') SELECT * FROM recent LIMIT 10;",
            assumptions: ["Only completed orders"],
            referencedTables: ["orders"],
            referencedColumns: ["orders.id", "orders.status"],
            explanation: "Recent completed orders.",
        }) + "\n```";

        const result = validator.validate(fenced);
        assert.equal(result.valid, true);
    });

    it("rejects malformed non-JSON with MALFORMED_JSON", () => {
        const result = validator.validate("Here is the SQL you asked for:\nSELECT * FROM customers;");
        assert.equal(result.valid, false);
        if (!result.valid) {
            assert.equal(result.code, "MALFORMED_JSON");
        }
    });

    it("rejects schema mismatches (missing required fields) with SCHEMA_VALIDATION_ERROR", () => {
        const invalid = JSON.stringify({
            sql: "SELECT 1;",
            // missing assumptions, explanation, referencedTables
        });

        const result = validator.validate(invalid);
        assert.equal(result.valid, false);
        if (!result.valid) {
            assert.equal(result.code, "SCHEMA_VALIDATION_ERROR");
        }
    });

    it("rejects non-SELECT statements (e.g. DELETE, DROP, INSERT) with FORBIDDEN_SQL_STATEMENT", () => {
        const mutation = JSON.stringify({
            sql: "DELETE FROM customers WHERE id = 1;",
            assumptions: [],
            referencedTables: ["customers"],
            referencedColumns: [],
            explanation: "Deletes customer.",
        });

        const result = validator.validate(mutation);
        assert.equal(result.valid, false);
        if (!result.valid) {
            assert.equal(result.code, "FORBIDDEN_SQL_STATEMENT");
        }
    });

    it("rejects queries referencing unapproved tables with UNAPPROVED_TABLE_REFERENCE", () => {
        const forbiddenTable = JSON.stringify({
            sql: "SELECT id, password_hash FROM users LIMIT 10;",
            assumptions: [],
            referencedTables: ["users"],
            referencedColumns: ["users.id"],
            explanation: "Queries users table.",
        });

        const result = validator.validate(forbiddenTable);
        assert.equal(result.valid, false);
        if (!result.valid) {
            assert.equal(result.code, "UNAPPROVED_TABLE_REFERENCE");
            assert.ok(result.reason.includes('unapproved table "users"'));
        }
    });

    it("rejects queries accessing pg_catalog with UNAPPROVED_TABLE_REFERENCE", () => {
        const catalogAccess = JSON.stringify({
            sql: "SELECT * FROM pg_catalog.pg_tables;",
            assumptions: [],
            referencedTables: ["customers"],
            referencedColumns: [],
            explanation: "Inspects tables.",
        });

        const result = validator.validate(catalogAccess);
        assert.equal(result.valid, false);
        if (!result.valid) {
            assert.equal(result.code, "UNAPPROVED_TABLE_REFERENCE");
        }
    });
});
