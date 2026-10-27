import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { ScopeResolver } from "../../src/modules/guardrails/scope-resolver.js";

describe("Sprint 4 - Task 4: Scoped Identifier & Alias Resolution Engine", () => {
    // Standard test catalog matching our 4 approved tables
    const testCatalog: Record<string, string[]> = {
        customers: ["id", "name", "region", "created_at"],
        products: ["id", "name", "category", "unit_price"],
        orders: ["id", "customer_id", "status", "ordered_at"],
        order_items: ["id", "order_id", "product_id", "quantity", "unit_price"],
    };

    const resolver = new ScopeResolver({ catalog: testCatalog });

    describe("Table & Alias Binding", () => {
        it("resolves single table with alias and qualified columns", () => {
            const sql = "SELECT c.id, c.name FROM customers c WHERE c.region = 'North';";
            const ast = parse(sql)[0];
            const result = resolver.resolve(ast);

            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
            assert.equal(result.tables.length, 1);
            assert.equal(result.tables[0].name, "customers");
            assert.equal(result.tables[0].alias, "c");

            // Verify columns resolved to customers
            const resolvedCols = result.columns.map(c => `${c.sourceTable}.${c.column}`);
            assert.ok(resolvedCols.includes("customers.id"));
            assert.ok(resolvedCols.includes("customers.name"));
            assert.ok(resolvedCols.includes("customers.region"));
        });

        it("resolves multi-table joins and binds columns to correct source tables", () => {
            const sql = `
                SELECT c.name, o.id, o.status 
                FROM customers c 
                JOIN orders o ON c.id = o.customer_id 
                WHERE o.status = 'completed';
            `;
            const ast = parse(sql)[0];
            const result = resolver.resolve(ast);

            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
            assert.equal(result.tables.length, 2);

            const cName = result.columns.find(c => c.column === "name");
            assert.equal(cName?.sourceTable, "customers");

            const oId = result.columns.find(c => c.column === "id" && c.aliasUsed === "o");
            assert.equal(oId?.sourceTable, "orders");
        });

        it("rejects shadow or duplicate aliases in the same query scope", () => {
            // Using same alias 'c' for both tables
            const sql = "SELECT c.id FROM customers c JOIN orders c ON c.id = c.customer_id;";
            const ast = parse(sql)[0];
            const result = resolver.resolve(ast);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "UNRESOLVED_IDENTIFIER" && f.message.includes("Duplicate alias")));
        });
    });

    describe("Common Table Expressions (CTEs)", () => {
        it("resolves CTE and binds outer references through the CTE", () => {
            const sql = `
                WITH recent_orders AS (
                    SELECT o.id, o.customer_id, o.status 
                    FROM orders o 
                    WHERE o.status = 'shipped'
                )
                SELECT ro.id, c.name 
                FROM recent_orders ro 
                JOIN customers c ON ro.customer_id = c.id;
            `;
            const ast = parse(sql)[0];
            const result = resolver.resolve(ast);

            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);

            // Verified CTE table exists in resolved tables
            const cteTable = result.tables.find(t => t.name === "recent_orders");
            assert.ok(cteTable);
            assert.equal(cteTable?.isCte, true);
        });

        it("detects and rejects circular or self-referential CTEs", () => {
            const sql = `
                            WITH cte_a AS (
                    SELECT * FROM cte_b
                ),
                cte_b AS (
                    SELECT * FROM cte_a
                )
                SELECT * FROM cte_a;
            `;
            const ast = parse(sql)[0];
            const result = resolver.resolve(ast);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "UNRESOLVED_IDENTIFIER" && f.message.toLowerCase().includes("circular")));
        });
    });

    describe("Ambiguity & Unresolved Column Detection", () => {
        it("detects and rejects ambiguous un-aliased column present in multiple joined tables", () => {
            // 'id' exists in both customers and orders! Without alias prefix, it's ambiguous.
            const sql = "SELECT id, name FROM customers c JOIN orders o ON c.id = o.customer_id;";
            const ast = parse(sql)[0];
            const result = resolver.resolve(ast);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "UNRESOLVED_IDENTIFIER" && f.message.includes("Ambiguous column 'id'")));
        });

        it("rejects references to unknown aliases", () => {
            const sql = "SELECT x.name FROM customers c;";
            const ast = parse(sql)[0];
            const result = resolver.resolve(ast);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "UNRESOLVED_IDENTIFIER" && f.message.includes("Unknown table alias 'x'")));
        });
    });
});
