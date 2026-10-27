import type { Pool, PoolClient } from "pg";
import type {
    ColumnTypeMetadata,
    ExecutionErrorCode,
    JsDataType,
} from "@text2sql/contracts";

export interface RestrictedExecutionOptions {
    statementTimeoutMs?: number; // default: 5000ms
    lockTimeoutMs?: number;      // default: 1000ms
    maxRows?: number;            // default: 500
    maxBytes?: number;           // default: 1 MiB (1048576)
}

export interface RestrictedExecutionSuccess {
    ok: true;
    columns: ColumnTypeMetadata[];
    rows: Record<string, unknown>[];
    rowCount: number;
    byteSize: number;
    executionTimeMs: number;
    truncated: boolean;
}

export interface RestrictedExecutionFailure {
    ok: false;
    errorCode: ExecutionErrorCode;
    errorMessage: string;
    executionTimeMs: number;
}

export type RestrictedExecutionResult =
    | RestrictedExecutionSuccess
    | RestrictedExecutionFailure;

/**
 * Maps PostgreSQL data type OIDs to standard JS data types and canonical type names.
 */
export function mapPgOidToType(dataTypeId: number): { pgType: string; jsType: JsDataType } {
    switch (dataTypeId) {
        // Integers & Floats
        case 20: // int8
            return { pgType: "bigint", jsType: "number" };
        case 21: // int2
            return { pgType: "smallint", jsType: "number" };
        case 23: // int4
            return { pgType: "integer", jsType: "number" };
        case 700: // float4
            return { pgType: "real", jsType: "number" };
        case 701: // float8
            return { pgType: "double precision", jsType: "number" };
        case 1700: // numeric
            return { pgType: "numeric", jsType: "number" };

        // Booleans
        case 16: // bool
            return { pgType: "boolean", jsType: "boolean" };

        // Dates & Timestamps
        case 1082: // date
            return { pgType: "date", jsType: "date" };
        case 1083: // time
        case 1266: // timetz
            return { pgType: "time", jsType: "string" };
        case 1114: // timestamp
            return { pgType: "timestamp", jsType: "date" };
        case 1184: // timestamptz
            return { pgType: "timestamptz", jsType: "date" };

        // JSON & JSONB
        case 114: // json
            return { pgType: "json", jsType: "object" };
        case 3802: // jsonb
            return { pgType: "jsonb", jsType: "object" };

        // Textual
        case 18: // char
        case 25: // text
        case 1042: // bpchar
        case 1043: // varchar
        case 2950: // uuid
            return { pgType: "text", jsType: "string" };

        default:
            return { pgType: "unknown", jsType: "string" };
    }
}

import { ResourceLimiter } from "./resource-limiter.js";

export class RestrictedExecutor {
    private readonly limiter: ResourceLimiter;
    private readonly defaultOptions?: RestrictedExecutionOptions;

    constructor(
        private readonly pool?: Pool | null,
        limiterOrOptions?: ResourceLimiter | RestrictedExecutionOptions
    ) {
        if (limiterOrOptions instanceof ResourceLimiter) {
            this.limiter = limiterOrOptions;
        } else if (limiterOrOptions) {
            this.limiter = new ResourceLimiter();
            this.defaultOptions = limiterOrOptions;
        } else {
            this.limiter = new ResourceLimiter();
        }
    }

    /**
     * Executes SQL inside a sandboxed, read-only transaction on analytics_db.
     */
    public async execute(
        sql: string,
        options?: RestrictedExecutionOptions
    ): Promise<RestrictedExecutionResult> {
        const statementTimeoutMs = options?.statementTimeoutMs ?? this.defaultOptions?.statementTimeoutMs ?? 5000;
        const lockTimeoutMs = options?.lockTimeoutMs ?? this.defaultOptions?.lockTimeoutMs ?? 1000;
        const maxRows = options?.maxRows ?? this.defaultOptions?.maxRows ?? 500;
        const maxBytes = options?.maxBytes ?? this.defaultOptions?.maxBytes ?? 1024 * 1024; // 1 MiB

        if (!this.pool) {
            // Mock execution for unit tests or when pool is not available
            return this.executeMock(sql, options);
        }

        let client: PoolClient | undefined;
        const startTime = Date.now();

        try {
            client = await this.pool.connect();

            // 1. Enter strict read-only transaction block with local timeouts
            await client.query("BEGIN TRANSACTION READ ONLY;");
            await client.query(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms';`);
            await client.query(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms';`);

            // 2. Dispatch analytical query
            const result = await client.query(sql);

            // 3. Commit clean read-only transaction
            await client.query("COMMIT;");

            const executionTimeMs = Date.now() - startTime;

            // 4. Map columns & metadata
            const columns: ColumnTypeMetadata[] = (result.fields || []).map(f => {
                const { pgType, jsType } = mapPgOidToType(f.dataTypeID);
                return {
                    name: f.name,
                    pgType,
                    jsType,
                    nullable: true,
                };
            });

            // 5. Enforce Row Cap, Byte Cap & Deterministic Formatting
            const limited = this.limiter.enforce(result.rows || [], { maxRows, maxBytes });

            return {
                ok: true,
                columns,
                rows: limited.rows,
                rowCount: limited.rowCount,
                byteSize: limited.byteSize,
                executionTimeMs,
                truncated: limited.truncated,
            };
        } catch (err: any) {
            const executionTimeMs = Date.now() - startTime;

            if (client) {
                try {
                    await client.query("ROLLBACK;");
                } catch {
                    // Ignore rollback errors during client failure
                }
            }

            // PostgreSQL Kernel-Level Error Code Trapping
            if (err.code === "25006") {
                // read_only_sql_transaction
                return {
                    ok: false,
                    errorCode: "TRANSACTION_VIOLATION",
                    errorMessage: "Write operation blocked by PostgreSQL read-only transaction containment.",
                    executionTimeMs,
                };
            }

            if (err.code === "57014") {
                // query_canceled (statement_timeout)
                return {
                    ok: false,
                    errorCode: "EXECUTION_TIMEOUT",
                    errorMessage: `Query execution canceled: exceeded ${statementTimeoutMs}ms statement timeout limit.`,
                    executionTimeMs,
                };
            }

            if (err.code === "55P03") {
                // lock_not_available
                return {
                    ok: false,
                    errorCode: "EXECUTION_TIMEOUT",
                    errorMessage: `Query aborted: exceeded ${lockTimeoutMs}ms lock timeout limit.`,
                    executionTimeMs,
                };
            }

            return {
                ok: false,
                errorCode: "DATABASE_ERROR",
                errorMessage: err.message || "An unexpected database error occurred during execution.",
                executionTimeMs,
            };
        } finally {
            if (client) {
                client.release();
            }
        }
    }

    /**
     * In-memory mock execution handler for tests when pool is offline.
     */
    private executeMock(sql: string, options?: RestrictedExecutionOptions): RestrictedExecutionResult {
        const lower = sql.toLowerCase().trim();
        const maxRows = options?.maxRows ?? this.defaultOptions?.maxRows ?? 500;

        // Simulate write rejection in mock mode
        if (
            lower.startsWith("insert") ||
            lower.startsWith("update") ||
            lower.startsWith("delete") ||
            lower.startsWith("drop") ||
            lower.startsWith("alter") ||
            lower.startsWith("truncate") ||
            lower.startsWith("create")
        ) {
            return {
                ok: false,
                errorCode: "TRANSACTION_VIOLATION",
                errorMessage: "Write operation blocked by PostgreSQL read-only transaction containment.",
                executionTimeMs: 5,
            };
        }

        // Simulate timeout trigger
        if (lower.includes("pg_sleep")) {
            return {
                ok: false,
                errorCode: "EXECUTION_TIMEOUT",
                errorMessage: "Query execution canceled: exceeded statement timeout limit.",
                executionTimeMs: options?.statementTimeoutMs ?? 5000,
            };
        }

        const mockRows: Record<string, unknown>[] = [
            { id: 1, name: "Acme Corp", region: "NA" },
            { id: 2, name: "Global Tech", region: "EMEA" },
        ];

        const truncated = mockRows.length > maxRows;
        const sliced = mockRows.slice(0, maxRows);

        return {
            ok: true,
            columns: [
                { name: "id", pgType: "integer", jsType: "number", nullable: true },
                { name: "name", pgType: "text", jsType: "string", nullable: true },
                { name: "region", pgType: "text", jsType: "string", nullable: true },
            ],
            rows: sliced,
            rowCount: sliced.length,
            byteSize: Buffer.byteLength(JSON.stringify(sliced), "utf8"),
            executionTimeMs: 12,
            truncated,
        };
    }
}
