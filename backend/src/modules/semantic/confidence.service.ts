import {
    type ConfidenceScoreResult,
    type ConfidenceBand,
    type ConfidenceScoreBreakdown,
    type ConfidenceComponentEvidence,
    ConfidenceScoreResultSchema,
    CONFIDENCE_THRESHOLDS,
    CONFIDENCE_WEIGHTS,
    type SemanticValidationResult,
    type GuardrailValidationResult,
} from "@text2sql/contracts";
import type { VerifierResult, CandidateStabilityResult } from "./candidate-verifier.service.js";
import { SemanticValidatorService } from "./semantic-validator.service.js";

export interface ComputeConfidenceOptions {
    semanticResult: SemanticValidationResult;
    verifierResult?: VerifierResult;
    stabilityResult?: CandidateStabilityResult;
    guardrailResult?: GuardrailValidationResult;
    allowDeterministicVerifierFallback?: boolean;
}

export class ConfidenceService {
    private readonly semanticValidator: SemanticValidatorService;

    constructor(semanticValidator?: SemanticValidatorService) {
        this.semanticValidator = semanticValidator ?? new SemanticValidatorService();
    }

    /**
     * Computes deterministic, transparent 0–100 confidence score based on 4 weighted components:
     * 1. 35% Intent-Slot Agreement
     * 2. 30% Glossary & Join Evidence
     * 3. 20% Verifier Consensus
     * 4. 15% Candidate Stability
     *
     * Explicitly enforces:
     * - Unavailable components contribute 0 points and are marked available: false (never silently renormalized).
     * - Security override: if guardrails fail, band is unconditionally forced to BLOCKED.
     * - Critical findings override: if critical semantic findings exist, band is forced to BLOCKED.
     * - Decision bands: HIGH (>=85), REVIEW (65-84), BLOCKED (<65).
     */
    public computeConfidence(options: ComputeConfidenceOptions): ConfidenceScoreResult {
        const { semanticResult, verifierResult, stabilityResult, guardrailResult } = options;
        const allowDeterministicFallback = options.allowDeterministicVerifierFallback ?? true;

        const hasCriticalFindings =
            semanticResult.criticalCount > 0 || !semanticResult.isValid;
        const guardrailsValid = guardrailResult ? guardrailResult.valid : true;

        // -------------------------------------------------------------
        // Component 1: Intent-Slot Agreement (Weight: 35%)
        // -------------------------------------------------------------
        const intentAgreementScore = this.semanticValidator.calculateIntentSlotAgreementRatio(
            semanticResult.intentSlots,
            semanticResult.findings
        );
        const intentWeightedContrib = Math.round(
            intentAgreementScore * CONFIDENCE_WEIGHTS.INTENT_SLOT_AGREEMENT * 100 * 100
        ) / 100;

        const intentSlotEvidence: ConfidenceComponentEvidence = {
            name: "Intent-Slot Agreement",
            weight: CONFIDENCE_WEIGHTS.INTENT_SLOT_AGREEMENT,
            score: Math.round(intentAgreementScore * 100) / 100,
            weightedContribution: intentWeightedContrib,
            available: true,
            evidenceSummary:
                intentAgreementScore === 1.0
                    ? "Full alignment: all metric, dimension, filter, and temporal intent slots represented."
                    : `${Math.round(intentAgreementScore * 100)}% of intent slots satisfied by query AST structure.`,
        };

        // -------------------------------------------------------------
        // Component 2: Glossary & Join Evidence (Weight: 30%)
        // -------------------------------------------------------------
        const glossaryScore = this.semanticValidator.calculateGlossaryEvidenceRatio(
            semanticResult.findings
        );
        const glossaryWeightedContrib = Math.round(
            glossaryScore * CONFIDENCE_WEIGHTS.GLOSSARY_JOIN_EVIDENCE * 100 * 100
        ) / 100;

        let glossarySummary: string;
        if (glossaryScore === 1.0) {
            glossarySummary = "Conforms to business glossary metric definitions, join paths, and row-level cardinalities.";
        } else if (glossaryScore === 0.5) {
            glossarySummary = "Advisory findings detected on glossary formula or potential join fanout.";
        } else {
            glossarySummary = "Critical glossary formula mismatch or Cartesian fanout risk detected.";
        }

        const glossaryEvidence: ConfidenceComponentEvidence = {
            name: "Glossary & Join Evidence",
            weight: CONFIDENCE_WEIGHTS.GLOSSARY_JOIN_EVIDENCE,
            score: Math.round(glossaryScore * 100) / 100,
            weightedContribution: glossaryWeightedContrib,
            available: true,
            evidenceSummary: glossarySummary,
        };

        // -------------------------------------------------------------
        // Component 3: Verifier Agreement (Weight: 20%)
        // -------------------------------------------------------------
        let verifierEvidence: ConfidenceComponentEvidence;
        if (verifierResult) {
            if (verifierResult.available) {
                const vScore = Math.max(0, Math.min(1, verifierResult.score));
                const vContrib = Math.round(
                    vScore * CONFIDENCE_WEIGHTS.VERIFIER_AGREEMENT * 100 * 100
                ) / 100;
                verifierEvidence = {
                    name: "Verifier Consensus",
                    weight: CONFIDENCE_WEIGHTS.VERIFIER_AGREEMENT,
                    score: Math.round(vScore * 100) / 100,
                    weightedContribution: vContrib,
                    available: true,
                    evidenceSummary: verifierResult.evidenceSummary || "Verifier consensus evaluated.",
                };
            } else {
                // Verifier explicitly unavailable (e.g. timeout or budget limit)
                verifierEvidence = {
                    name: "Verifier Consensus",
                    weight: CONFIDENCE_WEIGHTS.VERIFIER_AGREEMENT,
                    score: 0.0,
                    weightedContribution: 0.0,
                    available: false,
                    reasonUnavailable: verifierResult.reasonUnavailable || "Verifier evaluation unavailable or timed out.",
                    evidenceSummary: "Verifier consensus unavailable (contributes 0 to score; explicitly marked).",
                };
            }
        } else if (allowDeterministicFallback) {
            // Deterministic AST verifier fallback
            const detScore = this.semanticValidator.calculateVerifierAgreementRatio(
                semanticResult.findings
            );
            const detContrib = Math.round(
                detScore * CONFIDENCE_WEIGHTS.VERIFIER_AGREEMENT * 100 * 100
            ) / 100;
            verifierEvidence = {
                name: "Verifier Consensus",
                weight: CONFIDENCE_WEIGHTS.VERIFIER_AGREEMENT,
                score: Math.round(detScore * 100) / 100,
                weightedContribution: detContrib,
                available: true,
                evidenceSummary:
                    detScore === 1.0
                        ? "Deterministic AST verifier confirmed semantic consistency."
                        : "Deterministic AST verifier identified semantic findings.",
            };
        } else {
            verifierEvidence = {
                name: "Verifier Consensus",
                weight: CONFIDENCE_WEIGHTS.VERIFIER_AGREEMENT,
                score: 0.0,
                weightedContribution: 0.0,
                available: false,
                reasonUnavailable: "Verifier evaluation was not performed.",
                evidenceSummary: "Verifier consensus evidence not available (contributes 0 to score).",
            };
        }

        // -------------------------------------------------------------
        // Component 4: Candidate Stability (Weight: 15%)
        // -------------------------------------------------------------
        let stabilityEvidence: ConfidenceComponentEvidence;
        if (stabilityResult && stabilityResult.available) {
            const sScore = Math.max(0, Math.min(1, stabilityResult.score));
            const sContrib = Math.round(
                sScore * CONFIDENCE_WEIGHTS.CANDIDATE_STABILITY * 100 * 100
            ) / 100;
            stabilityEvidence = {
                name: "Candidate Stability",
                weight: CONFIDENCE_WEIGHTS.CANDIDATE_STABILITY,
                score: Math.round(sScore * 100) / 100,
                weightedContribution: sContrib,
                available: true,
                evidenceSummary: stabilityResult.evidenceSummary || "Candidate stability evaluated.",
            };
        } else {
            stabilityEvidence = {
                name: "Candidate Stability",
                weight: CONFIDENCE_WEIGHTS.CANDIDATE_STABILITY,
                score: 0.0,
                weightedContribution: 0.0,
                available: false,
                reasonUnavailable:
                    stabilityResult?.reasonUnavailable ||
                    "Candidate stability analysis disabled, timed out, or skipped under current latency profile.",
                evidenceSummary:
                    "Candidate stability evidence not available (contributes 0 to score; explicitly marked).",
            };
        }

        const breakdown: ConfidenceScoreBreakdown = {
            intentSlotAgreement: intentSlotEvidence,
            glossaryAndJoinEvidence: glossaryEvidence,
            verifierAgreement: verifierEvidence,
            candidateStability: stabilityEvidence,
        };

        // -------------------------------------------------------------
        // Total Score Computation (0 - 100 integer)
        // -------------------------------------------------------------
        const rawTotalScore =
            intentSlotEvidence.weightedContribution +
            glossaryEvidence.weightedContribution +
            verifierEvidence.weightedContribution +
            stabilityEvidence.weightedContribution;

        const score = Math.max(0, Math.min(100, Math.round(rawTotalScore)));

        // -------------------------------------------------------------
        // Decision Band & Policy Enforcement
        // -------------------------------------------------------------
        const band = this.calculateBand(score, hasCriticalFindings, guardrailsValid);

        const executionEligible = band !== "BLOCKED" && guardrailsValid && !hasCriticalFindings;
        const requiresAcknowledgement = band === "REVIEW";

        const guardrailViolations = guardrailResult?.violations.map((v) => v.message);
        const decisionExplanation = this.buildDecisionExplanation(
            score,
            band,
            hasCriticalFindings,
            guardrailViolations
        );

        const result: ConfidenceScoreResult = {
            score,
            band,
            breakdown,
            isHeuristic: true,
            heuristicDisclaimer:
                "Heuristic confidence score based on deterministic AST rules, glossary formulas, and verifier evidence. Not an empirical statistical probability.",
            decisionExplanation,
            executionEligible,
            requiresAcknowledgement,
            hasCriticalFindings,
        };

        return ConfidenceScoreResultSchema.parse(result);
    }

    /**
     * Determines decision band respecting critical semantic violations and security guardrail overrides.
     */
    public calculateBand(
        score: number,
        hasCriticalFindings: boolean,
        guardrailsValid: boolean
    ): ConfidenceBand {
        // Security override: Guardrails failure unconditionally forces BLOCKED
        if (!guardrailsValid) {
            return "BLOCKED";
        }

        // Critical findings override: Any critical semantic violation unconditionally forces BLOCKED
        if (hasCriticalFindings) {
            return "BLOCKED";
        }

        if (score >= CONFIDENCE_THRESHOLDS.HIGH_MIN) {
            return "HIGH";
        }

        if (score >= CONFIDENCE_THRESHOLDS.REVIEW_MIN) {
            return "REVIEW";
        }

        return "BLOCKED";
    }

    /**
     * Generates transparent, actionable analyst explanations for the confidence band decision.
     */
    public buildDecisionExplanation(
        score: number,
        band: ConfidenceBand,
        hasCriticalFindings: boolean,
        guardrailViolations?: string[]
    ): string {
        if (guardrailViolations && guardrailViolations.length > 0) {
            return `Execution blocked by security guardrails: ${guardrailViolations.join("; ")}.`;
        }

        if (hasCriticalFindings) {
            return "Execution blocked: Query contains critical semantic violations. Manual question refinement required.";
        }

        switch (band) {
            case "HIGH":
                return `High heuristic confidence (${score}/100). Query conforms to intent slots and business rules; eligible for execution.`;
            case "REVIEW":
                return `Review band (${score}/100). Query is executable but requires explicit acknowledgement of warnings before execution.`;
            case "BLOCKED":
                return `Execution blocked: Heuristic confidence (${score}/100) is below the minimum threshold (${CONFIDENCE_THRESHOLDS.REVIEW_MIN}). Please refine or clarify your question.`;
        }
    }
}

