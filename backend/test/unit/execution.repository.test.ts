import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ExecutionRepository } from "../../src/modules/execution/execution.repository.js";

describe("Sprint 4 - Task 11: Execution Repository & Concurrency Tracking (US-10 / DO-06)", () => {
    let repo: ExecutionRepository;

    beforeEach(() => {
        repo = new ExecutionRepository();
        repo.clear();
    });

    describe("Execution Session Creation & Retrieval", () => {
        it("creates an execution record with default running state", async () => {
            const record = await repo.create({
                artifactId: "art_123",
                userId: "user_456",
                sqlExecuted: "SELECT id, name FROM customers LIMIT 50;",
            });

            assert.ok(record.id.startsWith("exec_"));
            assert.equal(record.artifactId, "art_123");
            assert.equal(record.userId, "user_456");
            assert.equal(record.status, "running");
            assert.equal(record.sqlExecuted, "SELECT id, name FROM customers LIMIT 50;");
            assert.equal(record.rowCount, 0);
            assert.equal(record.byteSize, 0);
            assert.equal(record.truncated, false);
            assert.ok(record.createdAt);
            assert.ok(record.updatedAt);
        });

        it("retrieves an existing execution by id and returns null for unknown id", async () => {
            const created = await repo.create({
                id: "exec_custom_001",
                artifactId: "art_123",
                userId: "user_456",
                sqlExecuted: "SELECT id FROM orders LIMIT 10;",
            });

            const fetched = await repo.findById("exec_custom_001");
            assert.ok(fetched);
            assert.equal(fetched.id, created.id);
            assert.equal(fetched.artifactId, "art_123");

            const missing = await repo.findById("exec_non_existent");
            assert.equal(missing, null);
        });
    });

    describe("Execution Lifecycle State Transitions", () => {
        it("transitions from running to completed with execution metrics", async () => {
            const created = await repo.create({
                artifactId: "art_123",
                userId: "user_456",
                sqlExecuted: "SELECT * FROM products LIMIT 50;",
            });

            const updated = await repo.update(created.id, {
                status: "completed",
                executionTimeMs: 142,
                rowCount: 50,
                byteSize: 4096,
                truncated: false,
            });

            assert.ok(updated);
            assert.equal(updated.status, "completed");
            assert.equal(updated.executionTimeMs, 142);
            assert.equal(updated.rowCount, 50);
            assert.equal(updated.byteSize, 4096);
            assert.equal(updated.truncated, false);
        });

        it("transitions from running to failed with error code and message", async () => {
            const created = await repo.create({
                artifactId: "art_123",
                userId: "user_456",
                sqlExecuted: "SELECT id FROM customers;",
            });

            const updated = await repo.update(created.id, {
                status: "failed",
                executionTimeMs: 5002,
                errorCode: "EXECUTION_TIMEOUT",
                errorMessage: "Query exceeded 5-second statement timeout.",
            });

            assert.ok(updated);
            assert.equal(updated.status, "failed");
            assert.equal(updated.errorCode, "EXECUTION_TIMEOUT");
            assert.equal(updated.errorMessage, "Query exceeded 5-second statement timeout.");
        });

        it("returns null when updating non-existent execution id", async () => {
            const result = await repo.update("exec_not_found", { status: "completed" });
            assert.equal(result, null);
        });
    });

    describe("Ownership & Artifact Filtering", () => {
        it("finds executions by artifactId ordered chronologically", async () => {
            await repo.create({
                artifactId: "art_1",
                userId: "user_a",
                sqlExecuted: "SELECT 1;",
            });
            await repo.create({
                artifactId: "art_1",
                userId: "user_a",
                sqlExecuted: "SELECT 2;",
            });
            await repo.create({
                artifactId: "art_2",
                userId: "user_b",
                sqlExecuted: "SELECT 3;",
            });

            const executions = await repo.findByArtifactId("art_1");
            assert.equal(executions.length, 2);
            assert.ok(executions.every(e => e.artifactId === "art_1"));
        });

        it("finds executions by userId with limit boundary", async () => {
            for (let i = 0; i < 5; i++) {
                await repo.create({
                    artifactId: `art_${i}`,
                    userId: "user_a",
                    sqlExecuted: `SELECT ${i};`,
                });
            }

            const list = await repo.findByUserId("user_a", 3);
            assert.equal(list.length, 3);
            assert.ok(list.every(e => e.userId === "user_a"));
        });
    });

    describe("Active Concurrency Tracking (Resource Containment)", () => {
        it("counts active queries for a specific user excluding completed or failed runs", async () => {
            // User A: 2 running, 1 completed
            const execA1 = await repo.create({ artifactId: "art_1", userId: "user_a", sqlExecuted: "Q1" });
            const execA2 = await repo.create({ artifactId: "art_2", userId: "user_a", sqlExecuted: "Q2" });
            const execA3 = await repo.create({ artifactId: "art_3", userId: "user_a", sqlExecuted: "Q3" });
            await repo.update(execA3.id, { status: "completed" });

            // User B: 1 running
            await repo.create({ artifactId: "art_4", userId: "user_b", sqlExecuted: "Q4" });

            const activeUserA = await repo.countActiveByUserId("user_a");
            const activeUserB = await repo.countActiveByUserId("user_b");

            assert.equal(activeUserA, 2);
            assert.equal(activeUserB, 1);
        });

        it("counts active queries globally across all users", async () => {
            await repo.create({ artifactId: "art_1", userId: "user_a", sqlExecuted: "Q1", status: "running" });
            await repo.create({ artifactId: "art_2", userId: "user_b", sqlExecuted: "Q2", status: "pending" });
            const completed = await repo.create({ artifactId: "art_3", userId: "user_c", sqlExecuted: "Q3", status: "running" });
            await repo.update(completed.id, { status: "completed" });

            const globalActive = await repo.countActiveGlobal();
            assert.equal(globalActive, 2);
        });
    });
});
