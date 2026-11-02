import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SemanticRepository } from "../../src/modules/semantic/semantic.repository.js";
import type { ConfidenceScoreBreakdown, SemanticFinding, ReviewAcknowledgement } from "@text2sql/contracts";

describe("Sprint 5 - Task 12: Semantic Findings Database Migration & Repository (US-11 / US-12 / DO-07)", () => {
    const sampleBreakdown: ConfidenceScoreBreakdown = {
        intentSlotAgreement: {
            name: "Intent-Slot Agreement",
            weight: 0.35,
            score: 1.0,
            weightedContribution: 35,
            available: true,
            evidenceSummary: "All intent slots represented.",
        },
        glossaryAndJoinEvidence: {
            name: "Glossary & Join Evidence",
            weight: 0.30,
            score: 1.0,
            weightedContribution: 30,
            available: true,
            evidenceSummary: "Conforms to glossary definitions.",
        },
        verifierAgreement: {
            name: "Verifier Consensus",
            weight: 0.20,
            score: 1.0,
            weightedContribution: 20,
            available: true,
            evidenceSummary: "Verifier consensus confirmed.",
        },
        candidateStability: {
            name: "Candidate Stability",
            weight: 0.15,
            score: 0.0,
            weightedContribution: 0,
            available: false,
            reasonUnavailable: "Skipped under latency profile.",
            evidenceSummary: "Candidate stability unavailable.",
        },
    };

    const sampleFindings: SemanticFinding[] = [
        {
            code: "JOIN_FANOUT_DUPLICATION",
            severity: "WARNING",
            message: "Potential 1-to-many join fanout risk.",
            repairable: false,
        },
    ];

    describe("Migration 06-init-semantic-confidence.sql Verification", () => {
        it("verifies migration file exists and defines all required schema columns and tables", async () => {
            const __dirname = path.dirname(fileURLToPath(import.meta.url));
            const migrationPath = path.resolve(
                __dirname,
                "../../../database/app/migrations/06-init-semantic-confidence.sql"
            );

            const sql = await fs.readFile(migrationPath, "utf-8");

            // 1. Expanded query_artifacts status check
            assert.ok(sql.includes("preview_ready"), "Must include preview_ready status");
            assert.ok(sql.includes("preview_review"), "Must include preview_review status");
            assert.ok(sql.includes("preview_blocked"), "Must include preview_blocked status");

            // 2. Required query_artifacts columns
            assert.ok(sql.includes("confidence_score"), "Must add confidence_score column");
            assert.ok(sql.includes("confidence_band"), "Must add confidence_band column");
            assert.ok(sql.includes("confidence_breakdown"), "Must add confidence_breakdown column");
            assert.ok(sql.includes("semantic_findings"), "Must add semantic_findings column");
            assert.ok(sql.includes("repair_attempts"), "Must add repair_attempts column");
            assert.ok(sql.includes("review_acknowledged"), "Must add review_acknowledged column");
            assert.ok(sql.includes("acknowledged_at"), "Must add acknowledged_at column");

            // 3. Required semantic_evaluations table & columns
            assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS semantic_evaluations"), "Must create semantic_evaluations table");
            assert.ok(sql.includes("dataset_version"), "Must define dataset_version column");
            assert.ok(sql.includes("model_id"), "Must define model_id column");
            assert.ok(sql.includes("prompt_version"), "Must define prompt_version column");
            assert.ok(sql.includes("total_cases"), "Must define total_cases column");
            assert.ok(sql.includes("accuracy_score"), "Must define accuracy_score column");
            assert.ok(sql.includes("wrong_answer_count"), "Must define wrong_answer_count column");
            assert.ok(sql.includes("refusal_recall"), "Must define refusal_recall column");
            assert.ok(sql.includes("metrics_payload"), "Must define metrics_payload column");
            assert.ok(sql.includes("created_at"), "Must define created_at column");
        });
    });

    describe("SemanticRepository - Artifact Metadata Persistence", () => {
        let repo: SemanticRepository;

        beforeEach(() => {
            repo = new SemanticRepository();
            repo.clear();
        });

        it("persists and retrieves confidence scores, breakdown, semantic findings, and repair attempts", async () => {
            const saved = await repo.saveArtifactSemanticMetadata({
                artifactId: "art_sem_1",
                confidenceScore: 78,
                confidenceBand: "REVIEW",
                confidenceBreakdown: sampleBreakdown,
                semanticFindings: sampleFindings,
                repairAttempts: 1,
            });

            assert.equal(saved.artifactId, "art_sem_1");
            assert.equal(saved.confidenceScore, 78);
            assert.equal(saved.confidenceBand, "REVIEW");
            assert.equal(saved.repairAttempts, 1);
            assert.equal(saved.reviewAcknowledged, false);
            assert.equal(saved.acknowledgedAt, null);
            assert.equal(saved.semanticFindings.length, 1);
            assert.equal(saved.semanticFindings[0].code, "JOIN_FANOUT_DUPLICATION");

            const retrieved = await repo.getArtifactSemanticMetadata("art_sem_1");
            assert.ok(retrieved);
            assert.equal(retrieved.confidenceScore, 78);
            assert.equal(retrieved.confidenceBand, "REVIEW");
            assert.equal(retrieved.confidenceBreakdown.intentSlotAgreement.weightedContribution, 35);
            assert.equal(retrieved.confidenceBreakdown.candidateStability.available, false);
        });

        it("returns null when querying metadata for an unknown artifact ID", async () => {
            const retrieved = await repo.getArtifactSemanticMetadata("art_does_not_exist");
            assert.equal(retrieved, null);
        });

        it("records review acknowledgement and updates timestamp and warnings", async () => {
            await repo.saveArtifactSemanticMetadata({
                artifactId: "art_review_ack_1",
                confidenceScore: 72,
                confidenceBand: "REVIEW",
                confidenceBreakdown: sampleBreakdown,
                semanticFindings: sampleFindings,
            });

            const ack: ReviewAcknowledgement = {
                confirmed: true,
                reviewedWarnings: ["Potential 1-to-many join fanout risk."],
                analystNote: "Reviewed join path; acceptable for aggregate report.",
            };

            const updated = await repo.recordReviewAcknowledgement("art_review_ack_1", ack);
            assert.ok(updated);
            assert.equal(updated.reviewAcknowledged, true);
            assert.ok(updated.acknowledgedAt);
            assert.deepEqual(updated.reviewedWarnings, ["Potential 1-to-many join fanout risk."]);
            assert.equal(updated.analystNote, "Reviewed join path; acceptable for aggregate report.");

            const fetched = await repo.getArtifactSemanticMetadata("art_review_ack_1");
            assert.equal(fetched?.reviewAcknowledged, true);
        });

        it("executes parameterized SQL UPDATE when database pool is provided", async () => {
            const capturedQueries: Array<{ text: string; values: any[] }> = [];
            const mockPool: any = {
                query: async (text: string, values: any[]) => {
                    capturedQueries.push({ text, values });
                    return { rows: [], rowCount: 1 };
                },
            };

            const dbRepo = new SemanticRepository(mockPool);
            await dbRepo.saveArtifactSemanticMetadata({
                artifactId: "art_db_1",
                confidenceScore: 92,
                confidenceBand: "HIGH",
                confidenceBreakdown: sampleBreakdown,
                semanticFindings: [],
                repairAttempts: 0,
            });

            assert.equal(capturedQueries.length, 1);
            assert.ok(capturedQueries[0].text.includes("UPDATE query_artifacts"));
            assert.equal(capturedQueries[0].values[0], 92);
            assert.equal(capturedQueries[0].values[1], "HIGH");
            assert.equal(capturedQueries[0].values[8], "art_db_1");
        });
    });

    describe("SemanticRepository - Benchmark Evaluation Runs (semantic_evaluations)", () => {
        let repo: SemanticRepository;

        beforeEach(() => {
            repo = new SemanticRepository();
            repo.clear();
        });

        it("creates and retrieves a semantic evaluation benchmark run", async () => {
            const evalRun = await repo.recordEvaluationRun({
                id: "eval_sprint5_run1",
                datasetVersion: "dev-v1.0",
                modelId: "qwen2.5-coder:7b",
                promptVersion: "v1.2",
                totalCases: 50,
                accuracyScore: 0.88,
                wrongAnswerCount: 1,
                refusalRecall: 0.95,
                metricsPayload: {
                    highBandWrongRate: 0.02,
                    falseRefusalRate: 0.08,
                },
            });

            assert.equal(evalRun.id, "eval_sprint5_run1");
            assert.equal(evalRun.datasetVersion, "dev-v1.0");
            assert.equal(evalRun.modelId, "qwen2.5-coder:7b");
            assert.equal(evalRun.totalCases, 50);
            assert.equal(evalRun.accuracyScore, 0.88);
            assert.equal(evalRun.wrongAnswerCount, 1);
            assert.equal(evalRun.refusalRecall, 0.95);
            assert.equal((evalRun.metricsPayload as any).highBandWrongRate, 0.02);

            const fetched = await repo.getEvaluationRunById("eval_sprint5_run1");
            assert.ok(fetched);
            assert.equal(fetched.id, "eval_sprint5_run1");
            assert.equal(fetched.accuracyScore, 0.88);
        });

        it("lists evaluation runs and filters by datasetVersion", async () => {
            await repo.recordEvaluationRun({
                id: "eval_1",
                datasetVersion: "dev-v1.0",
                modelId: "qwen2.5-coder:7b",
                promptVersion: "v1.0",
                totalCases: 50,
                accuracyScore: 0.84,
                wrongAnswerCount: 2,
                refusalRecall: 0.90,
            });

            await repo.recordEvaluationRun({
                id: "eval_2",
                datasetVersion: "dev-v1.1",
                modelId: "llama-3.3-70b",
                promptVersion: "v1.1",
                totalCases: 50,
                accuracyScore: 0.94,
                wrongAnswerCount: 0,
                refusalRecall: 0.96,
            });

            const allRuns = await repo.listEvaluationRuns();
            assert.equal(allRuns.length, 2);

            const filteredRuns = await repo.listEvaluationRuns("dev-v1.1");
            assert.equal(filteredRuns.length, 1);
            assert.equal(filteredRuns[0].id, "eval_2");
            assert.equal(filteredRuns[0].modelId, "llama-3.3-70b");
        });
    });
});

