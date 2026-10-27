import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { FunctionValidator } from "../../src/modules/guardrails/function-validator.js";

describe("Sprint 4 - Task 6: Approved Function Whitelist & Dangerous Function Blocker", () => {
    const validator = new FunctionValidator();

    const validateQuery = (sql: string, customValidator = validator) => {
        const ast = parse(sql)[0];
        return customValidator.validate(ast);
    };

    describe("Happy Path Approved Functions", () => {
        it("allows approved aggregate functions (COUNT, SUM, AVG, MIN, MAX)", () => {
            const sql = `
                SELECT 
                    COUNT(id) as order_count,
                    SUM(total_amount) as total_revenue,
                    AVG(total_amount) as avg_revenue,
                    MIN(total_amount) as min_revenue,
                    MAX(total_amount) as max_revenue
                FROM orders;
            `;
            const result = validateQuery(sql);

            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
            assert.ok(result.validatedFunctions.includes("count"));
            assert.ok(result.validatedFunctions.includes("sum"));
            assert.ok(result.validatedFunctions.includes("avg"));
            assert.ok(result.validatedFunctions.includes("min"));
            assert.ok(result.validatedFunctions.includes("max"));
        });

        it("allows approved scalar and date functions (DATE_TRUNC, ROUND, COALESCE, LOWER, UPPER)", () => {
            const sql = `
                SELECT 
                    DATE_TRUNC('month', ordered_at) as month,
                    ROUND(total_amount, 2) as rounded_amount,
                    COALESCE(status, 'unknown') as clean_status,
                    LOWER(name) as lower_name,
                    UPPER(region) as upper_region
                FROM orders o
                JOIN customers c ON o.customer_id = c.id;
            `;
            const result = validateQuery(sql);

            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
            assert.ok(result.validatedFunctions.includes("date_trunc"));
            assert.ok(result.validatedFunctions.includes("round"));
            assert.ok(result.validatedFunctions.includes("coalesce"));
            assert.ok(result.validatedFunctions.includes("lower"));
            assert.ok(result.validatedFunctions.includes("upper"));
        });

        it("allows approved EXTRACT construct", () => {
            const sql = "SELECT EXTRACT(year FROM ordered_at) as order_year FROM orders;";
            const result = validateQuery(sql);

            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
            assert.ok(result.validatedFunctions.includes("extract"));
        });
    });

    describe("Dangerous OS, File & Sleep Function Rejection", () => {
        it("strictly rejects pg_sleep", () => {
            const sql = "SELECT id, pg_sleep(5) FROM orders;";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "FORBIDDEN_FUNCTION" && f.target === "pg_sleep"));
        });

        it("strictly rejects pg_read_file", () => {
            const sql = "SELECT pg_read_file('/etc/passwd');";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "FORBIDDEN_FUNCTION" && f.target === "pg_read_file"));
        });

        it("strictly rejects pg_ls_dir and pg_backend_pid", () => {
            const sql = "SELECT pg_ls_dir('/tmp'), pg_backend_pid();";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "FORBIDDEN_FUNCTION" && f.target === "pg_ls_dir"));
            assert.ok(result.findings.some(f => f.code === "FORBIDDEN_FUNCTION" && f.target === "pg_backend_pid"));
        });

        it("strictly rejects query_to_xml", () => {
            const sql = "SELECT query_to_xml('SELECT 1', true, false, '');";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "FORBIDDEN_FUNCTION" && f.target === "query_to_xml"));
        });
    });

    describe("Administrative & Session Functions Rejection", () => {
        it("strictly rejects version()", () => {
            const sql = "SELECT version();";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "FORBIDDEN_FUNCTION" && f.target === "version"));
        });

        it("strictly rejects current_user and session_user", () => {
            const sql = "SELECT current_user, session_user FROM orders;";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "FORBIDDEN_FUNCTION"));
        });

        it("strictly rejects txid_current()", () => {
            const sql = "SELECT txid_current();";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "FORBIDDEN_FUNCTION" && f.target === "txid_current"));
        });
    });

    describe("User-Defined Functions (UDFs) & Unapproved Function Rejection", () => {
        it("rejects unknown functions in SELECT projection", () => {
            const sql = "SELECT custom_scoring_algorithm(id) FROM customers;";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "FORBIDDEN_FUNCTION" && f.target === "custom_scoring_algorithm"));
        });

        it("rejects unknown functions in WHERE clause", () => {
            const sql = "SELECT id FROM orders WHERE custom_risk_filter(status) = 1;";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "FORBIDDEN_FUNCTION" && f.target === "custom_risk_filter"));
        });

        it("rejects unknown functions in HAVING clause", () => {
            const sql = "SELECT customer_id FROM orders GROUP BY customer_id HAVING custom_aggregate(id) > 10;";
            const result = validateQuery(sql);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "FORBIDDEN_FUNCTION" && f.target === "custom_aggregate"));
        });
    });
});
