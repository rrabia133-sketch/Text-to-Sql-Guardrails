import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ConcurrencyManager } from "../../src/modules/execution/concurrency-manager.js";
import { CancellationService } from "../../src/modules/execution/cancellation.service.js";

describe("Sprint 4 - Task 15: Concurrency Throttle & Asynchronous Cancellation (US-10 / DO-06)", () => {
    describe("ConcurrencyManager", () => {
        let manager: ConcurrencyManager;

        beforeEach(() => {
            manager = new ConcurrencyManager({ maxPerUser: 2, maxGlobal: 5 });
            manager.clear();
        });

        it("allows query slots up to the per-user limit", () => {
            const q1 = manager.acquire("user_1", "exec_1");
            assert.equal(q1.allowed, true);
            assert.equal(q1.activeUserCount, 1);
            assert.equal(q1.activeGlobalCount, 1);

            const q2 = manager.acquire("user_1", "exec_2");
            assert.equal(q2.allowed, true);
            assert.equal(q2.activeUserCount, 2);
            assert.equal(q2.activeGlobalCount, 2);
        });

        it("rejects queries exceeding per-user limit with USER_CONCURRENCY_EXCEEDED", () => {
            manager.acquire("user_1", "exec_1");
            manager.acquire("user_1", "exec_2");

            // 3rd query from user_1 should be rejected
            const q3 = manager.acquire("user_1", "exec_3");
            assert.equal(q3.allowed, false);
            assert.equal(q3.reason, "USER_CONCURRENCY_EXCEEDED");
            assert.equal(q3.activeUserCount, 2);
        });

        it("allows other users to acquire slots independently of user_1", () => {
            manager.acquire("user_1", "exec_1");
            manager.acquire("user_1", "exec_2");

            // user_2 can acquire their own slots
            const u2_q1 = manager.acquire("user_2", "exec_4");
            assert.equal(u2_q1.allowed, true);
            assert.equal(u2_q1.activeUserCount, 1);
            assert.equal(u2_q1.activeGlobalCount, 3);
        });

        it("frees slot on release and allows subsequent queries", () => {
            manager.acquire("user_1", "exec_1");
            manager.acquire("user_1", "exec_2");

            manager.release("user_1", "exec_1");
            assert.equal(manager.getActiveUserCount("user_1"), 1);

            // Now 3rd query can succeed
            const q3 = manager.acquire("user_1", "exec_3");
            assert.equal(q3.allowed, true);
            assert.equal(manager.getActiveUserCount("user_1"), 2);
        });

        it("rejects queries exceeding global concurrency bound with GLOBAL_CONCURRENCY_EXCEEDED", () => {
            // maxGlobal is 5
            manager.acquire("user_1", "exec_1");
            manager.acquire("user_1", "exec_2");
            manager.acquire("user_2", "exec_3");
            manager.acquire("user_2", "exec_4");
            manager.acquire("user_3", "exec_5");

            assert.equal(manager.getActiveGlobalCount(), 5);

            // 6th global query across instance must be blocked
            const q6 = manager.acquire("user_4", "exec_6");
            assert.equal(q6.allowed, false);
            assert.equal(q6.reason, "GLOBAL_CONCURRENCY_EXCEEDED");
        });
    });

    describe("CancellationService", () => {
        let cancelService: CancellationService;
        let mockPoolQueries: { sql: string; params: any[] }[];

        beforeEach(() => {
            mockPoolQueries = [];
            const mockPool: any = {
                query: async (sql: string, params: any[]) => {
                    mockPoolQueries.push({ sql, params });
                    return { rows: [] };
                },
            };
            cancelService = new CancellationService(mockPool);
            cancelService.clear();
        });

        it("registers and tracks active executions", () => {
            cancelService.register("exec_100", "user_a", undefined, 12345);
            assert.equal(cancelService.getActiveCount(), 1);
            assert.equal(cancelService.isCancelled("exec_100"), false);

            cancelService.unregister("exec_100");
            assert.equal(cancelService.getActiveCount(), 0);
        });

        it("cancels active execution and invokes pg_cancel_backend with PID", async () => {
            cancelService.register("exec_200", "user_a", undefined, 54321);

            const result = await cancelService.cancel("exec_200", "user_a");
            assert.equal(result.success, true);
            assert.equal(cancelService.isCancelled("exec_200"), true);

            // Verify pg_cancel_backend was executed
            assert.equal(mockPoolQueries.length, 1);
            assert.equal(mockPoolQueries[0].sql, "SELECT pg_cancel_backend($1);");
            assert.deepEqual(mockPoolQueries[0].params, [54321]);
        });

        it("prevents cross-tenant cancellation requests", async () => {
            cancelService.register("exec_300", "user_a", undefined, 9999);

            // user_b attempts to cancel user_a's query
            const result = await cancelService.cancel("exec_300", "user_b");
            assert.equal(result.success, false);
            assert.match(result.message, /access denied/i);
            assert.equal(cancelService.isCancelled("exec_300"), false);
            assert.equal(mockPoolQueries.length, 0); // No SQL executed
        });

        it("returns failure when cancelling non-existent execution", async () => {
            const result = await cancelService.cancel("exec_unknown", "user_a");
            assert.equal(result.success, false);
            assert.match(result.message, /no active execution found/i);
        });
    });
});
