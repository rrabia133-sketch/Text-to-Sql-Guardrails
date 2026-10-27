import type { Pool, PoolClient } from "pg";

export interface ActiveExecutionHandle {
    executionId: string;
    userId: string;
    client?: PoolClient;
    backendPid?: number;
    cancelled: boolean;
    startedAt: number;
}

export class CancellationService {
    private activeHandles: Map<string, ActiveExecutionHandle> = new Map();

    constructor(private readonly pool?: Pool | null) {}

    /**
     * Registers an active execution with its backend PID and client connection.
     */
    public register(
        executionId: string,
        userId: string,
        client?: PoolClient,
        backendPid?: number
    ): void {
        this.activeHandles.set(executionId, {
            executionId,
            userId,
            client,
            backendPid,
            cancelled: false,
            startedAt: Date.now(),
        });
    }

    /**
     * Unregisters an execution upon normal completion or exit.
     */
    public unregister(executionId: string): void {
        this.activeHandles.delete(executionId);
    }

    /**
     * Cancels an active query by execution ID.
     * Invokes `pg_cancel_backend(pid)` if connected to PostgreSQL.
     */
    public async cancel(executionId: string, requestingUserId?: string): Promise<{ success: boolean; message: string }> {
        const handle = this.activeHandles.get(executionId);
        if (!handle) {
            return {
                success: false,
                message: `No active execution found with ID '${executionId}'.`,
            };
        }

        // Ownership verification
        if (requestingUserId && handle.userId !== requestingUserId) {
            return {
                success: false,
                message: `Access denied. Execution '${executionId}' belongs to another user.`,
            };
        }

        handle.cancelled = true;

        // If backendPid is available and pool is connected, cancel query on PostgreSQL
        if (handle.backendPid && this.pool) {
            try {
                await this.pool.query("SELECT pg_cancel_backend($1);", [handle.backendPid]);
            } catch {
                // Ignore failure if query already completed
            }
        }

        return {
            success: true,
            message: `Execution '${executionId}' has been canceled.`,
        };
    }

    public isCancelled(executionId: string): boolean {
        return this.activeHandles.get(executionId)?.cancelled ?? false;
    }

    public getActiveCount(): number {
        return this.activeHandles.size;
    }

    public clear(): void {
        this.activeHandles.clear();
    }
}
