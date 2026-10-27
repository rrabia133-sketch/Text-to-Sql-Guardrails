import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    RestrictedExecutor,
    mapPgOidToType,
} from "../../src/modules/execution/restricted-executor.js";

describe("Sprint 4 - Task 13: Restricted Database Executor & Read-Only Containment (US-10 / DO-06)", () => {
    describe("PostgreSQL OID to JavaScript Type Mapping", () => {
        it("maps numeric types correctly", () => {
            assert.deepEqual(mapPgOidToType(23), { pgType: "integer", jsType: "number" });
            assert.deepEqual(mapPgOidToType(20), { pgType: "bigint", jsType: "number" });
            assert.deepEqual(mapPgOidToType(21), { pgType: "smallint", jsType: "number" });
            assert.deepEqual(mapPgOidToType(700), { pgType: "real", jsType: "number" });
            assert.deepEqual(mapPgOidToType(701), { pgType: "double precision", jsType: "number" });
            assert.deepEqual(mapPgOidToType(1700), { pgType: "numeric", jsType: "number" });
        });

        it("maps string, date, boolean, and json types correctly", () => {
            assert.deepEqual(mapPgOidToType(16), { pgType: "boolean", jsType: "boolean" });
            assert.deepEqual(mapPgOidToType(25), { pgType: "text", jsType: "string" });
            assert.deepEqual(mapPgOidToType(1043), { pgType: "text", jsType: "string" });
            assert.deepEqual(mapPgOidToType(2950), { pgType: "text", jsType: "string" });
            assert.deepEqual(mapPgOidToType(1082), { pgType: "date", jsType: "date" });
            assert.deepEqual(mapPgOidToType(1184), { pgType: "timestamptz", jsType: "date" });
            assert.deepEqual(mapPgOidToType(3802), { pgType: "jsonb", jsType: "object" });
            assert.deepEqual(mapPgOidToType(99999), { pgType: "unknown", jsType: "string" });
        });
    });

    describe("Read-Only Transaction Encapsulation & Containment", () => {
        it("executes analytical query inside strict BEGIN READ ONLY transaction and commits", async () => {
            const executedQueries: string[] = [];
            let released = false;

            const mockClient = {
                query: async (queryText: string) => {
                    executedQueries.push(queryText);
                    if (queryText.includes("SELECT")) {
                        return {
                            fields: [
                                { name: "id", dataTypeID: 23 },
                                { name: "name", dataTypeID: 1043 },
                                { name: "created_at", dataTypeID: 1184 },
                            ],
                            rows: [
                                { id: 1, name: "Alice", created_at: "2026-01-01T00:00:00Z" },
                                { id: 2, name: "Bob", created_at: "2026-01-02T00:00:00Z" },
                            ],
                        };
                    }
                    return {};
                },
                release: () => {
                    released = true;
                },
            };

            const mockPool: any = {
                connect: async () => mockClient,
            };

            const executor = new RestrictedExecutor(mockPool);
            const sql = "SELECT id, name, created_at FROM customers LIMIT 2;";
            const result = await executor.execute(sql);

            assert.equal(result.ok, true);
            if (result.ok) {
                assert.equal(result.rowCount, 2);
                assert.equal(result.truncated, false);
                assert.equal(result.columns.length, 3);
                assert.equal(result.columns[0].name, "id");
                assert.equal(result.columns[0].jsType, "number");
                assert.equal(result.columns[1].name, "name");
                assert.equal(result.columns[1].jsType, "string");
                assert.equal(result.columns[2].name, "created_at");
                assert.equal(result.columns[2].jsType, "date");
            }

            // Verify transaction encapsulation
            assert.equal(executedQueries[0], "BEGIN TRANSACTION READ ONLY;");
            assert.equal(executedQueries[1], "SET LOCAL statement_timeout = '5000ms';");
            assert.equal(executedQueries[2], "SET LOCAL lock_timeout = '1000ms';");
            assert.equal(executedQueries[3], sql);
            assert.equal(executedQueries[4], "COMMIT;");
            assert.equal(released, true);
        });

        it("traps kernel error 25006 (read_only_sql_transaction) and rolls back", async () => {
            const executedQueries: string[] = [];
            let released = false;

            const mockClient = {
                query: async (queryText: string) => {
                    executedQueries.push(queryText);
                    if (queryText.includes("DELETE")) {
                        const err: any = new Error("cannot execute DELETE in a read-only transaction");
                        err.code = "25006";
                        throw err;
                    }
                    return {};
                },
                release: () => {
                    released = true;
                },
            };

            const mockPool: any = {
                connect: async () => mockClient,
            };

            const executor = new RestrictedExecutor(mockPool);
            const result = await executor.execute("DELETE FROM customers WHERE id = 1;");

            assert.equal(result.ok, false);
            if (!result.ok) {
                assert.equal(result.errorCode, "TRANSACTION_VIOLATION");
                assert.match(result.errorMessage, /read-only transaction containment/i);
            }

            assert.ok(executedQueries.includes("ROLLBACK;"));
            assert.equal(released, true);
        });

        it("traps kernel error 57014 (query_canceled / statement_timeout) and rolls back", async () => {
            const executedQueries: string[] = [];
            let released = false;

            const mockClient = {
                query: async (queryText: string) => {
                    executedQueries.push(queryText);
                    if (queryText.includes("SELECT")) {
                        const err: any = new Error("canceling statement due to statement timeout");
                        err.code = "57014";
                        throw err;
                    }
                    return {};
                },
                release: () => {
                    released = true;
                },
            };

            const mockPool: any = {
                connect: async () => mockClient,
            };

            const executor = new RestrictedExecutor(mockPool);
            const result = await executor.execute("SELECT pg_sleep(10);", { statementTimeoutMs: 3000 });

            assert.equal(result.ok, false);
            if (!result.ok) {
                assert.equal(result.errorCode, "EXECUTION_TIMEOUT");
                assert.match(result.errorMessage, /statement timeout limit/i);
            }

            assert.ok(executedQueries.includes("ROLLBACK;"));
            assert.equal(released, true);
        });

        it("traps kernel error 55P03 (lock_not_available) and rolls back", async () => {
            const mockClient = {
                query: async (queryText: string) => {
                    if (queryText.includes("SELECT")) {
                        const err: any = new Error("canceling statement due to lock timeout");
                        err.code = "55P03";
                        throw err;
                    }
                    return {};
                },
                release: () => {},
            };

            const mockPool: any = {
                connect: async () => mockClient,
            };

            const executor = new RestrictedExecutor(mockPool);
            const result = await executor.execute("SELECT * FROM orders;");

            assert.equal(result.ok, false);
            if (!result.ok) {
                assert.equal(result.errorCode, "EXECUTION_TIMEOUT");
                assert.match(result.errorMessage, /lock timeout limit/i);
            }
        });
    });

    describe("Resource Limiting (Row-Cap & Byte-Cap Enforcement)", () => {
        it("truncates rows when row count exceeds maxRows limit", async () => {
            const hundredRows = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `User_${i}` }));

            const mockClient = {
                query: async (queryText: string) => {
                    if (queryText.includes("SELECT")) {
                        return {
                            fields: [
                                { name: "id", dataTypeID: 23 },
                                { name: "name", dataTypeID: 1043 },
                            ],
                            rows: hundredRows,
                        };
                    }
                    return {};
                },
                release: () => {},
            };

            const mockPool: any = {
                connect: async () => mockClient,
            };

            const executor = new RestrictedExecutor(mockPool);
            // Cap at 25 rows
            const result = await executor.execute("SELECT * FROM customers;", { maxRows: 25 });

            assert.equal(result.ok, true);
            if (result.ok) {
                assert.equal(result.rowCount, 25);
                assert.equal(result.rows.length, 25);
                assert.equal(result.truncated, true);
            }
        });

        it("truncates rows when payload byte size exceeds maxBytes limit", async () => {
            const largeRows = Array.from({ length: 50 }, (_, i) => ({
                id: i,
                bio: "X".repeat(500),
            }));

            const mockClient = {
                query: async (queryText: string) => {
                    if (queryText.includes("SELECT")) {
                        return {
                            fields: [
                                { name: "id", dataTypeID: 23 },
                                { name: "bio", dataTypeID: 25 },
                            ],
                            rows: largeRows,
                        };
                    }
                    return {};
                },
                release: () => {},
            };

            const mockPool: any = {
                connect: async () => mockClient,
            };

            const executor = new RestrictedExecutor(mockPool);
            // Cap at 2048 bytes
            const result = await executor.execute("SELECT * FROM customers;", { maxBytes: 2048 });

            assert.equal(result.ok, true);
            if (result.ok) {
                assert.ok(result.byteSize <= 2048);
                assert.ok(result.rowCount < 50);
                assert.equal(result.truncated, true);
            }
        });
    });

    describe("Mock Offline Execution Mode", () => {
        it("returns mock analytical results when pool is offline", async () => {
            const executor = new RestrictedExecutor(null);
            const result = await executor.execute("SELECT id, name, region FROM customers;");

            assert.equal(result.ok, true);
            if (result.ok) {
                assert.equal(result.rowCount, 2);
                assert.equal(result.columns.length, 3);
            }
        });

        it("rejects simulated mutating statements in mock mode", async () => {
            const executor = new RestrictedExecutor(null);
            const result = await executor.execute("DROP TABLE customers;");

            assert.equal(result.ok, false);
            if (!result.ok) {
                assert.equal(result.errorCode, "TRANSACTION_VIOLATION");
            }
        });
    });
});
