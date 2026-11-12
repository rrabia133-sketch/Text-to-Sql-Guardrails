import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { QueryArtifactRepository } from "../../src/modules/generation/query-artifact.repository.js";
import { HistoryRepository } from "../../src/modules/history/history.repository.js";

describe("Sprint 7 - Task 6 / DO-12: Expand/Contract Migration Compatibility & Rollback Drill", () => {
    const migrationsDir = fs.existsSync(path.resolve(process.cwd(), "database/app/migrations"))
        ? path.resolve(process.cwd(), "database/app/migrations")
        : path.resolve(process.cwd(), "../database/app/migrations");

    it("verifies all database migration scripts adhere to non-destructive expand/contract patterns", () => {
        const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
        assert.ok(files.length >= 7, "Expected at least 7 migrations up to Sprint 6");

        for (const file of files) {
            const content = fs.readFileSync(path.join(migrationsDir, file), "utf8");

            // Expand/contract rule: never unconditionally DROP TABLE or DROP COLUMN in production migrations
            assert.doesNotMatch(
                content,
                /\bDROP\s+TABLE\s+(?!IF\s+EXISTS)/i,
                `Migration ${file} must not contain unconditional DROP TABLE`
            );
            assert.doesNotMatch(
                content,
                /\bDROP\s+COLUMN\b/i,
                `Migration ${file} must not contain destructive DROP COLUMN`
            );

            // Additive rule: If a migration creates a table, it must use CREATE TABLE IF NOT EXISTS
            if (/CREATE\s+TABLE/i.test(content)) {
                assert.match(
                    content,
                    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i,
                    `Migration ${file} should define tables idempotently using IF NOT EXISTS`
                );
            }
        }
    });

    it("demonstrates backward compatibility: legacy Sprint 4/5 queries succeed against latest migrated schema", async () => {
        const repo = new QueryArtifactRepository();

        // 1. Insert an artifact using the legacy Sprint 4 contract (without policyVersion or deletedAt)
        const legacyRecord = await repo.create({
            userId: "usr_legacy_analyst",
            prompt: "Total revenue last quarter",
            generatedSql: "SELECT SUM(amount) FROM orders WHERE status = 'completed';",
            assumptions: ["Status is completed"],
            referencedTables: ["orders"],
            referencedColumns: ["amount", "status"],
            explanation: "Aggregates revenue",
            provider: "ollama",
            model: "sqlcoder:7b",
            promptVersion: "1.0.0",
            schemaVersion: "1.0.0",
        });

        assert.ok(legacyRecord.id);
        assert.equal(legacyRecord.userId, "usr_legacy_analyst");
        // Defaults ensure new fields do not break older code:
        assert.equal(legacyRecord.policyVersion, "1.0.0");
        assert.equal(legacyRecord.deletedAt, null);

        // 2. Querying legacy artifact works identically
        const retrieved = await repo.findById(legacyRecord.id);
        assert.ok(retrieved);
        assert.equal(retrieved.id, legacyRecord.id);
        assert.equal(retrieved.prompt, "Total revenue last quarter");
    });

    it("simulates deployment rollback: service remains fully operational if advanced Sprint 6 features are bypassed", async () => {
        const historyRepo = new HistoryRepository();
        const artifactRepo = new QueryArtifactRepository();

        // Simulate Sprint 6 artifact creation
        const artifact = await artifactRepo.create({
            userId: "usr_alice",
            prompt: "Active customer counts",
            generatedSql: "SELECT COUNT(*) FROM customers;",
            assumptions: [],
            referencedTables: ["customers"],
            referencedColumns: ["id"],
            explanation: "Counts customers",
            provider: "ollama",
            model: "sqlcoder:7b",
            promptVersion: "1.0.0",
            schemaVersion: "1.0.0",
        });

        // Seed into history
        historyRepo.seedArtifact(artifact);

        // Rollback simulation: Even if frontend/backend reverts to Sprint 5 code that does NOT call
        // /feedback or /export.csv, the core artifact and query functionality remains 100% intact
        const legacyFetch = await artifactRepo.findById(artifact.id);
        assert.ok(legacyFetch);
        assert.equal(legacyFetch.id, artifact.id);
        assert.equal(legacyFetch.status, "preview");

        // Soft deletion still works cleanly without breaking data integrity
        const deleteRes = await historyRepo.deleteUserArtifact("usr_alice", artifact.id);
        assert.equal(deleteRes.ok, true);
        assert.equal(deleteRes.status, "DELETED");
    });
});
