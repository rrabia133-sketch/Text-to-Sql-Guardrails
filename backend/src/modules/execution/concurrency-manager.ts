export interface ConcurrencyLimits {
    maxPerUser?: number;  // default: 2
    maxGlobal?: number;   // default: 10
}

export type ConcurrencyRejectionReason =
    | "USER_CONCURRENCY_EXCEEDED"
    | "GLOBAL_CONCURRENCY_EXCEEDED";

export interface ConcurrencyAcquireResult {
    allowed: boolean;
    reason?: ConcurrencyRejectionReason;
    activeUserCount: number;
    activeGlobalCount: number;
}

export class ConcurrencyManager {
    public static readonly DEFAULT_MAX_PER_USER = 2;
    public static readonly DEFAULT_MAX_GLOBAL = 10;

    private readonly maxPerUser: number;
    private readonly maxGlobal: number;

    // In-memory active execution trackers
    private userActiveMap: Map<string, Set<string>> = new Map();
    private activeGlobalExecutions: Set<string> = new Set();

    constructor(limits?: ConcurrencyLimits) {
        this.maxPerUser = limits?.maxPerUser ?? ConcurrencyManager.DEFAULT_MAX_PER_USER;
        this.maxGlobal = limits?.maxGlobal ?? ConcurrencyManager.DEFAULT_MAX_GLOBAL;
    }

    /**
     * Attempts to acquire an execution slot for the given user and execution ID.
     */
    public acquire(userId: string, executionId: string): ConcurrencyAcquireResult {
        const userActive = this.userActiveMap.get(userId) || new Set();

        // 1. Check Global Concurrency Bound
        if (this.activeGlobalExecutions.size >= this.maxGlobal) {
            return {
                allowed: false,
                reason: "GLOBAL_CONCURRENCY_EXCEEDED",
                activeUserCount: userActive.size,
                activeGlobalCount: this.activeGlobalExecutions.size,
            };
        }

        // 2. Check Per-User Concurrency Bound
        if (userActive.size >= this.maxPerUser) {
            return {
                allowed: false,
                reason: "USER_CONCURRENCY_EXCEEDED",
                activeUserCount: userActive.size,
                activeGlobalCount: this.activeGlobalExecutions.size,
            };
        }

        // 3. Acquire slot
        userActive.add(executionId);
        this.userActiveMap.set(userId, userActive);
        this.activeGlobalExecutions.add(executionId);

        return {
            allowed: true,
            activeUserCount: userActive.size,
            activeGlobalCount: this.activeGlobalExecutions.size,
        };
    }

    /**
     * Releases an execution slot upon query completion, error, or cancellation.
     */
    public release(userId: string, executionId: string): void {
        this.activeGlobalExecutions.delete(executionId);

        const userActive = this.userActiveMap.get(userId);
        if (userActive) {
            userActive.delete(executionId);
            if (userActive.size === 0) {
                this.userActiveMap.delete(userId);
            }
        }
    }

    public getActiveUserCount(userId: string): number {
        return this.userActiveMap.get(userId)?.size ?? 0;
    }

    public getActiveGlobalCount(): number {
        return this.activeGlobalExecutions.size;
    }

    public clear(): void {
        this.userActiveMap.clear();
        this.activeGlobalExecutions.clear();
    }
}
