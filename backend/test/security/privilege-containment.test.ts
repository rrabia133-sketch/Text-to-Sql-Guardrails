import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Pool, DatabaseError } from "pg";

const ANALYTICS_DB_URL =
    process.env.ANALYTICS_DB_URL ||
    "postgresql://analytics_user:analytics_password@127.0.0.1:5434/analytics_db";

const APP_DB_URL =
    process.env.APP_DB_URL ||
    "postgresql://app_user:app_password@127.0.0.1:5434/app_db";

describe("Database Privilege Denial & Security Containment Tests", () => {
    let analyticsPool: Pool | null = null;
    let appPool: Pool | null = null;
    let dbAvailable = false;

    before(async () => {
        try {
            analyticsPool = new Pool({
                connectionString: ANALYTICS_DB_URL,
                connectionTimeoutMillis: 1500,
            });
            appPool = new Pool({
                connectionString: APP_DB_URL,
                connectionTimeoutMillis: 1500,
            });

            const client = await analyticsPool.connect();
            client.release();
            dbAvailable = true;
        } catch {
            dbAvailable = false;
        }
    });

    after(async () => {
        if (analyticsPool) {
            await analyticsPool.end().catch(() => {});
        }
        if (appPool) {
            await appPool.end().catch(() => {});
        }
    });

    describe("1. analytics_user Security Boundaries (analytics_db)", () => {
        it("allows SELECT queries on analytical tables", async (t) => {
            if (!dbAvailable || !analyticsPool) {
                t.skip("PostgreSQL (analytics_db) is not running on port 5434");
                return;
            }
            const res = await analyticsPool.query("SELECT COUNT(*) AS total FROM customers");
            assert.ok(Number.parseInt(res.rows[0].total, 10) >= 0);
        });

        it("denies INSERT operations with SQLSTATE 25006 (read-only transaction)", async (t) => {
            if (!dbAvailable || !analyticsPool) {
                t.skip("PostgreSQL (analytics_db) is not running on port 5434");
                return;
            }
            await assert.rejects(
                async () => {
                    await analyticsPool!.query(
                        "INSERT INTO customers (name, region) VALUES ('Evil', 'North')"
                    );
                },
                (err: unknown) => {
                    assert.ok(err instanceof DatabaseError);
                    assert.ok(err.code === "25006" || err.code === "42501");
                    return true;
                }
            );
        });

        it("denies UPDATE operations with SQLSTATE 25006", async (t) => {
            if (!dbAvailable || !analyticsPool) {
                t.skip("PostgreSQL (analytics_db) is not running on port 5434");
                return;
            }
            await assert.rejects(
                async () => {
                    await analyticsPool!.query("UPDATE customers SET name = 'Hacked'");
                },
                (err: unknown) => {
                    assert.ok(err instanceof DatabaseError);
                    assert.ok(err.code === "25006" || err.code === "42501");
                    return true;
                }
            );
        });

        it("denies DELETE operations with SQLSTATE 25006", async (t) => {
            if (!dbAvailable || !analyticsPool) {
                t.skip("PostgreSQL (analytics_db) is not running on port 5434");
                return;
            }
            await assert.rejects(
                async () => {
                    await analyticsPool!.query("DELETE FROM customers");
                },
                (err: unknown) => {
                    assert.ok(err instanceof DatabaseError);
                    assert.ok(err.code === "25006" || err.code === "42501");
                    return true;
                }
            );
        });

        it("denies DDL CREATE TABLE attempts with SQLSTATE 25006 or 42501", async (t) => {
            if (!dbAvailable || !analyticsPool) {
                t.skip("PostgreSQL (analytics_db) is not running on port 5434");
                return;
            }
            await assert.rejects(
                async () => {
                    await analyticsPool!.query("CREATE TABLE hacked_table (id INT)");
                },
                (err: unknown) => {
                    assert.ok(err instanceof DatabaseError);
                    assert.ok(err.code === "25006" || err.code === "42501");
                    return true;
                }
            );
        });

        it("terminates long-running DoS queries via statement_timeout (SQLSTATE 57014)", async (t) => {
            if (!dbAvailable || !analyticsPool) {
                t.skip("PostgreSQL (analytics_db) is not running on port 5434");
                return;
            }
            const startTime = Date.now();
            await assert.rejects(
                async () => {
                    await analyticsPool!.query("SELECT pg_sleep(10)");
                },
                (err: unknown) => {
                    assert.ok(err instanceof DatabaseError);
                    assert.equal(err.code, "57014");
                    return true;
                }
            );
            const durationMs = Date.now() - startTime;
            assert.ok(durationMs < 9500, `Query was not killed in time, took ${durationMs}ms`);
        });

        it("strictly denies connection to app_db", async (t) => {
            if (!dbAvailable) {
                t.skip("PostgreSQL is not running on port 5434");
                return;
            }
            const illegalPool = new Pool({
                connectionString: "postgresql://analytics_user:analytics_password@127.0.0.1:5434/app_db",
                connectionTimeoutMillis: 1500,
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

            await illegalPool.end().catch(() => {});
        });
    });

    describe("2. app_user Security Boundaries (app_db)", () => {
        it("allows SELECT queries on application tables", async (t) => {
            if (!dbAvailable || !appPool) {
                t.skip("PostgreSQL (app_db) is not running on port 5434");
                return;
            }
            const res = await appPool.query("SELECT COUNT(*) AS total FROM users");
            assert.ok(Number.parseInt(res.rows[0].total, 10) >= 0);
        });

        it("denies DDL CREATE TABLE modifications with SQLSTATE 42501", async (t) => {
            if (!dbAvailable || !appPool) {
                t.skip("PostgreSQL (app_db) is not running on port 5434");
                return;
            }
            await assert.rejects(
                async () => {
                    await appPool!.query("CREATE TABLE unauthorized_app_table (id INT)");
                },
                (err: unknown) => {
                    assert.ok(err instanceof DatabaseError);
                    assert.equal(err.code, "42501");
                    return true;
                }
            );
        });

        it("strictly denies connection to analytics_db", async (t) => {
            if (!dbAvailable) {
                t.skip("PostgreSQL is not running on port 5434");
                return;
            }
            const illegalPool = new Pool({
                connectionString: "postgresql://app_user:app_password@127.0.0.1:5434/analytics_db",
                connectionTimeoutMillis: 1500,
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

            await illegalPool.end().catch(() => {});
        });
    });
});
