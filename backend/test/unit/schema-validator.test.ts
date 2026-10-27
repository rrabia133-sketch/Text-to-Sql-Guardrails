import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { ScopeResolver } from "../../src/modules/guardrails/scope-resolver.js";
import { SchemaValidator } from "../../src/modules/guardrails/schema-validator.js";
import { ALLOWED_COLUMNS } from "../../src/modules/schema/schema.types.js";

describe("Sprint 4 - Task 5: Allowlist Schema Object & Catalog Protection Verifier", () => {
    const scopeResolver = new ScopeResolver({ catalog: ALLOWED_COLUMNS });
    const validator = new SchemaValidator();

    const validateQuery = (sql: string, customValidator = validator) => {
        const ast = parse(sql)[0];
        const scopeResult = scopeResolver.resolve(ast);
        return customValidator.validate(ast, scopeResult);
    };

    describe("Happy Path Allowed Objects", () => {
        it("passes when all tables and columns belong to the schema allowlist", () => {
            const sql = `
                SELECT c.name, o.id, o.status 
                FROM customers c 
                JOIN orders o ON c.id = o.customer_id 
                WHERE c.region = 'North';
            `;
            const result = validateQuery(sql);

            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
            assert.ok(result.validatedTables.includes("customers"));
            assert.ok(result.validatedTables.includes("orders"));
            assert.ok(result.validatedColumns.includes("customers.name"));
            assert.ok(result.validatedColumns.includes("orders.id"));
        });

        it("allows CTEs as virtual tables and validates their inner table sources", () => {
            const sql = `
                WITH recent_orders AS (
                    SELECT o.id, o.customer_id 
                    FROM orders o
                )
                SELECT ro.id, c.name 
                FROM recent_orders ro 
                JOIN customers c ON ro.customer_id = c.id;
            `;
            const result = validateQuery(sql);

            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
        });
    });

    describe("Catalog Protection (FORBIDDEN_CATALOG)", () => {
        it("rejects access to pg_catalog tables", () => {
            const sql = "SELECT tablename FROM pg_catalog.pg_tables;";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "FORBIDDEN_CATALOG"));
        });

        it("rejects access to information_schema tables", () => {
            const sql = "SELECT table_name FROM information_schema.tables;";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "FORBIDDEN_CATALOG"));
        });

        it("rejects raw pg_ prefixed system tables without schema qualifier", () => {
            const sql = "SELECT * FROM pg_class;";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "FORBIDDEN_CATALOG"));
        });
    });

    describe("Unapproved Tables (FORBIDDEN_TABLE)", () => {
        it("rejects queries referencing unapproved non-system tables", () => {
            const sql = "SELECT email, password_hash FROM user_credentials;";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "FORBIDDEN_TABLE" && f.target === "user_credentials"));
        });
    });

    describe("Unapproved Columns (FORBIDDEN_COLUMN)", () => {
        it("rejects queries referencing columns that do not exist on allowed tables", () => {
            // 'ssn' does not exist on customers
            const sql = "SELECT c.id, c.ssn FROM customers c;";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "FORBIDDEN_COLUMN" && f.target === "customers.ssn"));
        });
    });

    describe("Wildcard Projection Rejection (WILDCARD_PROJECTION)", () => {
        it("strictly rejects SELECT * queries by default in production policy", () => {
            const sql = "SELECT * FROM customers;";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "WILDCARD_PROJECTION"));
        });

        it("strictly rejects table qualified wildcard SELECT c.*", () => {
            const sql = "SELECT c.* FROM customers c;";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "WILDCARD_PROJECTION"));
        });

        it("allows wildcard projection when allowWildcards is true", () => {
            const permissiveValidator = new SchemaValidator({ allowWildcards: true });
            const sql = "SELECT * FROM customers;";
            const result = validateQuery(sql, permissiveValidator);

            // No WILDCARD_PROJECTION finding
            assert.equal(result.findings.some(f => f.code === "WILDCARD_PROJECTION"), false);
        });
    });
});
