import { Pool } from "pg";
import type { DatabaseCheckStatus, ReadinessResponse } from "@text2sql/contracts";

export interface DatabaseCheckResult {
    analyticsDb: {
        status: DatabaseCheckStatus;
        isReadOnly: boolean;
        latencyMs?: number;
    };
    appDb: {
        status: DatabaseCheckStatus;
        latencyMs?: number;
    };
}

export interface IDatabaseChecker {
    checkHealth(): Promise<DatabaseCheckResult>;
    close?(): Promise<void>;
}

export class PostgresDatabaseChecker implements IDatabaseChecker {
    private analyticsPool: Pool;
    private appPool: Pool;

    constructor(analyticsUrl: string, appUrl: string) {
        this.analyticsPool = new Pool({
            connectionString: analyticsUrl,
            connectionTimeoutMillis: 2000,
            max: 2,
        });
        this.appPool = new Pool({
            connectionString: appUrl,
            connectionTimeoutMillis: 2000,
            max: 2,
        });
    }

    async checkAnalyticsDb(): Promise<{
        status: DatabaseCheckStatus;
        isReadOnly: boolean;
        latencyMs?: number;
    }> {
        const start = Date.now();
        let client;
        try {
            client = await this.analyticsPool.connect();
            await client.query("SELECT 1");

            let isReadOnly = false;
            try {
                const roRes = await client.query("SHOW default_transaction_read_only");
                if (roRes.rows[0]?.default_transaction_read_only === "on") {
                    isReadOnly = true;
                } else {
                    const fallbackRes = await client.query("SHOW transaction_read_only");
                    isReadOnly = fallbackRes.rows[0]?.transaction_read_only === "on";
                }
            } catch {
                // If SHOW fails, keep default false
            }

            return {
                status: "connected",
                isReadOnly,
                latencyMs: Date.now() - start,
            };
        } catch {
            return {
                status: "disconnected",
                isReadOnly: false,
            };
        } finally {
            if (client) client.release();
        }
    }

    async checkAppDb(): Promise<{
        status: DatabaseCheckStatus;
        latencyMs?: number;
    }> {
        const start = Date.now();
        let client;
        try {
            client = await this.appPool.connect();
            await client.query("SELECT 1");
            return {
                status: "connected",
                latencyMs: Date.now() - start,
            };
        } catch {
            return {
                status: "disconnected",
            };
        } finally {
            if (client) client.release();
        }
    }

    async checkHealth(): Promise<DatabaseCheckResult> {
        const [analyticsDb, appDb] = await Promise.all([
            this.checkAnalyticsDb(),
            this.checkAppDb(),
        ]);
        return { analyticsDb, appDb };
    }

    async close(): Promise<void> {
        await Promise.allSettled([
            this.analyticsPool.end(),
            this.appPool.end(),
        ]);
    }
}
