import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QueryArtifactRepository } from "../../src/modules/generation/query-artifact.repository.js";

describe("Task 14: Query Artifact Persistence & Ownership Isolation (US-06)", () => {
    const repo = new QueryArtifactRepository();

    const userAlice = "user_alice_uuid";
    const userBob = "user_bob_uuid";

    it("persists complete Sprint 3 metadata and initializes status to 'preview'", async () => {
        const artifact = await repo.create({
            userId: userAlice,
            prompt: "What is the revenue for 2026?",
            generatedSql: "SELECT SUM(oi.quantity * oi.unit_price) FROM orders o JOIN order_items oi ON o.id = oi.order_id WHERE o.status = 'completed';",
            assumptions: ["Only completed orders counted"],
            referencedTables: ["orders", "order_items"],
            referencedColumns: ["orders.id", "orders.status", "order_items.quantity", "order_items.unit_price"],
            explanation: "Calculates total recognized revenue from completed orders.",
            provider: "ollama",
            model: "qwen2.5-coder:7b",
            promptVersion: "1.0.0",
            schemaVersion: "v1-abcdef123456",
            expiresInMinutes: 15,
        });

        assert.equal(artifact.status, "preview", "Initial status MUST be 'preview'");
        assert.equal(artifact.userId, userAlice);
        assert.deepEqual(artifact.assumptions, ["Only completed orders counted"]);
        assert.deepEqual(artifact.referencedTables, ["orders", "order_items"]);
        assert.equal(artifact.provider, "ollama");
        assert.equal(artifact.model, "qwen2.5-coder:7b");
        assert.equal(artifact.promptVersion, "1.0.0");
        assert.equal(artifact.schemaVersion, "v1-abcdef123456");
        assert.ok(new Date(artifact.expiresAt).getTime() > new Date(artifact.createdAt).getTime());
    });

    it("allows owner (Alice) to inspect her query artifact", async () => {
        const created = await repo.create({
            userId: userAlice,
            prompt: "Top customers",
            generatedSql: "SELECT * FROM customers LIMIT 10;",
            assumptions: [],
            referencedTables: ["customers"],
            referencedColumns: ["customers.id"],
            explanation: "Top customers.",
            provider: "ollama",
            model: "qwen2.5-coder:7b",
            promptVersion: "1.0.0",
            schemaVersion: "v1-12345",
        });

        const found = await repo.findById(created.id, userAlice);
        assert.ok(found !== null);
        assert.equal(found.id, created.id);
        assert.equal(found.userId, userAlice);
    });

    it("strictly isolates ownership: Bob cannot inspect Alice's artifact (returns null)", async () => {
        const aliceArtifact = await repo.create({
            userId: userAlice,
            prompt: "Alice confidential query",
            generatedSql: "SELECT id FROM orders LIMIT 5;",
            assumptions: [],
            referencedTables: ["orders"],
            referencedColumns: ["orders.id"],
            explanation: "Confidential.",
            provider: "ollama",
            model: "qwen2.5-coder:7b",
            promptVersion: "1.0.0",
            schemaVersion: "v1-12345",
        });

        // Bob attempts to read Alice's artifact by ID
        const bobAttempt = await repo.findById(aliceArtifact.id, userBob);
        assert.equal(bobAttempt, null, "Cross-user IDOR access must be denied (returns null)");
    });

    it("lists artifacts filtered strictly by user", async () => {
        const aliceList = await repo.listByUser(userAlice);
        const bobList = await repo.listByUser(userBob);

        assert.ok(aliceList.length >= 2);
        assert.equal(bobList.length, 0);

        for (const item of aliceList) {
            assert.equal(item.userId, userAlice);
        }
    });
});
