import type { Pool } from "pg";
import { AstPlanCostResult, GuardrailFinding } from "@text2sql/contracts";

export interface PlanCostGateOptions {
    pool?: Pool | null;
    maxAllowedCost?: number;  // Defaults to 10,000
    timeoutMs?: number;       // Defaults to 2000
}

export interface PlanCostGateResult {
    ok: boolean;
    findings: GuardrailFinding[];
    costResult?: AstPlanCostResult;
}

export class PlanCostGate {
    private pool?: Pool | null;
    private maxAllowedCost: number;
    private timeoutMs: number;

    constructor(options?: PlanCostGateOptions) {
        this.pool = options?.pool;
        this.maxAllowedCost = options?.maxAllowedCost ?? 10000;
        this.timeoutMs = options?.timeoutMs ?? 2000;
    }

    /**
     * Executes EXPLAIN (FORMAT JSON) within an isolated, read-only transaction on analytics_db.
     * Guaranteed to rollback and never perform table mutations or leave open connections.
     */
    public async estimateCost(sql: string): Promise<PlanCostGateResult> {
        if (!this.pool) {
            // Dry-run / offline fallback when pool is not configured
            return {
                ok: true,
                findings: [],
                costResult: {
                    totalCost: 0,
                    maxAllowedCost: this.maxAllowedCost,
                    estimatedRows: 0,
                    acceptable: true,
                    planNodes: [],
                },
            };
        }

        let client: any;
        try {
            client = await this.pool.connect();
        } catch (err: any) {
            return {
                ok: false,
                findings: [
                    {
                        code: "SYNTAX_ERROR",
                        severity: "CRITICAL",
                        message: `Failed to connect to database for EXPLAIN cost check: ${err.message}`,
                    },
                ],
            };
        }

        try {
            // Strict read-only transaction containment with statement timeout
            await client.query("BEGIN TRANSACTION READ ONLY;");
            await client.query(`SET LOCAL statement_timeout = '${this.timeoutMs}ms';`);

            const explainRes = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`);
            await client.query("ROLLBACK;");

            const rows = explainRes?.rows;
            if (!rows || rows.length === 0) {
                return {
                    ok: false,
                    findings: [
                        {
                            code: "SYNTAX_ERROR",
                            severity: "CRITICAL",
                            message: "EXPLAIN query returned no plan rows.",
                        },
                    ],
                };
            }

            const rawPlan = rows[0]["QUERY PLAN"] || rows[0]["query plan"] || rows[0];
            return this.evaluatePlan(rawPlan);
        } catch (err: any) {
            try {
                await client.query("ROLLBACK;");
            } catch {
                // Ignore rollback failure on already aborted connection
            }

            const msg = String(err.message || err);
            const isTimeout = msg.toLowerCase().includes("timeout");

            return {
                ok: false,
                findings: [
                    {
                        code: isTimeout ? "EXCESSIVE_PLAN_COST" : "SYNTAX_ERROR",
                        severity: "CRITICAL",
                        message: isTimeout
                            ? `Query plan estimation statement timeout occurred after ${this.timeoutMs}ms. Possible excessive complexity or unindexed join.`
                            : `EXPLAIN execution failed: ${msg}`,
                    },
                ],
            };
        } finally {
            client.release();
        }
    }

    /**
     * Evaluates a parsed PostgreSQL JSON query plan against cost and complexity rules.
     */
    public evaluatePlan(planData: any): PlanCostGateResult {
        const rootPlanNode = Array.isArray(planData) ? planData[0]?.Plan : planData?.Plan || planData;

        if (!rootPlanNode || typeof rootPlanNode !== "object") {
            return {
                ok: false,
                findings: [
                    {
                        code: "SYNTAX_ERROR",
                        severity: "CRITICAL",
                        message: "Invalid query plan format returned by EXPLAIN.",
                    },
                ],
            };
        }

        const totalCost = typeof rootPlanNode["Total Cost"] === "number" ? rootPlanNode["Total Cost"] : 0;
        const estimatedRows = typeof rootPlanNode["Plan Rows"] === "number" ? rootPlanNode["Plan Rows"] : 0;

        // Recursively extract all plan node types
        const planNodes: string[] = [];
        const walk = (node: any) => {
            if (!node || typeof node !== "object") return;
            if (typeof node["Node Type"] === "string") {
                planNodes.push(node["Node Type"]);
            }
            if (Array.isArray(node.Plans)) {
                for (const p of node.Plans) {
                    walk(p);
                }
            }
        };
        walk(rootPlanNode);

        const acceptable = totalCost <= this.maxAllowedCost;
        const findings: GuardrailFinding[] = [];

        if (!acceptable) {
            findings.push({
                code: "EXCESSIVE_PLAN_COST",
                severity: "CRITICAL",
                target: String(totalCost),
                message: `Estimated query plan cost (${totalCost}) exceeds maximum allowed cost threshold (${this.maxAllowedCost}).`,
            });
        }

        const costResult: AstPlanCostResult = {
            totalCost,
            maxAllowedCost: this.maxAllowedCost,
            estimatedRows,
            acceptable,
            planNodes,
        };

        return {
            ok: acceptable,
            findings,
            costResult,
        };
    }
}
