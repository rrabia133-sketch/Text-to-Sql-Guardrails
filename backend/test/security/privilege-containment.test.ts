import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { Pool, DatabaseError } from "pg";

const ANALYTICS_DB_URL =
    process.env.ANALYTICS_DB_URL ||
    "postgresql://analytics_user:analytics_password@127.0.0.1:5434/analytics_db";

const APP_DB_URL =
    process.env.APP_DB_URL ||
    "postgresql://app_user:app_password@127.0.0.1:5434/app_db";

describe("Database Privilege Denial & Security Containment Tests", () => {
    const analyticsPool = new Pool({ connectionString: ANALYTICS_DB_URL });
    const appPool = new Pool({ connectionString: APP_DB_URL });

    after(async () => {
        await analyticsPool.end();
        await appPool.end();
    });

    describe("1. analytics_user Security Boundaries (analytics_db)", () => {
        it("allows SELECT queries on analytical tables", async () => {
            const res = await analyticsPool.query("SELECT COUNT(*) AS total FROM customers");
            assert.ok(Number.parseInt(res.rows[0].total, 10) >= 0);
        });

        it("denies INSERT operations with SQLSTATE 25006 (read-only transaction)", async () => {
            await assert.rejects(
                async () => {
                    await analyticsPool.query(
                        "INSERT INTO customers (name, region) VALUES ('Evil', 'North')"
                    );
                },
                (err: unknown) => {
                    assert.ok(err instanceof DatabaseError);
                    // 25006: read_only_sql_transaction or 42501: insufficient_privilege
                    assert.ok(err.code === "25006" || err.code === "42501");
                    return true;
                }
            );
        });

        it("denies UPDATE operations with SQLSTATE 25006", async () => {
            await assert.rejects(
                async () => {
                    await analyticsPool.query("UPDATE customers SET name = 'Hacked'");
                },
                (err: unknown) => {
                    assert.ok(err instanceof DatabaseError);
                    assert.ok(err.code === "25006" || err.code === "42501");
                    return true;
                }
            );
        });

        it("denies DELETE operations with SQLSTATE 25006", async () => {
            await assert.rejects(
                async () => {
                    await analyticsPool.query("DELETE FROM customers");
                },
                (err: unknown) => {
                    assert.ok(err instanceof DatabaseError);
                    assert.ok(err.code === "25006" || err.code === "42501");
                    return true;
                }
            );
        });

        it("denies DDL CREATE TABLE attempts with SQLSTATE 25006 or 42501", async () => {
            await assert.rejects(
                async () => {
                    await analyticsPool.query("CREATE TABLE hacked_table (id INT)");
                },
                (err: unknown) => {
                    assert.ok(err instanceof DatabaseError);
                    assert.ok(err.code === "25006" || err.code === "42501");
                    return true;
                }
            );
        });

        it("terminates long-running DoS queries via statement_timeout (SQLSTATE 57014)", async () => {
            const startTime = Date.now();
            await assert.rejects(
                async () => {
                    // Try sleeping 10 seconds; kernel statement_timeout is 5 seconds
                    await analyticsPool.query("SELECT pg_sleep(10)");
                },
                (err: unknown) => {
                    assert.ok(err instanceof DatabaseError);
                    assert.equal(err.code, "57014"); // query_canceled due to statement_timeout
                    return true;
                }
            );
            const durationMs = Date.now() - startTime;
            // Should be canceled around 5000ms (+ overhead), definitely before 9500ms
            assert.ok(durationMs < 9500, `Query was not killed in time, took ${durationMs}ms`);
        });

        it("strictly denies connection to app_db", async () => {
            const illegalPool = new Pool({
                connectionString: "postgresql://analytics_user:analytics_password@127.0.0.1:5434/app_db",
            });

            await assert.rejects(
                async () => {
                    await illegalPool.connect();
                },
                (err: unknown) => {
                    assert.ok(err instanceof DatabaseError);
                    assert.equal(err.code, "42501"); // insufficient privilege / connection denied
                    return true;
                }
            );

            await illegalPool.end().catch(() => { });
        });
    });

    describe("2. app_user Security Boundaries (app_db)", () => {
        it("allows SELECT queries on application tables", async () => {
            const res = await appPool.query("SELECT COUNT(*) AS total FROM users");
            assert.ok(Number.parseInt(res.rows[0].total, 10) >= 0);
        });

        it("denies DDL CREATE TABLE modifications with SQLSTATE 42501", async () => {
            await assert.rejects(
                async () => {
                    await appPool.query("CREATE TABLE unauthorized_app_table (id INT)");
                },
                (err: unknown) => {
                    assert.ok(err instanceof DatabaseError);
                    assert.equal(err.code, "42501"); // insufficient privilege
                    return true;
                }
            );
        });

        it("strictly denies connection to analytics_db", async () => {
            const illegalPool = new Pool({
                connectionString: "postgresql://app_user:app_password@127.0.0.1:5434/analytics_db",
            });

            await assert.rejects(
                async () => {
                    await illegalPool.connect();
                },
                (err: unknown) => {
                    assert.ok(err instanceof DatabaseError);
                    assert.equal(err.code, "42501");
                    return true;
                }
            );

            await illegalPool.end().catch(() => { });
        });
    });
});
