import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ArtifactGate } from "../../src/modules/execution/artifact-gate.js";
import { QueryArtifactRepository } from "../../src/modules/generation/query-artifact.repository.js";

describe("Sprint 4 - Task 12: Immutable Artifact Ownership, Expiry & SQL Hash Gate (US-10)", () => {
    let repo: QueryArtifactRepository;
    let gate: ArtifactGate;

    beforeEach(() => {
        repo = new QueryArtifactRepository();
        repo.clear();
        gate = new ArtifactGate(repo);
    });

    describe("Happy Path Verification", () => {
        it("approves valid, owned, unexpired preview artifact and returns SHA-256 hash", async () => {
            const artifact = await repo.create({
                id: "art_valid_1",
                userId: "user_analyst_1",
                prompt: "Show all customers from US",
                generatedSql: "SELECT id, name, region FROM customers WHERE region = 'US' LIMIT 50;",
                assumptions: ["Filtered by US region"],
                referencedTables: ["customers"],
                referencedColumns: ["customers.id", "customers.name", "customers.region"],
                explanation: "Filters customers table by US region",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "v1.0",
                schemaVersion: "v1.0",
                expiresInMinutes: 15,
            });

            const result = await gate.verify("art_valid_1", "user_analyst_1");

            assert.equal(result.ok, true);
            assert.equal(result.errorCode, undefined);
            assert.ok(result.artifact);
            assert.equal(result.artifact.id, "art_valid_1");
            assert.ok(result.sqlHash);
            assert.equal(result.sqlHash, gate.computeSqlHash(artifact.generatedSql));
        });

        it("approves when client provides matching SQL or matching hash", async () => {
            const sql = "SELECT id, name FROM products LIMIT 20;";
            const artifact = await repo.create({
                id: "art_valid_2",
                userId: "user_analyst_1",
                prompt: "List products",
                generatedSql: sql,
                assumptions: [],
                referencedTables: ["products"],
                referencedColumns: ["products.id", "products.name"],
                explanation: "Lists products",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "v1.0",
                schemaVersion: "v1.0",
            });

            const expectedHash = gate.computeSqlHash(sql);

            const result = await gate.verify("art_valid_2", "user_analyst_1", {
                clientProvidedSql: sql,
                clientProvidedHash: expectedHash,
            });

            assert.equal(result.ok, true);
            assert.equal(result.sqlHash, expectedHash);
        });
    });

    describe("Fail-Closed Security Rejections", () => {
        it("rejects non-existent artifact with ARTIFACT_NOT_FOUND", async () => {
            const result = await gate.verify("art_non_existent", "user_analyst_1");

            assert.equal(result.ok, false);
            assert.equal(result.errorCode, "ARTIFACT_NOT_FOUND");
            assert.match(result.errorMessage!, /was not found/i);
        });

        it("rejects cross-tenant access with ARTIFACT_NOT_OWNED", async () => {
            await repo.create({
                id: "art_user_b",
                userId: "user_b",
                prompt: "Show orders",
                generatedSql: "SELECT id FROM orders LIMIT 10;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Orders",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "v1.0",
                schemaVersion: "v1.0",
            });

            // User A attempts to execute User B's artifact
            const result = await gate.verify("art_user_b", "user_a");

            assert.equal(result.ok, false);
            assert.equal(result.errorCode, "ARTIFACT_NOT_OWNED");
            assert.match(result.errorMessage!, /belongs to another user/i);
        });

        it("rejects artifacts that are not in preview status with TRANSACTION_VIOLATION", async () => {
            const artifact = await repo.create({
                id: "art_completed",
                userId: "user_analyst_1",
                prompt: "Orders",
                generatedSql: "SELECT id FROM orders LIMIT 10;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Orders",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "v1.0",
                schemaVersion: "v1.0",
            });

            // Mark artifact as completed (already executed)
            await repo.updateStatus("art_completed", "completed");

            const result = await gate.verify("art_completed", "user_analyst_1");

            assert.equal(result.ok, false);
            assert.equal(result.errorCode, "TRANSACTION_VIOLATION");
            assert.match(result.errorMessage!, /only 'preview' artifacts may be executed/i);
        });

        it("rejects expired artifact (>15 minutes) with ARTIFACT_EXPIRED", async () => {
            await repo.create({
                id: "art_expired",
                userId: "user_analyst_1",
                prompt: "Orders",
                generatedSql: "SELECT id FROM orders LIMIT 10;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Orders",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "v1.0",
                schemaVersion: "v1.0",
                expiresInMinutes: -5, // Expired 5 minutes ago
            });

            const result = await gate.verify("art_expired", "user_analyst_1");

            assert.equal(result.ok, false);
            assert.equal(result.errorCode, "ARTIFACT_EXPIRED");
            assert.match(result.errorMessage!, /expired/i);
        });

        it("rejects raw SQL substitution attack with HASH_MISMATCH", async () => {
            await repo.create({
                id: "art_subst",
                userId: "user_analyst_1",
                prompt: "Orders",
                generatedSql: "SELECT id FROM orders LIMIT 10;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Orders",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "v1.0",
                schemaVersion: "v1.0",
            });

            // Client attempts to sneak an arbitrary SQL string
            const result = await gate.verify("art_subst", "user_analyst_1", {
                clientProvidedSql: "DROP TABLE orders; -- malicious SQL",
            });

            assert.equal(result.ok, false);
            assert.equal(result.errorCode, "HASH_MISMATCH");
            assert.match(result.errorMessage!, /SQL substitution rejected/i);
        });

        it("rejects forged client hash with HASH_MISMATCH", async () => {
            await repo.create({
                id: "art_forged_hash",
                userId: "user_analyst_1",
                prompt: "Orders",
                generatedSql: "SELECT id FROM orders LIMIT 10;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Orders",
                provider: "ollama",
                model: "sqlcoder:7b",
                promptVersion: "v1.0",
                schemaVersion: "v1.0",
            });

            const result = await gate.verify("art_forged_hash", "user_analyst_1", {
                clientProvidedHash: "forged_sha256_hash_1234567890abcdef",
            });

            assert.equal(result.ok, false);
            assert.equal(result.errorCode, "HASH_MISMATCH");
            assert.match(result.errorMessage!, /hash verification failed/i);
        });
    });
});
