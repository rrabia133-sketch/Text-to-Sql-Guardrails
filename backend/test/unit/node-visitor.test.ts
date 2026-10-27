import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { NodeVisitor } from "../../src/modules/guardrails/node-visitor.js";

describe("Sprint 4 - Task 3: Recursive AST Node Visitor & Unknown Construct Blocker", () => {
    const visitor = new NodeVisitor();

    describe("Happy Path Complex AST Traversal", () => {
        it("successfully traverses complex query with joins, CASE, CAST, BETWEEN, and window functions", () => {
            const sql = `
                WITH regional_summary AS (
                    SELECT 
                        c.id as customer_id,
                        c.name,
                        COUNT(o.id) as order_count,
                        SUM(o.total_amount) as total_spent,
                        AVG(o.total_amount) as avg_spent,
                        ROW_NUMBER() OVER (ORDER BY SUM(o.total_amount) DESC) as rank
                    FROM customers c
                    LEFT JOIN orders o ON c.id = o.customer_id
                    WHERE c.created_at >= '2026-01-01'
                      AND (o.status = 'completed' OR o.status IS NULL)
                      AND o.total_amount BETWEEN 10 AND 5000
                    GROUP BY c.id, c.name
                    HAVING COUNT(o.id) > 0
                )
                SELECT 
                    rs.name,
                    rs.total_spent,
                    CASE 
                        WHEN rs.total_spent > 1000 THEN 'VIP'
                        ELSE 'Standard'
                    END as tier,
                    CAST(rs.avg_spent AS numeric) as rounded_avg
                FROM regional_summary rs
                ORDER BY rs.total_spent DESC
                LIMIT 50;
            `;

            const ast = parse(sql)[0];
            const result = visitor.visit(ast);

            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
            assert.ok(result.visitedNodesCount > 30);
            assert.ok(result.collected.tables.length >= 2);
            assert.ok(result.collected.functions.length >= 3);
            assert.ok(result.collected.ctes.length === 1);
        });

        it("accurately collects tables, column references, and function calls", () => {
            const sql = "SELECT c.name, COUNT(o.id) FROM customers c JOIN orders o ON c.id = o.customer_id GROUP BY c.name;";
            const ast = parse(sql)[0];
            const result = visitor.visit(ast);

            assert.equal(result.ok, true);
            const tableNames = result.collected.tables.map((t) => t.name?.name);
            assert.ok(tableNames.includes("customers"));
            assert.ok(tableNames.includes("orders"));

            const funcNames = result.collected.functions.map((f) => f.function?.name);
            assert.ok(funcNames.includes("count"));
        });
    });

    describe("Fail-Closed Unknown & Experimental Constructs", () => {
        it("blocks unknown or synthetic node constructs with UNSUPPORTED_NODE_TYPE", () => {
            const syntheticAst = {
                type: "select",
                columns: [
                    {
                        expr: {
                            type: "custom_unapproved_extension_node",
                            payload: "malicious_exploit",
                        },
                    },
                ],
            };

            const result = visitor.visit(syntheticAst);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "UNSUPPORTED_NODE_TYPE");
            assert.equal(result.findings[0].nodeType, "custom_unapproved_extension_node");
            assert.equal(result.findings[0].severity, "CRITICAL");
        });
    });

    describe("Administrative & Transactional Commands Blocker", () => {
        it("blocks administrative SET statements with ADMINISTRATIVE_COMMAND", () => {
            const ast = parse("SET statement_timeout = 5000;")[0];
            const result = visitor.visit(ast);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "ADMINISTRATIVE_COMMAND");
            assert.ok(result.findings[0].message.includes("Administrative statement 'SET'"));
        });

        it("blocks administrative SHOW statements with ADMINISTRATIVE_COMMAND", () => {
            const ast = parse("SHOW default_transaction_read_only;")[0];
            const result = visitor.visit(ast);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "ADMINISTRATIVE_COMMAND");
            assert.ok(result.findings[0].message.includes("Administrative statement 'SHOW'"));
        });

        it("blocks transaction control COMMIT statements with TRANSACTION_CONTROL", () => {
            const ast = parse("COMMIT;")[0];
            const result = visitor.visit(ast);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "TRANSACTION_CONTROL");
            assert.ok(result.findings[0].message.includes("Transaction control statement 'COMMIT'"));
        });

        it("blocks transaction control ROLLBACK statements with TRANSACTION_CONTROL", () => {
            const ast = parse("ROLLBACK;")[0];
            const result = visitor.visit(ast);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "TRANSACTION_CONTROL");
            assert.ok(result.findings[0].message.includes("Transaction control statement 'ROLLBACK'"));
        });

        it("blocks START TRANSACTION statements with TRANSACTION_CONTROL", () => {
            const ast = parse("START TRANSACTION;")[0];
            const result = visitor.visit(ast);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "TRANSACTION_CONTROL");
        });
    });

    describe("Mutating Statements & Locking Clauses", () => {
        it("blocks DELETE statements with FORBIDDEN_STATEMENT_TYPE", () => {
            const ast = parse("DELETE FROM customers;")[0];
            const result = visitor.visit(ast);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "FORBIDDEN_STATEMENT_TYPE");
        });

        it("blocks INSERT statements with FORBIDDEN_STATEMENT_TYPE", () => {
            const ast = parse("INSERT INTO customers (id) VALUES (1);")[0];
            const result = visitor.visit(ast);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "FORBIDDEN_STATEMENT_TYPE");
        });

        it("blocks DROP TABLE statements with FORBIDDEN_STATEMENT_TYPE", () => {
            const ast = parse("DROP TABLE orders;")[0];
            const result = visitor.visit(ast);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "FORBIDDEN_STATEMENT_TYPE");
        });

        it("blocks nested locking clauses with LOCKING_CLAUSE", () => {
            const ast = parse("SELECT * FROM orders FOR UPDATE;")[0];
            const result = visitor.visit(ast);

            assert.equal(result.ok, false);
            assert.equal(result.findings[0].code, "LOCKING_CLAUSE");
            assert.ok(result.findings[0].message.includes("FOR UPDATE"));
        });
    });

    describe("Depth Limit & Custom Hooks", () => {
        it("invokes custom onNode hook during traversal", () => {
            let hookCount = 0;
            const customVisitor = new NodeVisitor({
                onNode: () => {
                    hookCount++;
                },
            });

            const ast = parse("SELECT id FROM orders;")[0];
            customVisitor.visit(ast);

            assert.ok(hookCount > 0);
        });

        it("aborts and reports error when nesting depth exceeds maxDepth", () => {
            const shallowVisitor = new NodeVisitor({ maxDepth: 2 });
            const deepQuery = "SELECT (SELECT (SELECT 1));";
            const ast = parse(deepQuery)[0];
            const result = shallowVisitor.visit(ast);

            assert.equal(result.ok, false);
            assert.ok(result.findings.some((f) => f.code === "SYNTAX_ERROR" && f.message.includes("maximum depth limit")));
        });
    });
});
