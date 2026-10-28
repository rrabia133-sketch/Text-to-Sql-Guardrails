import { z } from "zod";

// ==========================================
// 1. Confidence Bands & Decision Classifications
// ==========================================

export const ConfidenceBandSchema = z.enum(["HIGH", "REVIEW", "BLOCKED"]);
export type ConfidenceBand = z.infer<typeof ConfidenceBandSchema>;

// Threshold Constants
export const CONFIDENCE_THRESHOLDS = {
    HIGH_MIN: 85,
    REVIEW_MIN: 65,
    BLOCKED_MAX: 64,
} as const;

// Component Weight Constants (Sum = 1.0)
export const CONFIDENCE_WEIGHTS = {
    INTENT_SLOT_AGREEMENT: 0.35,
    GLOSSARY_JOIN_EVIDENCE: 0.30,
    VERIFIER_AGREEMENT: 0.20,
    CANDIDATE_STABILITY: 0.15,
} as const;

// ==========================================
// 2. Component Evidence & Breakdown Schemas
// ==========================================

export const ConfidenceComponentEvidenceSchema = z.object({
    name: z.string().min(1),
    weight: z.number().min(0).max(1),
    score: z.number().min(0).max(1), // Normalized score (0.0 to 1.0)
    weightedContribution: z.number().min(0).max(100), // score * weight * 100
    available: z.boolean(),
    reasonUnavailable: z.string().optional(),
    evidenceSummary: z.string().min(1),
});
export type ConfidenceComponentEvidence = z.infer<typeof ConfidenceComponentEvidenceSchema>;

export const ConfidenceScoreBreakdownSchema = z.object({
    intentSlotAgreement: ConfidenceComponentEvidenceSchema,
    glossaryAndJoinEvidence: ConfidenceComponentEvidenceSchema,
    verifierAgreement: ConfidenceComponentEvidenceSchema,
    candidateStability: ConfidenceComponentEvidenceSchema,
});
export type ConfidenceScoreBreakdown = z.infer<typeof ConfidenceScoreBreakdownSchema>;

// ==========================================
// 3. Full Confidence Score Result Schema
// ==========================================

export const ConfidenceScoreResultSchema = z.object({
    score: z.number().min(0).max(100),
    band: ConfidenceBandSchema,
    breakdown: ConfidenceScoreBreakdownSchema,
    isHeuristic: z.literal(true).default(true),
    heuristicDisclaimer: z.string().default(
        "Heuristic confidence score based on deterministic AST rules, glossary formulas, and verifier evidence. Not an empirical statistical probability."
    ),
    decisionExplanation: z.string().min(1),
    executionEligible: z.boolean(),
    requiresAcknowledgement: z.boolean(),
    hasCriticalFindings: z.boolean().default(false),
});
export type ConfidenceScoreResult = z.infer<typeof ConfidenceScoreResultSchema>;

// ==========================================
// 4. Review Acknowledgement Contract (For Medium-Confidence Review Band)
// ==========================================

export const ReviewAcknowledgementSchema = z.object({
    confirmed: z.boolean().refine((val) => val === true, "Must confirm warning acknowledgement to proceed"),
    reviewedWarnings: z.array(z.string()).default([]),
    acknowledgedAt: z.string().optional(),
    analystNote: z.string().max(500).optional(),
});
export type ReviewAcknowledgement = z.infer<typeof ReviewAcknowledgementSchema>;
