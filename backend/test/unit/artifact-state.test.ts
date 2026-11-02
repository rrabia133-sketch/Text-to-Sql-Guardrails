import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ArtifactStateService } from "../../src/modules/execution/artifact-state.service.js";
import { ArtifactGate } from "../../src/modules/execution/artifact-gate.js";
import { QueryArtifactRepository } from "../../src/modules/generation/query-artifact.repository.js";
import type { ReviewAcknowledgement } from "@text2sql/contracts";

describe("Sprint 5 - Task 11: Artifact State Machine & Review Acknowledgement Gate (US-11 / US-12)", () => {
    describe("ArtifactStateService - State Resolution & Transitions", () => {
        const stateService = new ArtifactStateService();

        it("resolves state as 'preview_ready' for HIGH confidence band with zero critical findings", () => {
            const state = stateService.resolveState({
                confidenceBand: "HIGH",
                hasCriticalFindings: false,
                guardrailsValid: true,
            });
            assert.equal(state, "preview_ready");
        });

        it("resolves state as 'preview_review' for REVIEW confidence band with zero critical findings", () => {
            const state = stateService.resolveState({
                confidenceBand: "REVIEW",
                hasCriticalFindings: false,
                guardrailsValid: true,
            });
            assert.equal(state, "preview_review");
        });

        it("resolves state as 'preview_blocked' for BLOCKED confidence band", () => {
            const state = stateService.resolveState({
                confidenceBand: "BLOCKED",
                hasCriticalFindings: false,
                guardrailsValid: true,
            });
            assert.equal(state, "preview_blocked");
        });

        it("forces state to 'preview_blocked' if any critical semantic findings exist regardless of confidence band", () => {
            const stateFromHigh = stateService.resolveState({
                confidenceBand: "HIGH",
                hasCriticalFindings: true, // Critical finding override
                guardrailsValid: true,
            });
            assert.equal(stateFromHigh, "preview_blocked");

            const stateFromReview = stateService.resolveState({
                confidenceBand: "REVIEW",
                hasCriticalFindings: true,
                guardrailsValid: true,
            });
            assert.equal(stateFromReview, "preview_blocked");
        });

        it("forces state to 'preview_blocked' if security guardrails failed", () => {
            const state = stateService.resolveState({
                confidenceBand: "HIGH",
                hasCriticalFindings: false,
                guardrailsValid: false, // Security violation override
            });
            assert.equal(state, "preview_blocked");
        });

        it("validates lifecycle status transitions correctly", () => {
            assert.equal(stateService.isValidTransition("preview_ready", "executing"), true);
            assert.equal(stateService.isValidTransition("preview_review", "executing"), true);
            assert.equal(stateService.isValidTransition("preview", "executing"), true);
            assert.equal(stateService.isValidTransition("executing", "executed"), true);
            assert.equal(stateService.isValidTransition("executing", "failed"), true);

            // Blocked artifacts can NEVER transition to executing
            assert.equal(stateService.isValidTransition("preview_blocked", "executing"), false);
            assert.equal(stateService.isValidTransition("executed", "executing"), false);
        });
    });

    describe("ArtifactStateService - Execution Gate Enforcements", () => {
        const stateService = new ArtifactStateService();

        it("allows immediate execution for 'preview_ready' and legacy 'preview' artifacts", () => {
            const readyCheck = stateService.canExecute("preview_ready");
            assert.equal(readyCheck.allowed, true);

            const legacyCheck = stateService.canExecute("preview");
            assert.equal(legacyCheck.allowed, true);
        });

        it("blocks execution of 'preview_blocked' artifacts with BLOCKED_CONFIDENCE_BAND", () => {
            const check = stateService.canExecute("preview_blocked");
            assert.equal(check.allowed, false);
            assert.equal(check.errorCode, "BLOCKED_CONFIDENCE_BAND");
            assert.ok(check.errorMessage?.includes("preview_blocked"));
        });

        it("blocks execution of 'preview_review' artifacts without explicit acknowledgement", () => {
            const noAckCheck = stateService.canExecute("preview_review");
            assert.equal(noAckCheck.allowed, false);
            assert.equal(noAckCheck.errorCode, "REVIEW_ACKNOWLEDGEMENT_REQUIRED");
            assert.ok(noAckCheck.errorMessage?.includes("acknowledgement of warnings is required"));

            const unconfirmedAck: ReviewAcknowledgement = {
                confirmed: false as any,
                reviewedWarnings: ["Missing temporal bounds"],
            };
            const unconfirmedCheck = stateService.canExecute("preview_review", unconfirmedAck);
            assert.equal(unconfirmedCheck.allowed, false);
            assert.equal(unconfirmedCheck.errorCode, "REVIEW_ACKNOWLEDGEMENT_REQUIRED");
        });

        it("approves execution of 'preview_review' artifacts when confirmed acknowledgement is supplied", () => {
            const confirmedAck: ReviewAcknowledgement = {
                confirmed: true,
                reviewedWarnings: ["Missing temporal bounds", "Potential fanout risk"],
                analystNote: "Confirmed acceptable for quarterly exploration",
            };

            const check = stateService.canExecute("preview_review", confirmedAck);
            assert.equal(check.allowed, true);
            assert.equal(check.errorCode, undefined);
        });

        it("rejects non-preview states (executing, executed, failed) with TRANSACTION_VIOLATION", () => {
            assert.equal(stateService.canExecute("executing").errorCode, "TRANSACTION_VIOLATION");
            assert.equal(stateService.canExecute("executed").errorCode, "TRANSACTION_VIOLATION");
            assert.equal(stateService.canExecute("failed").errorCode, "TRANSACTION_VIOLATION");
        });
    });

    describe("ArtifactGate Integration - End-to-End Verification", () => {
        let repo: QueryArtifactRepository;
        let gate: ArtifactGate;

        beforeEach(() => {
            repo = new QueryArtifactRepository();
            gate = new ArtifactGate(repo);
        });

        it("approves preview_ready artifact execution", async () => {
            const artifact = await repo.create({
                id: "art_ready_1",
                userId: "user_analyst_1",
                prompt: "List active customers",
                generatedSql: "SELECT id, name FROM customers WHERE active = true;",
                assumptions: [],
                referencedTables: ["customers"],
                referencedColumns: ["customers.id", "customers.name", "customers.active"],
                explanation: "Active customers",
                provider: "ollama",
                model: "qwen2.5-coder:7b",
                promptVersion: "v1.0",
                schemaVersion: "v1.0",
            });
            await repo.updateStatus("art_ready_1", "preview_ready");

            const result = await gate.verify("art_ready_1", "user_analyst_1");
            assert.equal(result.ok, true);
            assert.equal(result.errorCode, undefined);
            assert.equal(result.artifact?.status, "preview_ready");
        });

        it("rejects preview_blocked artifact with BLOCKED_CONFIDENCE_BAND", async () => {
            await repo.create({
                id: "art_blocked_1",
                userId: "user_analyst_1",
                prompt: "Question with low confidence",
                generatedSql: "SELECT id FROM orders;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Orders",
                provider: "ollama",
                model: "qwen2.5-coder:7b",
                promptVersion: "v1.0",
                schemaVersion: "v1.0",
            });
            await repo.updateStatus("art_blocked_1", "preview_blocked");

            const result = await gate.verify("art_blocked_1", "user_analyst_1");
            assert.equal(result.ok, false);
            assert.equal(result.errorCode, "BLOCKED_CONFIDENCE_BAND");
            assert.ok(result.errorMessage?.includes("preview_blocked"));
        });

        it("rejects preview_review artifact when acknowledgement is missing", async () => {
            await repo.create({
                id: "art_review_1",
                userId: "user_analyst_1",
                prompt: "Question needing review",
                generatedSql: "SELECT id FROM orders;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Orders",
                provider: "ollama",
                model: "qwen2.5-coder:7b",
                promptVersion: "v1.0",
                schemaVersion: "v1.0",
            });
            await repo.updateStatus("art_review_1", "preview_review");

            // No acknowledgement supplied
            const result = await gate.verify("art_review_1", "user_analyst_1");
            assert.equal(result.ok, false);
            assert.equal(result.errorCode, "REVIEW_ACKNOWLEDGEMENT_REQUIRED");
        });

        it("approves preview_review artifact when valid confirmed acknowledgement is provided", async () => {
            await repo.create({
                id: "art_review_2",
                userId: "user_analyst_1",
                prompt: "Question needing review",
                generatedSql: "SELECT id FROM orders;",
                assumptions: [],
                referencedTables: ["orders"],
                referencedColumns: ["orders.id"],
                explanation: "Orders",
                provider: "ollama",
                model: "qwen2.5-coder:7b",
                promptVersion: "v1.0",
                schemaVersion: "v1.0",
            });
            await repo.updateStatus("art_review_2", "preview_review");

            const acknowledgement: ReviewAcknowledgement = {
                confirmed: true,
                reviewedWarnings: ["Potential fanout detected"],
            };

            const result = await gate.verify("art_review_2", "user_analyst_1", {
                acknowledgement,
            });
            assert.equal(result.ok, true);
            assert.equal(result.errorCode, undefined);
        });
    });
});

