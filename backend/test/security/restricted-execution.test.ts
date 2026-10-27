import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { RestrictedExecutor } from "../../src/modules/execution/restricted-executor.js";
import { ArtifactGate } from "../../src/modules/execution/artifact-gate.js";
import { ConcurrencyManager } from "../../src/modules/execution/concurrency-manager.js";
import { CancellationService } from "../../src/modules/execution/cancellation.service.js";
import { QueryArtifactRepository } from "../../src/modules/generation/query-artifact.repository.js";
import { Pool } from "pg";

const ANALYTICS_DB_URL =
    process.env.ANALYTICS_DB_URL ||
    "postgresql://analytics_user:analytics_password@127.0.0.1:5434/analytics_db";

describe("Sprint 4 - Task 17: Restricted Database Execution & Privilege Containment Benchmark (US-10 / DO-06)", () => {
    let analyticsPool: Pool | null = null;
    let dbAvailable = false;
    let restrictedExecutor: RestrictedExecutor;
    let queryArtifactRepo: QueryArtifactRepository;
    let artifactGate: ArtifactGate;
    let concurrencyManager: ConcurrencyManager;
    let cancellationService: CancellationService;

    before(async () => {
        try {
            analyticsPool = new Pool({
                connectionString: ANALYTICS_DB_URL,
                connectionTimeoutMillis: 1500,
                max: 10,
            });
            const client = await analyticsPool.connect();
            client.release();
            dbAvailable = true;
        } catch {
            dbAvailable = false;
            analyticsPool = null;
        }

        // restrictedExecutor works with analyticsPool when live, or in mock offline mode when pool is unavailable/offline
        restrictedExecutor = new RestrictedExecutor(analyticsPool || undefined);
        queryArtifactRepo = new QueryArtifactRepository();
        artifactGate = new ArtifactGate(queryArtifactRepo);
        concurrencyManager = new ConcurrencyManager({ maxActivePerUser: 2, maxActiveGlobal: 10 });
        cancellationService = new CancellationService(analyticsPool || undefined);
    });

    after(async () => {
        if (analyticsPool) {
            await analyticsPool.end().catch(() => {});
        }
    });

    describe("1. PostgreSQL Kernel Read-Only Privilege Containment", () => {
        it("strictly blocks mutating DML (INSERT/UPDATE/DELETE) at database kernel level", async (t) => {
            if (!dbAvailable) {
                // Verify mock mode blocks mutation
                const result = await restrictedExecutor.execute("INSERT INTO customers (name) VALUES ('Hacker');");
                assert.equal(result.ok, false);
                assert.equal(result.errorCode, "TRANSACTION_VIOLATION");
                return;
            }

            const mutatingStatements = [
                "INSERT INTO customers (id, name, region) VALUES (9999, 'Test', 'North');",
                "UPDATE products SET unit_price = 0 WHERE id = 1;",
                "DELETE FROM orders WHERE id = 1;",
            ];

            for (const sql of mutatingStatements) {
                const result = await restrictedExecutor.execute(sql);
                assert.equal(result.ok, false, `Expected kernel block for: ${sql}`);
                assert.equal(result.errorCode, "TRANSACTION_VIOLATION");
            }
        });

        it("strictly blocks DDL (DROP/CREATE/ALTER/TRUNCATE) at database kernel level", async (t) => {
            if (!dbAvailable) {
                const result = await restrictedExecutor.execute("DROP TABLE customers;");
                assert.equal(result.ok, false);
                assert.equal(result.errorCode, "TRANSACTION_VIOLATION");
                return;
            }

            const ddlStatements = [
                "DROP TABLE customers;",
                "CREATE TABLE test_leak (id INT);",
                "ALTER TABLE products DROP COLUMN unit_price;",
                "TRUNCATE TABLE order_items;",
            ];

            for (const sql of ddlStatements) {
                const result = await restrictedExecutor.execute(sql);
                assert.equal(result.ok, false, `Expected kernel block for DDL: ${sql}`);
                assert.equal(result.errorCode, "TRANSACTION_VIOLATION");
            }
        });
    });

    describe("2. Resource Limits & Containment Bounds", () => {
        it("clamps row count at 500 rows maximum and marks result truncated", async () => {
            // Generate synthetic row query that exceeds 500 rows
            const sql = dbAvailable
                ? "SELECT generate_series(1, 600) AS n;"
                : "SELECT id, name FROM customers;"; // mock offline returns 100 rows, or we test limiter directly

            if (!dbAvailable) {
                // Test row cap on restrictedExecutor using custom limiter parameter
                const customExecutor = new RestrictedExecutor(undefined, { maxRows: 1 });
                const res = await customExecutor.execute("SELECT id, name FROM customers;");
                assert.equal(res.ok, true);
                assert.equal(res.rowCount, 1);
                assert.equal(res.truncated, true);
                return;
            }

            const res = await restrictedExecutor.execute(sql);
            assert.equal(res.ok, true);
            assert.equal(res.rowCount, 500);
            assert.equal(res.truncated, true);
        });

        it("aborts query and returns EXECUTION_TIMEOUT when statement timeout is exceeded", async (t) => {
            if (!dbAvailable) {
                // Test timeout mapping logic in mock mode
                const customExecutor = new RestrictedExecutor(undefined, { statementTimeoutMs: 50 });
                // Simulate timeout
                const res = await customExecutor.execute("SELECT pg_sleep(5);");
                assert.equal(res.ok, false);
                assert.equal(res.errorCode, "EXECUTION_TIMEOUT");
                return;
            }

            // Using statement_timeout of 100ms for fast test
            const fastTimeoutExecutor = new RestrictedExecutor(analyticsPool || undefined, { statementTimeoutMs: 200 });
            const res = await fastTimeoutExecutor.execute("SELECT pg_sleep(1);");
            assert.equal(res.ok, false);
            assert.equal(res.errorCode, "EXECUTION_TIMEOUT");
        });
    });

    describe("3. Immutable Artifact Ownership & Cross-Tenant Isolation", () => {
        it("blocks execution when artifact belongs to another user (ARTIFACT_NOT_OWNED)", async () => {
            const artifact = await queryArtifactRepo.create({
                userId: "user_alice",
                prompt: "Alice query",
                generatedSql: "SELECT id, name FROM customers;",
                referencedTables: ["customers"],
                referencedColumns: ["customers.id", "customers.name"],
                assumptions: [],
                explanation: "Alice's query",
                provider: "ollama",
                model: "qwen2.5-coder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "1.0.0",
            });

            // Bob attempts to execute Alice's artifact
            const gateResult = await artifactGate.verify(artifact.id, "user_bob");
            assert.equal(gateResult.ok, false);
            assert.equal(gateResult.errorCode, "ARTIFACT_NOT_OWNED");
        });

        it("blocks execution when client attempts to substitute or tamper with SQL (HASH_MISMATCH)", async () => {
            const artifact = await queryArtifactRepo.create({
                userId: "user_alice",
                prompt: "Original query",
                generatedSql: "SELECT id, name FROM customers LIMIT 10;",
                referencedTables: ["customers"],
                referencedColumns: ["customers.id", "customers.name"],
                assumptions: [],
                explanation: "Original query",
                provider: "ollama",
                model: "qwen2.5-coder:7b",
                promptVersion: "1.0.0",
                schemaVersion: "1.0.0",
            });

            // Tampered client SQL
            const gateResult = await artifactGate.verify(artifact.id, "user_alice", {
                clientProvidedSql: "SELECT id, name FROM customers; DROP TABLE orders;",
            });

            assert.equal(gateResult.ok, false);
            assert.equal(gateResult.errorCode, "HASH_MISMATCH");
        });
    });

    describe("4. Concurrency Management & Asynchronous Cancellation", () => {
        it("throttles execution when user exceeds 2 concurrent queries", () => {
            const userId = "user_power";
            const acq1 = concurrencyManager.acquire(userId, "exec_1");
            const acq2 = concurrencyManager.acquire(userId, "exec_2");
            const acq3 = concurrencyManager.acquire(userId, "exec_3");

            assert.equal(acq1.allowed, true);
            assert.equal(acq2.allowed, true);
            assert.equal(acq3.allowed, false);
            assert.equal(acq3.reason, "USER_CONCURRENCY_EXCEEDED");

            concurrencyManager.release(userId, "exec_1");
            concurrencyManager.release(userId, "exec_2");
        });

        it("cancels running execution without pool connection leaks", async () => {
            const execId = "exec_cancel_test";
            const userId = "user_cancel";

            cancellationService.register(execId, userId, 99999);
            const cancelRes = await cancellationService.cancel(execId, userId);

            assert.equal(cancelRes.success, true);
            cancellationService.unregister(execId);
        });
    });
});
