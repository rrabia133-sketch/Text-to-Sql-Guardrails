import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { IntentExtractorService } from "../../src/modules/intent/intent-extractor.service.js";
import { SemanticValidatorService } from "../../src/modules/semantic/semantic-validator.service.js";
import { ConfidenceService } from "../../src/modules/semantic/confidence.service.js";
import { CONFIDENCE_WEIGHTS, CONFIDENCE_THRESHOLDS } from "@text2sql/contracts";

describe("Sprint 5 - Task 16: Confidence Scoring & Decision Band Suite (US-11 / US-12)", () => {
    const intentExtractor = new IntentExtractorService();
    const semanticValidator = new SemanticValidatorService();
    const confidenceService = new ConfidenceService();

    it("verifies 4-component weight sum equals 1.0 (35% + 30% + 20% + 15%)", () => {
        const sum =
            CONFIDENCE_WEIGHTS.INTENT_SLOT_AGREEMENT +
            CONFIDENCE_WEIGHTS.GLOSSARY_JOIN_EVIDENCE +
            CONFIDENCE_WEIGHTS.VERIFIER_AGREEMENT +
            CONFIDENCE_WEIGHTS.CANDIDATE_STABILITY;
        assert.equal(Number(sum.toFixed(2)), 1.0);
    });

    it("calculates exact 100/100 HIGH confidence when all 4 components agree (including candidate stability)", () => {
        const intent = intentExtractor.extract(
            "What was our total revenue last month?",
            new Date("2026-04-15T12:00:00Z")
        );
        const sql =
            "SELECT SUM(oi.quantity * oi.unit_price) AS total_revenue FROM orders o JOIN order_items oi ON o.id = oi.order_id WHERE o.status = 'completed' AND o.ordered_at >= '2026-03-01' AND o.ordered_at < '2026-04-01' LIMIT 50;";
        const semanticResult = semanticValidator.validate(parse(sql)[0], intent);

        const scoreResult = confidenceService.computeConfidence({
            semanticResult,
            verifierResult: {
                score: 1.0,
                available: true,
                unavailable: false,
                evidenceSummary: "Bounded verifier agrees 100%.",
                agrees: true,
            },
            stabilityResult: {
                score: 1.0,
                available: true,
                unavailable: false,
                evidenceSummary: "Secondary candidate structurally equivalent.",
            },
        });

        assert.equal(scoreResult.score, 100);
        assert.equal(scoreResult.band, "HIGH");
        assert.equal(scoreResult.executionEligible, true);
        assert.equal(scoreResult.requiresAcknowledgement, false);
        assert.equal(scoreResult.isHeuristic, true);
        assert.equal(scoreResult.breakdown.intentSlotAgreement.weightedContribution, 35);
        assert.equal(scoreResult.breakdown.glossaryAndJoinEvidence.weightedContribution, 30);
        assert.equal(scoreResult.breakdown.verifierAgreement.weightedContribution, 20);
        assert.equal(scoreResult.breakdown.candidateStability.weightedContribution, 15);
    });

    it("handles unavailable candidate stability explicitly (score = 0, available = false) without redistributing weights", () => {
        const intent = intentExtractor.extract("How many orders do we have?");
        const sql = "SELECT COUNT(id) AS order_count FROM orders LIMIT 50;";
        const semanticResult = semanticValidator.validate(parse(sql)[0], intent);

        const scoreResult = confidenceService.computeConfidence({
            semanticResult,
            // No secondary candidate stability provided -> defaults to unavailable (0 / 15 pts)
        });

        assert.equal(scoreResult.breakdown.candidateStability.available, false);
        assert.equal(scoreResult.breakdown.candidateStability.score, 0);
        assert.equal(scoreResult.breakdown.candidateStability.weightedContribution, 0);
        assert.ok(scoreResult.breakdown.candidateStability.reasonUnavailable);

        // 35 + 30 + 20 + 0 = 85 -> HIGH band boundary
        assert.equal(scoreResult.score, CONFIDENCE_THRESHOLDS.HIGH_MIN);
        assert.equal(scoreResult.band, "HIGH");
    });

    it("assigns REVIEW band (65 <= score < 85) and requires acknowledgement when advisory warnings reduce score", () => {
        const intent = intentExtractor.extract(
            "Total orders and unique orders by status for completed orders"
        );
        const sql =
            "SELECT status, COUNT(id) AS order_count FROM orders WHERE status = 'completed' GROUP BY status LIMIT 50;";
        const semanticResult = semanticValidator.validate(parse(sql)[0], intent);

        assert.equal(semanticResult.isValid, true);
        assert.equal(semanticResult.warningCount, 1);

        const scoreResult = confidenceService.computeConfidence({
            semanticResult,
        });

        assert.ok(
            scoreResult.score >= CONFIDENCE_THRESHOLDS.REVIEW_MIN &&
                scoreResult.score < CONFIDENCE_THRESHOLDS.HIGH_MIN,
            `Expected REVIEW score in [65, 84], got ${scoreResult.score}`
        );
        assert.equal(scoreResult.band, "REVIEW");
        assert.equal(scoreResult.executionEligible, true);
        assert.equal(scoreResult.requiresAcknowledgement, true);
    });

    it("assigns BLOCKED band and forbids execution when any CRITICAL semantic finding exists, even if raw component points >= 65", () => {
        const intent = intentExtractor.extract("What is our total revenue from completed orders?");
        const sql =
            "SELECT SUM(oi.quantity * oi.unit_price) AS revenue FROM orders o JOIN order_items oi ON o.id = oi.order_id LIMIT 50;";
        const semanticResult = semanticValidator.validate(parse(sql)[0], intent);

        assert.equal(semanticResult.isValid, false);
        assert.ok(semanticResult.criticalCount >= 1);

        const scoreResult = confidenceService.computeConfidence({
            semanticResult,
            verifierResult: {
                score: 1.0,
                available: true,
                unavailable: false,
                evidenceSummary: "Mock high verifier score",
                agrees: true,
            },
        });

        assert.equal(scoreResult.band, "BLOCKED");
        assert.equal(scoreResult.executionEligible, false);
        assert.equal(scoreResult.hasCriticalFindings, true);
    });
});
