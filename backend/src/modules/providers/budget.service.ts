import type { Pool } from "pg";
import { config } from "../../config/env.js";
import { ProviderQuotaError } from "./base.provider.js";

export interface TokenUsageRecord {
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
}

export interface BudgetStatus {
    budgetLimitUsd: number;
    spentTodayUsd: number;
    remainingUsd: number;
    isCapReached: boolean;
}

export class BudgetService {
    private appPool?: Pool | null;
    private dailyBudgetUsd: number;

    // In-memory fallback tracking for testing or standalone execution
    private inMemoryTodaySpend: number = 0;
    private inMemoryDate: string = new Date().toISOString().slice(0, 10);

    constructor(appPool?: Pool | null, dailyBudgetUsd: number = config.DAILY_CLOUD_BUDGET_USD) {
        this.appPool = appPool;
        this.dailyBudgetUsd = dailyBudgetUsd;
    }

    /**
     * Computes dollar cost based on model token pricing tiers.
     */
    calculateCost(provider: string, model: string, promptTokens: number, completionTokens: number): number {
        if (provider === "ollama") {
            // Local inference costs $0.00
            return 0;
        }

        // Groq llama-3.3-70b pricing: ~$0.59 / 1M prompt, $0.79 / 1M completion
        if (provider === "groq") {
            const promptRate = 0.59 / 1_000_000;
            const completionRate = 0.79 / 1_000_000;
            const cost = promptTokens * promptRate + completionTokens * completionRate;
            return Math.round(cost * 1_000_000) / 1_000_000;
        }

        // Default cloud fallback rate: $1.00 / 1M tokens
        const defaultRate = 1.0 / 1_000_000;
        return Math.round((promptTokens + completionTokens) * defaultRate * 1_000_000) / 1_000_000;
    }

    /**
     * Checks if today's accumulated spend has reached or exceeded the configured daily cap.
     * Throws ProviderQuotaError (HTTP 429) if budget is exhausted.
     */
    async checkBudgetOrThrow(provider: string): Promise<void> {
        if (provider === "ollama") {
            return; // Local compute is free
        }

        const spentToday = await this.getTodaySpend();
        if (spentToday >= this.dailyBudgetUsd) {
            throw new ProviderQuotaError(
                provider,
                `Daily cloud budget cap of $${this.dailyBudgetUsd.toFixed(2)} USD exceeded. (Accumulated today: $${spentToday.toFixed(4)} USD). Cloud generation halted.`
            );
        }
    }

    /**
     * Retrieves cumulative dollar cost accumulated today.
     */
    async getTodaySpend(): Promise<number> {
        this.checkDateRollover();

        if (this.appPool) {
            try {
                const query = `
                    SELECT COALESCE(SUM(estimated_cost_usd), 0) AS daily_total
                    FROM provider_usage_ledger
                    WHERE date = CURRENT_DATE;
                `;
                const res = await this.appPool.query(query);
                if (res.rows?.[0]?.daily_total != null) {
                    return Number.parseFloat(res.rows[0].daily_total);
                }
            } catch {
                // Fall back to in-memory tracking if database unavailable
            }
        }

        return this.inMemoryTodaySpend;
    }

    /**
     * Records token usage and persists cost in ledger.
     */
    async recordUsage(record: TokenUsageRecord): Promise<number> {
        const costUsd = this.calculateCost(
            record.provider,
            record.model,
            record.promptTokens,
            record.completionTokens
        );

        this.checkDateRollover();
        this.inMemoryTodaySpend += costUsd;

        if (this.appPool) {
            try {
                const insertQuery = `
                    INSERT INTO provider_usage_ledger (
                        provider, model, prompt_tokens, completion_tokens, estimated_cost_usd, request_count
                    ) VALUES ($1, $2, $3, $4, $5, 1);
                `;
                await this.appPool.query(insertQuery, [
                    record.provider,
                    record.model,
                    record.promptTokens,
                    record.completionTokens,
                    costUsd,
                ]);
            } catch {
                // In-memory tracked
            }
        }

        return costUsd;
    }

    /**
     * Returns a summary status for budget introspection.
     */
    async getBudgetStatus(): Promise<BudgetStatus> {
        const spentTodayUsd = await this.getTodaySpend();
        const remainingUsd = Math.max(0, this.dailyBudgetUsd - spentTodayUsd);

        return {
            budgetLimitUsd: this.dailyBudgetUsd,
            spentTodayUsd: Math.round(spentTodayUsd * 10_000) / 10_000,
            remainingUsd: Math.round(remainingUsd * 10_000) / 10_000,
            isCapReached: spentTodayUsd >= this.dailyBudgetUsd,
        };
    }

    /**
     * Sets today's spend directly (useful in unit testing budget cap trips).
     */
    setSimulatedTodaySpend(amount: number): void {
        this.inMemoryTodaySpend = amount;
    }

    private checkDateRollover(): void {
        const todayStr = new Date().toISOString().slice(0, 10);
        if (todayStr !== this.inMemoryDate) {
            this.inMemoryDate = todayStr;
            this.inMemoryTodaySpend = 0;
        }
    }
}
