import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResourceLimiter } from "../../src/modules/execution/resource-limiter.js";

describe("Sprint 4 - Task 14: Resource Limiter (Row-Cap & Byte-Cap Enforcement) (US-10)", () => {
    const limiter = new ResourceLimiter();

    describe("Deterministic Cell Formatting", () => {
        it("formats Date instances into ISO 8601 strings", () => {
            const date = new Date("2026-05-15T12:00:00.000Z");
            const row = { id: 1, created_at: date };
            const formatted = limiter.formatRow(row);

            assert.equal(formatted.id, 1);
            assert.equal(formatted.created_at, "2026-05-15T12:00:00.000Z");
        });

        it("formats BigInt instances into numbers", () => {
            const row = { count: BigInt(42) };
            const formatted = limiter.formatRow(row);

            assert.equal(formatted.count, 42);
            assert.equal(typeof formatted.count, "number");
        });

        it("preserves primitives and nulls without distortion", () => {
            const row = {
                name: "Laptop",
                price: 999.99,
                inStock: true,
                description: null,
            };
            const formatted = limiter.formatRow(row);

            assert.deepEqual(formatted, row);
        });
    });

    describe("Row Cap Enforcement", () => {
        it("allows row sets within max rows without truncation", () => {
            const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `Item ${i}` }));
            const result = limiter.enforce(rows, { maxRows: 100 });

            assert.equal(result.rowCount, 50);
            assert.equal(result.rows.length, 50);
            assert.equal(result.truncated, false);
            assert.ok(result.byteSize > 0);
        });

        it("clamps row sets exceeding default max rows (500) and marks truncated", () => {
            const rows = Array.from({ length: 750 }, (_, i) => ({ id: i, name: `Customer ${i}` }));
            const result = limiter.enforce(rows); // uses default 500

            assert.equal(result.rowCount, 500);
            assert.equal(result.rows.length, 500);
            assert.equal(result.truncated, true);
        });

        it("clamps row sets according to custom maxRows parameter", () => {
            const rows = Array.from({ length: 25 }, (_, i) => ({ id: i }));
            const result = limiter.enforce(rows, { maxRows: 10 });

            assert.equal(result.rowCount, 10);
            assert.equal(result.rows.length, 10);
            assert.equal(result.truncated, true);
        });
    });

    describe("Byte Cap Enforcement", () => {
        it("allows payloads within max bytes without truncation", () => {
            const rows = [{ id: 1, name: "Short text" }];
            const result = limiter.enforce(rows, { maxBytes: 1024 });

            assert.equal(result.rowCount, 1);
            assert.equal(result.truncated, false);
            assert.ok(result.byteSize < 1024);
        });

        it("truncates rows when total JSON byte size exceeds maxBytes", () => {
            // 20 rows each having ~500 bytes payload
            const rows = Array.from({ length: 20 }, (_, i) => ({
                id: i,
                data: "A".repeat(500),
            }));

            // Set cap to 2048 bytes (can only hold ~3-4 rows)
            const result = limiter.enforce(rows, { maxBytes: 2048 });

            assert.equal(result.truncated, true);
            assert.ok(result.rowCount < 20);
            assert.ok(result.byteSize <= 2048);
        });
    });

    describe("Edge Cases", () => {
        it("handles empty row sets cleanly", () => {
            const result = limiter.enforce([]);

            assert.equal(result.rowCount, 0);
            assert.equal(result.rows.length, 0);
            assert.equal(result.byteSize, 2); // '[]' is 2 bytes
            assert.equal(result.truncated, false);
        });
    });
});
