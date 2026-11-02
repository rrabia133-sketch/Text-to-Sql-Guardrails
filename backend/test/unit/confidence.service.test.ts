import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConfidenceService } from "../../src/modules/semantic/confidence.service.js";
import {
    ConfidenceScoreResultSchema,
    CONFIDENCE_THRESHOLDS,
    CONFIDENCE_WEIGHTS,
    type IntentSlots,
    type SemanticValidationResult,
    type GuardrailValidationResult,
} from "@text2sql/contracts";
import type { VerifierResult, CandidateStabilityResult } from "../../src/modules/semantic/candidate-verifier.service.js";

describe("Sprint 5 - Task 10: 4-Component Transparent Confidence Scoring Engine (US-12)", () => {
    const service = new ConfidenceService();

    const sampleIntent: IntentSlots = {
        rawQuestion: "What is total revenue from completed orders?",
        metric: "revenue",
        aggregation: "SUM",
        dimensions: [],
        filters: [{ column: "orders.status", operator: "=", value: "completed" }],
    };

    const cleanSemanticResult: SemanticValidationResult = {
        isValid: true,
        findings: [],
        intentSlots: sampleIntent,
        criticalCount: 0,
        warningCount: 0,
        infoCount: 0,
        hasRepairableFindings: false,
        summary: "Semantically valid: matches intent slots, glossary rules, and schema cardinalities.",
    };

    const cleanStabilityResult: CandidateStabilityResult = {
        score: 1.0,
        available: true,
        unavailable: false,
        evidenceSummary: "High structural consensus between primary and secondary generation candidates.",
        secondarySql: "SELECT SUM(oi.quantity * oi.unit_price) FROM orders o JOIN order_items oi ON o.id = oi.order_id WHERE o.status = 'completed'",
        metrics: {
            projectionSimilarity: 1.0,
            tableJoinSimilarity: 1.0,
            predicateSimilarity: 1.0,
        },
    };

    const cleanVerifierResult: VerifierResult = {
        score: 1.0,
        available: true,
        unavailable: false,
        agrees: true,
        discrepancies: [],
        evidenceSummary: "SQL correctly computes sum of quantity * unit_price with completed status filter.",
    };

    describe("Component Weights & Full Consensus Scoring (100 / HIGH)", () => {
        it("computes overall score 100 in HIGH band when all 4 components achieve perfect consensus", () => {
            const result = service.computeConfidence({
                semanticResult: cleanSemanticResult,
                verifierResult: cleanVerifierResult,
                stabilityResult: cleanStabilityResult,
            });

            // Assert contract schema compliance
            const parsed = ConfidenceScoreResultSchema.safeParse(result);
            assert.equal(parsed.success, true);

            // Assert 4 components
            assert.equal(result.score, 100);
            assert.equal(result.band, "HIGH");
            assert.equal(result.executionEligible, true);
            assert.equal(result.requiresAcknowledgement, false);
            assert.equal(result.hasCriticalFindings, false);
            assert.equal(result.isHeuristic, true);
            assert.ok(result.heuristicDisclaimer.includes("Heuristic confidence score"));
            assert.ok(result.decisionExplanation.includes("High heuristic confidence"));

            // Breakdown inspections
            assert.equal(result.breakdown.intentSlotAgreement.score, 1.0);
            assert.equal(result.breakdown.intentSlotAgreement.weightedContribution, 35);
            assert.equal(result.breakdown.glossaryAndJoinEvidence.score, 1.0);
            assert.equal(result.breakdown.glossaryAndJoinEvidence.weightedContribution, 30);
            assert.equal(result.breakdown.verifierAgreement.score, 1.0);
            assert.equal(result.breakdown.verifierAgreement.weightedContribution, 20);
            assert.equal(result.breakdown.candidateStability.score, 1.0);
            assert.equal(result.breakdown.candidateStability.weightedContribution, 15);
        });

        it("verifies component weights strictly match specification (35% + 30% + 20% + 15% = 100%)", () => {
            const sum =
                CONFIDENCE_WEIGHTS.INTENT_SLOT_AGREEMENT +
                CONFIDENCE_WEIGHTS.GLOSSARY_JOIN_EVIDENCE +
                CONFIDENCE_WEIGHTS.VERIFIER_AGREEMENT +
                CONFIDENCE_WEIGHTS.CANDIDATE_STABILITY;

            assert.equal(Math.round(sum * 100) / 100, 1.0);
        });
    });

    describe("Explicit Unavailable Evidence Accounting (AC-US12-2)", () => {
        it("marks candidate stability as unavailable (0 contribution) without silent renormalization", () => {
            const unavailableStability: CandidateStabilityResult = {
                score: 0.0,
                available: false,
                unavailable: true,
                reasonUnavailable: "Candidate generation timed out under strict latency budget.",
                evidenceSummary: "Candidate stability evidence not available.",
            };

            const result = service.computeConfidence({
                semanticResult: cleanSemanticResult,
                verifierResult: cleanVerifierResult,
                stabilityResult: unavailableStability,
            });

            // Breakdown inspections
            assert.equal(result.breakdown.candidateStability.available, false);
            assert.equal(result.breakdown.candidateStability.weightedContribution, 0);
            assert.equal(result.breakdown.candidateStability.score, 0.0);
            assert.equal(
                result.breakdown.candidateStability.reasonUnavailable,
                "Candidate generation timed out under strict latency budget."
            );

            // Total score drops by exactly 15 points (35 + 30 + 20 + 0 = 85)
            assert.equal(result.score, 85);
            assert.equal(result.band, "HIGH");
            assert.equal(result.executionEligible, true);
        });

        it("drops score into REVIEW band when both stability and verifier are unavailable (contributes 0 + 0)", () => {
            const unavailableVerifier: VerifierResult = {
                score: 0.0,
                available: false,
                unavailable: true,
                reasonUnavailable: "Verifier evaluation timed out.",
                evidenceSummary: "Bounded verifier timed out.",
            };

            const unavailableStability: CandidateStabilityResult = {
                score: 0.0,
                available: false,
                unavailable: true,
                reasonUnavailable: "Secondary candidate generation skipped.",
                evidenceSummary: "Candidate stability evidence not available.",
            };

            const result = service.computeConfidence({
                semanticResult: cleanSemanticResult,
                verifierResult: unavailableVerifier,
                stabilityResult: unavailableStability,
            });

            // 35 (intent) + 30 (glossary) + 0 (verifier) + 0 (stability) = 65
            assert.equal(result.score, 65);
            assert.equal(result.band, "REVIEW");
            assert.equal(result.executionEligible, true);
            assert.equal(result.requiresAcknowledgement, true);
            assert.ok(result.decisionExplanation.includes("Review band (65/100)"));
        });
    });

    describe("Decision Bands & Thresholds (AC-US12-3)", () => {
        it("assigns HIGH band for scores >= 85 (eligible for immediate run query click)", () => {
            const band = service.calculateBand(85, false, true);
            assert.equal(band, "HIGH");
            assert.equal(CONFIDENCE_THRESHOLDS.HIGH_MIN, 85);
        });

        it("assigns REVIEW band for scores between 65 and 84 (requires explicit review acknowledgement)", () => {
            const bandMid = service.calculateBand(75, false, true);
            const bandMin = service.calculateBand(65, false, true);
            const bandMax = service.calculateBand(84, false, true);

            assert.equal(bandMid, "REVIEW");
            assert.equal(bandMin, "REVIEW");
            assert.equal(bandMax, "REVIEW");
            assert.equal(CONFIDENCE_THRESHOLDS.REVIEW_MIN, 65);
        });

        it("assigns BLOCKED band for scores < 65 (execution forbidden)", () => {
            const band = service.calculateBand(64, false, true);
            assert.equal(band, "BLOCKED");
            assert.equal(CONFIDENCE_THRESHOLDS.BLOCKED_MAX, 64);
        });
    });

    describe("Critical Semantic Findings & Security Guardrail Overrides (AC-US12-4)", () => {
        it("unconditionally forces band to BLOCKED if query contains any CRITICAL semantic finding", () => {
            const criticalSemanticResult: SemanticValidationResult = {
                isValid: false,
                criticalCount: 1,
                warningCount: 0,
                infoCount: 0,
                hasRepairableFindings: true,
                summary: "Critical semantic violation",
                intentSlots: sampleIntent,
                findings: [
                    {
                        code: "UNHANDLED_ORDER_STATUS",
                        severity: "CRITICAL",
                        message: "Revenue requires completed orders",
                        repairable: true,
                    },
                ],
            };

            const result = service.computeConfidence({
                semanticResult: criticalSemanticResult,
                verifierResult: cleanVerifierResult,
                stabilityResult: cleanStabilityResult,
            });

            // Even though verifier and stability scored high, critical finding forces BLOCKED
            assert.equal(result.band, "BLOCKED");
            assert.equal(result.hasCriticalFindings, true);
            assert.equal(result.executionEligible, false);
            assert.equal(result.requiresAcknowledgement, false);
            assert.ok(result.decisionExplanation.includes("critical semantic violations"));
        });

        it("unconditionally forces band to BLOCKED if security guardrails fail regardless of high confidence score", () => {
            const failedGuardrails: GuardrailValidationResult = {
                valid: false,
                status: "rejected",
                sql: "DROP TABLE customers;",
                findings: [
                    {
                        code: "FORBIDDEN_SQL_STATEMENT",
                        severity: "CRITICAL",
                        message: "Only SELECT statements permitted",
                    },
                ],
                violations: [
                    {
                        code: "FORBIDDEN_SQL_STATEMENT",
                        severity: "CRITICAL",
                        message: "Only SELECT statements permitted",
                    },
                ],
            };

            const result = service.computeConfidence({
                semanticResult: cleanSemanticResult,
                verifierResult: cleanVerifierResult,
                stabilityResult: cleanStabilityResult,
                guardrailResult: failedGuardrails,
            });

            // Subordination to security guardrails (AC-US12-4)
            assert.equal(result.band, "BLOCKED");
            assert.equal(result.executionEligible, false);
            assert.equal(result.requiresAcknowledgement, false);
            assert.ok(result.decisionExplanation.includes("security guardrails"));
            assert.ok(result.decisionExplanation.includes("Only SELECT statements permitted"));
        });
    });

    describe("Deterministic AST Fallback for Verifier Consensus", () => {
        it("uses deterministic AST verifier fallback when verifierResult is omitted", () => {
            const result = service.computeConfidence({
                semanticResult: cleanSemanticResult,
                // verifierResult omitted -> fallback to calculateVerifierAgreementRatio
                stabilityResult: cleanStabilityResult,
            });

            assert.equal(result.breakdown.verifierAgreement.available, true);
            assert.equal(result.breakdown.verifierAgreement.score, 1.0);
            assert.equal(result.breakdown.verifierAgreement.weightedContribution, 20);
            assert.ok(result.breakdown.verifierAgreement.evidenceSummary.includes("Deterministic AST verifier"));
        });
    });
});

