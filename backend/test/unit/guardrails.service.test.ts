import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GuardrailsService } from "../../src/modules/guardrails/guardrails.service.js";
import { PlanCostGate } from "../../src/modules/guardrails/plan-cost-gate.js";

describe("Sprint 4 - Task 9: Unified Guardrails Orchestrator & Finding Aggregation", () => {
    const service = new GuardrailsService();

    describe("Happy Path Full Pipeline Verification", () => {
        it("orchestrates all guardrails, normalizes SQL, injects LIMIT, and returns rich metadata", async () => {
            const sql = `
                SELECT c.name, o.id, o.status 
                FROM customers c 
                JOIN orders o ON c.id = o.customer_id 
                WHERE o.status = 'completed';
            `;

            const result = await service.validate(sql);

            assert.equal(result.valid, true);
            assert.equal(result.status, "passed");
            assert.equal(result.violations.length, 0);

            // Normalized SQL should carry injected LIMIT 50
            assert.ok(result.normalizedSql);
            assert.ok(result.normalizedSql?.includes("LIMIT (50)") || result.normalizedSql?.includes("LIMIT 50"));

            // Rich metadata checks
            assert.ok(result.metadata);
            assert.ok(result.metadata?.referencedTables.includes("customers"));
            assert.ok(result.metadata?.referencedTables.includes("orders"));
            assert.ok(result.metadata?.referencedColumns.includes("customers.name"));
            assert.ok(result.metadata?.referencedColumns.includes("orders.id"));
            assert.equal(result.metadata?.hasLimit, true);
            assert.equal(result.metadata?.limitValue, 50);
        });

        it("validates queries with CTEs and aggregates", async () => {
            const sql = `
                WITH regional_spending AS (
                    SELECT c.id, c.region, COUNT(o.id) as order_count
                    FROM customers c
                    JOIN orders o ON c.id = o.customer_id
                    GROUP BY c.id, c.region
                )
                SELECT rs.region, rs.order_count
                FROM regional_spending rs
                ORDER BY rs.order_count DESC;
            `;

            const result = await service.validate(sql);

            assert.equal(result.valid, true);
            assert.equal(result.status, "passed");
            assert.equal(result.violations.length, 0);
            assert.equal(result.metadata?.hasCte, true);
        });
    });

    describe("Fail-Closed Security Rejections", () => {
        it("rejects multi-statement attacks with MULTIPLE_STATEMENTS", async () => {
            const sql = "SELECT id FROM orders; DROP TABLE orders;";
            const result = await service.validate(sql);

            assert.equal(result.valid, false);
            assert.equal(result.status, "rejected");
            assert.ok(result.violations.some(v => v.code === "MULTIPLE_STATEMENTS"));
        });

        it("rejects non-SELECT DDL/DML with FORBIDDEN_STATEMENT_TYPE", async () => {
            const sql = "DELETE FROM orders WHERE id = 1;";
            const result = await service.validate(sql);

            assert.equal(result.valid, false);
            assert.equal(result.status, "rejected");
            assert.ok(result.violations.some(v => v.code === "FORBIDDEN_STATEMENT_TYPE"));
        });

        it("rejects locking clauses with LOCKING_CLAUSE", async () => {
            const sql = "SELECT id FROM orders FOR UPDATE;";
            const result = await service.validate(sql);

            assert.equal(result.valid, false);
            assert.equal(result.status, "rejected");
            assert.ok(result.violations.some(v => v.code === "LOCKING_CLAUSE"));
        });

        it("rejects PostgreSQL catalog access with FORBIDDEN_CATALOG", async () => {
            const sql = "SELECT tablename FROM pg_catalog.pg_tables;";
            const result = await service.validate(sql);

            assert.equal(result.valid, false);
            assert.equal(result.status, "rejected");
            assert.ok(result.violations.some(v => v.code === "FORBIDDEN_CATALOG"));
        });

        it("rejects dangerous functions with FORBIDDEN_FUNCTION", async () => {
            const sql = "SELECT id, pg_sleep(5) FROM orders;";
            const result = await service.validate(sql);

            assert.equal(result.valid, false);
            assert.equal(result.status, "rejected");
            assert.ok(result.violations.some(v => v.code === "FORBIDDEN_FUNCTION"));
        });

        it("rejects ambiguous un-aliased columns with UNRESOLVED_IDENTIFIER", async () => {
            const sql = "SELECT id FROM customers c JOIN orders o ON c.id = o.customer_id;";
            const result = await service.validate(sql);

            assert.equal(result.valid, false);
            assert.equal(result.status, "rejected");
            assert.ok(result.violations.some(v => v.code === "UNRESOLVED_IDENTIFIER"));
        });

        it("rejects circular CTEs with UNRESOLVED_IDENTIFIER", async () => {
            const sql = `
                WITH cte_a AS (SELECT * FROM cte_b),
                cte_b AS (SELECT * FROM cte_a)
                SELECT * FROM cte_a;
            `;
            const result = await service.validate(sql);

            assert.equal(result.valid, false);
            assert.equal(result.status, "rejected");
            assert.ok(result.violations.some(v => v.code === "UNRESOLVED_IDENTIFIER"));
        });

        it("rejects excessive plan costs when checkPlanCost is enabled", async () => {
            const mockPlanGate = {
                estimateCost: async () => ({
                    ok: false,
                    findings: [
                        {
                            code: "EXCESSIVE_PLAN_COST" as const,
                            severity: "CRITICAL" as const,
                            message: "Estimated query plan cost (25000) exceeds maximum allowed cost threshold (10000).",
                        },
                    ],
                }),
            };

            const strictCostService = new GuardrailsService({
                planGate: mockPlanGate as any,
                checkPlanCost: true,
            });

            const sql = "SELECT c.name FROM customers c;";
            const result = await strictCostService.validate(sql);

            assert.equal(result.valid, false);
            assert.equal(result.status, "rejected");
            assert.ok(result.violations.some(v => v.code === "EXCESSIVE_PLAN_COST"));
        });
    });
});
