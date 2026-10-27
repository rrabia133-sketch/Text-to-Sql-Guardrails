import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PlanCostGate } from "../../src/modules/guardrails/plan-cost-gate.js";

describe("Sprint 4 - Task 8: EXPLAIN Plan Cost Gatekeeper & Complexity Analyzer", () => {
    const gate = new PlanCostGate({ maxAllowedCost: 10000 });

    describe("Plan Evaluation Logic (evaluatePlan)", () => {
        it("accepts low-cost analytical query plan within threshold", () => {
            const lowCostPlan = [
                {
                    Plan: {
                        "Node Type": "Seq Scan",
                        "Relation Name": "customers",
                        Alias: "c",
                        "Startup Cost": 0.0,
                        "Total Cost": 25.5,
                        "Plan Rows": 50,
                        "Plan Width": 32,
                    },
                },
            ];

            const result = gate.evaluatePlan(lowCostPlan);

            assert.equal(result.ok, true);
            assert.equal(result.findings.length, 0);
            assert.ok(result.costResult);
            assert.equal(result.costResult?.totalCost, 25.5);
            assert.equal(result.costResult?.maxAllowedCost, 10000);
            assert.equal(result.costResult?.acceptable, true);
            assert.ok(result.costResult?.planNodes.includes("Seq Scan"));
        });

        it("rejects excessive query plan cost exceeding MAX_PLAN_COST", () => {
            const highCostPlan = [
                {
                    Plan: {
                        "Node Type": "Hash Join",
                        "Startup Cost": 1500.0,
                        "Total Cost": 18450.0, // > 10,000 threshold
                        "Plan Rows": 250000,
                        "Plan Width": 128,
                        Plans: [
                            { "Node Type": "Seq Scan", "Total Cost": 5000.0 },
                            { "Node Type": "Hash", "Total Cost": 8000.0 },
                        ],
                    },
                },
            ];

            const result = gate.evaluatePlan(highCostPlan);

            assert.equal(result.ok, false);
            assert.equal(result.costResult?.acceptable, false);
            assert.equal(result.costResult?.totalCost, 18450.0);
            assert.ok(result.findings.some(f => f.code === "EXCESSIVE_PLAN_COST" && f.message.includes("18450")));
        });

        it("recursively collects all plan node types in complex join plans", () => {
            const complexPlan = [
                {
                    Plan: {
                        "Node Type": "Limit",
                        "Total Cost": 85.0,
                        "Plan Rows": 50,
                        Plans: [
                            {
                                "Node Type": "Sort",
                                "Total Cost": 84.5,
                                Plans: [
                                    {
                                        "Node Type": "Nested Loop",
                                        "Total Cost": 75.0,
                                        Plans: [
                                            { "Node Type": "Index Scan", "Total Cost": 15.0 },
                                            { "Node Type": "Seq Scan", "Total Cost": 45.0 },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            ];

            const result = gate.evaluatePlan(complexPlan);

            assert.equal(result.ok, true);
            assert.ok(result.costResult?.planNodes.includes("Limit"));
            assert.ok(result.costResult?.planNodes.includes("Sort"));
            assert.ok(result.costResult?.planNodes.includes("Nested Loop"));
            assert.ok(result.costResult?.planNodes.includes("Index Scan"));
            assert.ok(result.costResult?.planNodes.includes("Seq Scan"));
        });
    });

    describe("Database Transaction Containment & Mock Execution", () => {
        it("executes EXPLAIN inside isolated read-only transaction and rolls back", async () => {
            const executedQueries: string[] = [];
            let clientReleased = false;

            const mockClient = {
                query: async (queryText: string) => {
                    executedQueries.push(queryText);
                    if (queryText.startsWith("EXPLAIN (FORMAT JSON)")) {
                        return {
                            rows: [
                                {
                                    "QUERY PLAN": [
                                        {
                                            Plan: {
                                                "Node Type": "Seq Scan",
                                                "Total Cost": 12.0,
                                                "Plan Rows": 10,
                                            },
                                        },
                                    ],
                                },
                            ],
                        };
                    }
                    return { rows: [] };
                },
                release: () => {
                    clientReleased = true;
                },
            };

            const mockPool = {
                connect: async () => mockClient,
            };

            const dbGate = new PlanCostGate({ pool: mockPool as any, maxAllowedCost: 10000 });
            const result = await dbGate.estimateCost("SELECT id FROM orders;");

            assert.equal(result.ok, true);
            assert.equal(result.costResult?.totalCost, 12.0);
            assert.equal(clientReleased, true);

            // Verify transaction boundaries
            assert.ok(executedQueries.some(q => q.includes("BEGIN TRANSACTION READ ONLY") || q.includes("BEGIN READ ONLY")));
            assert.ok(executedQueries.some(q => q.includes("statement_timeout")));
            assert.ok(executedQueries.some(q => q.includes("EXPLAIN (FORMAT JSON)")));
            assert.ok(executedQueries.some(q => q.includes("ROLLBACK")));
        });

        it("fails closed with EXCESSIVE_PLAN_COST when database statement timeout occurs during EXPLAIN", async () => {
            const mockClient = {
                query: async (queryText: string) => {
                    if (queryText.startsWith("EXPLAIN (FORMAT JSON)")) {
                        throw new Error("canceling statement due to statement timeout");
                    }
                    return { rows: [] };
                },
                release: () => { },
            };

            const mockPool = {
                connect: async () => mockClient,
            };

            const dbGate = new PlanCostGate({ pool: mockPool as any });
            const result = await dbGate.estimateCost("SELECT * FROM huge_cartesian_join;");

            assert.equal(result.ok, false);
            assert.ok(result.findings.some(f => f.code === "EXCESSIVE_PLAN_COST" && f.message.includes("timeout")));
        });
    });
});
