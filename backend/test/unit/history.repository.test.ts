import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { HistoryRepository } from "../../src/modules/history/history.repository.js";
import type { QueryArtifactRecord } from "../../src/modules/generation/query-artifact.repository.js";

describe("Sprint 6 - Task 7: Paginated Owner-Filtered History & Feedback Repository (US-15)", () => {
    let repo: HistoryRepository;

    const createSampleArtifact = (id: string, userId: string, dateOffsetMinutes = 0): QueryArtifactRecord => {
        const createdAt = new Date(Date.now() - dateOffsetMinutes * 60 * 1000).toISOString();
        return {
            id,
            userId,
            prompt: `Question for ${id}`,
            generatedSql: `SELECT * FROM table_${id};`,
            status: "completed",
            assumptions: [],
            referencedTables: [`table_${id}`],
            referencedColumns: ["id"],
            explanation: `Explanation for ${id}`,
            provider: "ollama",
            model: "sqlcoder:7b",
            promptVersion: "1.0.0",
            schemaVersion: "v1.0",
            policyVersion: "1.0.0",
            createdAt,
            updatedAt: createdAt,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        };
    };

    beforeEach(() => {
        repo = new HistoryRepository();
    });

    describe("1. Paginated Query History (listUserHistory)", () => {
        it("returns paginated history sorted by createdAt descending", async () => {
            // Seed 5 artifacts for user_alice with different dates
            repo.seedArtifact(createSampleArtifact("art_alice_1", "user_alice", 10)); // oldest
            repo.seedArtifact(createSampleArtifact("art_alice_2", "user_alice", 5));  // middle
            repo.seedArtifact(createSampleArtifact("art_alice_3", "user_alice", 1), { score: 92, band: "high" });  // newest

            const res = await repo.listUserHistory("user_alice", { limit: 2, offset: 0 });
            assert.equal(res.total, 3);
            assert.equal(res.items.length, 2);
            assert.equal(res.limit, 2);
            assert.equal(res.offset, 0);
            assert.equal(res.hasMore, true);

            // Newest first
            assert.equal(res.items[0].artifactId, "art_alice_3");
            assert.equal(res.items[0].confidenceScore, 92);
            assert.equal(res.items[0].confidenceBand, "high");
            assert.equal(res.items[1].artifactId, "art_alice_2");

            // Page 2
            const resPage2 = await repo.listUserHistory("user_alice", { limit: 2, offset: 2 });
            assert.equal(resPage2.items.length, 1);
            assert.equal(resPage2.items[0].artifactId, "art_alice_1");
            assert.equal(resPage2.hasMore, false);
        });

        it("strictly isolates history across users (Analyst Bob sees zero of Alice's history)", async () => {
            repo.seedArtifact(createSampleArtifact("art_alice_1", "user_alice", 5));
            repo.seedArtifact(createSampleArtifact("art_bob_1", "user_bob", 2));

            const aliceHistory = await repo.listUserHistory("user_alice");
            assert.equal(aliceHistory.total, 1);
            assert.equal(aliceHistory.items[0].artifactId, "art_alice_1");

            const bobHistory = await repo.listUserHistory("user_bob");
            assert.equal(bobHistory.total, 1);
            assert.equal(bobHistory.items[0].artifactId, "art_bob_1");
        });

        it("filters out soft-deleted artifacts from user history", async () => {
            repo.seedArtifact(createSampleArtifact("art_active", "user_alice", 5));
            repo.seedArtifact(createSampleArtifact("art_deleted", "user_alice", 2));

            // Soft-delete art_deleted
            const delRes = await repo.deleteUserArtifact("user_alice", "art_deleted");
            assert.equal(delRes.ok, true);
            assert.equal(delRes.status, "DELETED");

            const history = await repo.listUserHistory("user_alice");
            assert.equal(history.total, 1);
            assert.equal(history.items[0].artifactId, "art_active");
        });
    });

    describe("2. Owner-Scoped Artifact Deletion (deleteUserArtifact)", () => {
        it("allows owner to soft-delete their own artifact", async () => {
            repo.seedArtifact(createSampleArtifact("art_1", "user_alice", 0));

            const delRes = await repo.deleteUserArtifact("user_alice", "art_1");
            assert.equal(delRes.ok, true);
            assert.equal(delRes.status, "DELETED");

            // Subsequent delete returns NOT_FOUND
            const secondDel = await repo.deleteUserArtifact("user_alice", "art_1");
            assert.equal(secondDel.ok, false);
            assert.equal(secondDel.status, "NOT_FOUND");
        });

        it("rejects deletion by non-owner with FORBIDDEN", async () => {
            repo.seedArtifact(createSampleArtifact("art_alice_priv", "user_alice", 0));

            const delRes = await repo.deleteUserArtifact("user_bob", "art_alice_priv");
            assert.equal(delRes.ok, false);
            assert.equal(delRes.status, "FORBIDDEN");
        });

        it("returns NOT_FOUND for non-existent artifact", async () => {
            const delRes = await repo.deleteUserArtifact("user_alice", "art_non_existent");
            assert.equal(delRes.ok, false);
            assert.equal(delRes.status, "NOT_FOUND");
        });
    });

    describe("3. Analyst Feedback Persistence (saveFeedback & getFeedbackForArtifact)", () => {
        it("saves feedback record and retrieves latest feedback for an artifact", async () => {
            const feedback = await repo.saveFeedback({
                artifactId: "art_feedback_1",
                userId: "user_alice",
                verdict: "incorrect",
                reasonCode: "wrong_filter",
                notes: "Query should have filtered status = 'completed'",
            });

            assert.ok(feedback.id.startsWith("fb_"));
            assert.equal(feedback.artifactId, "art_feedback_1");
            assert.equal(feedback.userId, "user_alice");
            assert.equal(feedback.verdict, "incorrect");
            assert.equal(feedback.reasonCode, "wrong_filter");
            assert.equal(feedback.notes, "Query should have filtered status = 'completed'");

            const retrieved = await repo.getFeedbackForArtifact("art_feedback_1", "user_alice");
            assert.ok(retrieved);
            assert.equal(retrieved.id, feedback.id);
            assert.equal(retrieved.verdict, "incorrect");
        });

        it("returns null when no feedback has been recorded for artifact", async () => {
            const retrieved = await repo.getFeedbackForArtifact("art_no_feedback");
            assert.equal(retrieved, null);
        });
    });
});

