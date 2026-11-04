import type { ExecutionResultResponse, ExecutionErrorCode } from "@text2sql/contracts";

export interface CachedExecutionEntry {
    executionId: string;
    userId: string;
    artifactId: string;
    result: ExecutionResultResponse;
    createdAt: number;
    expiresAt: number;
}

export interface ResultCacheLookup {
    ok: boolean;
    status: "FOUND" | "EXPIRED" | "NOT_FOUND" | "FORBIDDEN";
    errorCode?: ExecutionErrorCode | "FORBIDDEN";
    errorMessage?: string;
    result?: ExecutionResultResponse;
    remainingTtlMs?: number;
}

export class ResultCacheService {
    public static readonly DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes (900,000 ms)
    public static readonly MAX_CACHED_ROWS = 500;
    public static readonly MAX_CACHED_BYTES = 1024 * 1024; // 1 MiB (1,048,576 bytes)

    // executionId -> CachedExecutionEntry
    private readonly executionStore = new Map<string, CachedExecutionEntry>();

    // (userId:artifactId:idempotencyKey) -> Cached ExecutionResultResponse
    private readonly idempotencyStore = new Map<string, { result: ExecutionResultResponse; expiresAt: number }>();

    private readonly defaultTtlMs: number;
    private readonly maxRows: number;
    private readonly maxBytes: number;

    constructor(
        defaultTtlMs: number = ResultCacheService.DEFAULT_TTL_MS,
        maxRows: number = ResultCacheService.MAX_CACHED_ROWS,
        maxBytes: number = ResultCacheService.MAX_CACHED_BYTES
    ) {
        this.defaultTtlMs = defaultTtlMs;
        this.maxRows = maxRows;
        this.maxBytes = maxBytes;
    }

    /**
     * Stores execution result payload with strict memory bounds (row & byte cap) and ephemeral 15-minute TTL.
     */
    public setExecutionResult(
        executionId: string,
        userId: string,
        artifactId: string,
        rawResult: ExecutionResultResponse,
        ttlMs: number = this.defaultTtlMs
    ): CachedExecutionEntry {
        const now = Date.now();

        // Enforce per-entry row and byte bounds
        let rows = rawResult.rows;
        let rowCount = rawResult.rowCount;
        let truncated = rawResult.truncated;

        if (rows.length > this.maxRows) {
            rows = rows.slice(0, this.maxRows);
            rowCount = this.maxRows;
            truncated = true;
        }

        if (rawResult.byteSize > this.maxBytes) {
            truncated = true;
        }

        const boundedResult: ExecutionResultResponse = {
            ...rawResult,
            rows,
            rowCount,
            truncated,
        };

        const entry: CachedExecutionEntry = {
            executionId,
            userId,
            artifactId,
            result: boundedResult,
            createdAt: now,
            expiresAt: now + ttlMs,
        };

        this.executionStore.set(executionId, entry);
        return entry;
    }

    /**
     * Retrieves cached execution result with strict user ownership isolation and TTL check.
     * Automatically evicts expired entries on access and returns explicit RESULT_EXPIRED vs EXECUTION_NOT_FOUND.
     */
    public getExecutionResult(executionId: string, requestingUserId: string): ResultCacheLookup {
        const entry = this.executionStore.get(executionId);
        if (!entry) {
            return {
                ok: false,
                status: "NOT_FOUND",
                errorCode: "EXECUTION_NOT_FOUND",
                errorMessage: `Execution result '${executionId}' was not found.`,
            };
        }

        // 1. Strict tenant / ownership isolation
        if (entry.userId !== requestingUserId) {
            return {
                ok: false,
                status: "FORBIDDEN",
                errorCode: "FORBIDDEN",
                errorMessage: `Access denied. Execution result '${executionId}' belongs to another user.`,
            };
        }

        // 2. Strict 15-minute TTL expiration check
        const now = Date.now();
        if (now > entry.expiresAt) {
            this.executionStore.delete(executionId);
            return {
                ok: false,
                status: "EXPIRED",
                errorCode: "RESULT_EXPIRED",
                errorMessage: `Execution result '${executionId}' has expired (>15-minute TTL). Please re-run the query.`,
            };
        }

        return {
            ok: true,
            status: "FOUND",
            result: entry.result,
            remainingTtlMs: entry.expiresAt - now,
        };
    }

    /**
     * Stores idempotent response keyed by (userId, artifactId, idempotencyKey).
     */
    public setIdempotentResult(
        userId: string,
        artifactId: string,
        idempotencyKey: string,
        result: ExecutionResultResponse,
        ttlMs: number = this.defaultTtlMs
    ): void {
        const key = this.buildIdempotencyKey(userId, artifactId, idempotencyKey);
        this.idempotencyStore.set(key, {
            result,
            expiresAt: Date.now() + ttlMs,
        });
    }

    /**
     * Retrieves cached idempotent result if present and unexpired.
     */
    public getIdempotentResult(
        userId: string,
        artifactId: string,
        idempotencyKey: string
    ): ExecutionResultResponse | null {
        const key = this.buildIdempotencyKey(userId, artifactId, idempotencyKey);
        const entry = this.idempotencyStore.get(key);
        if (!entry) return null;

        if (Date.now() > entry.expiresAt) {
            this.idempotencyStore.delete(key);
            return null;
        }

        return entry.result;
    }

    /**
     * Returns remaining TTL in milliseconds for an owned execution result, or 0 if expired/absent.
     */
    public getRemainingTtlMs(executionId: string, requestingUserId: string): number {
        const lookup = this.getExecutionResult(executionId, requestingUserId);
        return lookup.remainingTtlMs ?? 0;
    }

    /**
     * Checks if executionId exists in store without checking expiration.
     */
    public has(executionId: string): boolean {
        return this.executionStore.has(executionId);
    }

    /**
     * Explicitly deletes an execution from cache.
     */
    public delete(executionId: string): boolean {
        return this.executionStore.delete(executionId);
    }

    /**
     * Evicts all expired entries across execution and idempotency stores.
     */
    public evictExpired(): { executionEvicted: number; idempotencyEvicted: number } {
        const now = Date.now();
        let executionEvicted = 0;
        let idempotencyEvicted = 0;

        for (const [key, entry] of this.executionStore.entries()) {
            if (now > entry.expiresAt) {
                this.executionStore.delete(key);
                executionEvicted++;
            }
        }

        for (const [key, entry] of this.idempotencyStore.entries()) {
            if (now > entry.expiresAt) {
                this.idempotencyStore.delete(key);
                idempotencyEvicted++;
            }
        }

        return { executionEvicted, idempotencyEvicted };
    }

    public clear(): void {
        this.executionStore.clear();
        this.idempotencyStore.clear();
    }

    public size(): { executions: number; idempotency: number } {
        return {
            executions: this.executionStore.size,
            idempotency: this.idempotencyStore.size,
        };
    }

    private buildIdempotencyKey(userId: string, artifactId: string, idempotencyKey: string): string {
        return `${userId}:${artifactId}:${idempotencyKey.trim()}`;
    }
}
