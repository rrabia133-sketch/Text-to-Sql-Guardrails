import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    AggregationTypeSchema,
    IntentSlotsSchema,
    SemanticViolationCodeSchema,
    SemanticSeveritySchema,
    SemanticFindingSchema,
    SemanticValidationResultSchema,
    SemanticRepairAttemptSchema,
    ConfidenceBandSchema,
    CONFIDENCE_THRESHOLDS,
    CONFIDENCE_WEIGHTS,
    ConfidenceComponentEvidenceSchema,
    ConfidenceScoreBreakdownSchema,
    ConfidenceScoreResultSchema,
    ReviewAcknowledgementSchema,
    ExecuteQueryRequestSchema,
    QueryGenerationResponseSchema,
    ExecutionErrorCodeSchema,
    type IntentSlots,
    type SemanticFinding,
    type ConfidenceScoreResult,
} from "@text2sql/contracts";

describe("Sprint 5 - Task 1: Semantic Validation & Confidence Contracts", () => {
    describe("Intent Slots Schemas", () => {
        it("validates all AggregationType enum values", () => {
            const types = ["SUM", "AVG", "COUNT", "COUNT_DISTINCT", "MIN", "MAX", "NONE"];
            for (const t of types) {
                assert.equal(AggregationTypeSchema.parse(t), t);
            }
            assert.throws(() => AggregationTypeSchema.parse("MEDIAN"));
        });

        it("validates structured IntentSlots with defaults", () => {
            const rawSlots = {
                rawQuestion: "What is the total revenue for completed orders last month?",
                metric: "revenue",
                aggregation: "SUM",
                dimensions: ["orders.status"],
                filters: [
                    {
                        column: "orders.status",
                        operator: "=",
                        value: "completed",
                    },
                ],
                temporal: {
                    startDate: "2024-09-01T00:00:00Z",
                    endDate: "2024-09-30T23:59:59Z",
                    timezone: "UTC",
                    grain: "month",
                    rawExpression: "last month",
                },
                sort: {
                    column: "orders.created_at",
                    direction: "DESC",
                },
                rowLimit: 50,
            };

            const parsed: IntentSlots = IntentSlotsSchema.parse(rawSlots);
            assert.equal(parsed.metric, "revenue");
            assert.equal(parsed.aggregation, "SUM");
            assert.equal(parsed.dimensions.length, 1);
            assert.equal(parsed.filters.length, 1);
            assert.equal(parsed.filters[0].operator, "=");
            assert.equal(parsed.temporal?.grain, "month");
            assert.equal(parsed.rowLimit, 50);
        });

        it("rejects IntentSlots without rawQuestion", () => {
            assert.throws(() => IntentSlotsSchema.parse({}));
        });
    });

    describe("Semantic Violation Codes & Finding Schemas", () => {
        it("validates approved SemanticViolationCodes", () => {
            const approved = [
                "WRONG_AGGREGATION",
                "MISSING_DATE_FILTER",
                "INVALID_DATE_BOUNDS",
                "UNHANDLED_ORDER_STATUS",
                "JOIN_FANOUT_DUPLICATION",
                "UNRESOLVED_INTENT_SLOT",
                "GLOSSARY_FORMULA_MISMATCH",
                "AMBIGUOUS_GRAIN",
                "UNBOUNDED_GROUPING",
            ];
            for (const code of approved) {
                assert.equal(SemanticViolationCodeSchema.parse(code), code);
            }
            assert.throws(() => SemanticViolationCodeSchema.parse("UNKNOWN_VIOLATION"));
        });

        it("validates SemanticSeverity levels", () => {
            assert.equal(SemanticSeveritySchema.parse("CRITICAL"), "CRITICAL");
            assert.equal(SemanticSeveritySchema.parse("WARNING"), "WARNING");
            assert.equal(SemanticSeveritySchema.parse("INFO"), "INFO");
            assert.throws(() => SemanticSeveritySchema.parse("FATAL"));
        });

        it("validates SemanticFinding schema with repairable flag", () => {
            const finding: SemanticFinding = {
                code: "UNHANDLED_ORDER_STATUS",
                severity: "CRITICAL",
                message: "Revenue calculation must filter completed orders (orders.status = 'completed')",
                field: "orders.status",
                expected: "completed",
                actual: "none",
                repairable: true,
                suggestion: "Add WHERE orders.status = 'completed'",
            };

            const parsed = SemanticFindingSchema.parse(finding);
            assert.equal(parsed.code, "UNHANDLED_ORDER_STATUS");
            assert.equal(parsed.severity, "CRITICAL");
            assert.equal(parsed.repairable, true);
        });

        it("validates SemanticValidationResult aggregation", () => {
            const result = SemanticValidationResultSchema.parse({
                isValid: false,
                criticalCount: 1,
                warningCount: 1,
                infoCount: 0,
                hasRepairableFindings: true,
                summary: "1 critical mismatch found",
                intentSlots: {
                    rawQuestion: "Sales per product",
                },
                findings: [
                    {
                        code: "WRONG_AGGREGATION",
                        severity: "CRITICAL",
                        message: "Expected SUM on quantity * unit_price",
                        repairable: true,
                    },
                    {
                        code: "AMBIGUOUS_GRAIN",
                        severity: "WARNING",
                        message: "Granularity should be grouped by product_id",
                        repairable: false,
                    },
                ],
            });

            assert.equal(result.isValid, false);
            assert.equal(result.criticalCount, 1);
            assert.equal(result.findings.length, 2);
        });

        it("validates SemanticRepairAttempt schema", () => {
            const attempt = SemanticRepairAttemptSchema.parse({
                attemptNumber: 1,
                originalSql: "SELECT SUM(price) FROM products",
                repairedSql: "SELECT SUM(order_items.quantity * order_items.unit_price) FROM order_items",
                resolvedCodes: ["GLOSSARY_FORMULA_MISMATCH"],
                remainingFindings: [],
                success: true,
            });

            assert.equal(attempt.attemptNumber, 1);
            assert.equal(attempt.success, true);
            assert.equal(attempt.resolvedCodes[0], "GLOSSARY_FORMULA_MISMATCH");

            // Rejects attemptNumber > 1 (bounded to max 1 attempt)
            assert.throws(() =>
                SemanticRepairAttemptSchema.parse({
                    ...attempt,
                    attemptNumber: 2,
                })
            );
        });
    });

    describe("Confidence Scoring & Decision Bands Schemas", () => {
        it("validates ConfidenceBand values", () => {
            assert.equal(ConfidenceBandSchema.parse("HIGH"), "HIGH");
            assert.equal(ConfidenceBandSchema.parse("REVIEW"), "REVIEW");
            assert.equal(ConfidenceBandSchema.parse("BLOCKED"), "BLOCKED");
            assert.throws(() => ConfidenceBandSchema.parse("LOW"));
        });

        it("verifies confidence thresholds and weights constants", () => {
            assert.equal(CONFIDENCE_THRESHOLDS.HIGH_MIN, 85);
            assert.equal(CONFIDENCE_THRESHOLDS.REVIEW_MIN, 65);
            assert.equal(CONFIDENCE_THRESHOLDS.BLOCKED_MAX, 64);

            const weightSum =
                CONFIDENCE_WEIGHTS.INTENT_SLOT_AGREEMENT +
                CONFIDENCE_WEIGHTS.GLOSSARY_JOIN_EVIDENCE +
                CONFIDENCE_WEIGHTS.VERIFIER_AGREEMENT +
                CONFIDENCE_WEIGHTS.CANDIDATE_STABILITY;

            assert.ok(Math.abs(weightSum - 1.0) < 0.0001, "Weights must sum to 1.0");
        });

        it("validates ConfidenceComponentEvidence with available and unavailable states", () => {
            const availableComponent = ConfidenceComponentEvidenceSchema.parse({
                name: "intentSlotAgreement",
                weight: 0.35,
                score: 1.0,
                weightedContribution: 35.0,
                available: true,
                evidenceSummary: "All 5 intent slots matched AST",
            });
            assert.equal(availableComponent.weightedContribution, 35.0);

            const unavailableComponent = ConfidenceComponentEvidenceSchema.parse({
                name: "candidateStability",
                weight: 0.15,
                score: 0.0,
                weightedContribution: 0.0,
                available: false,
                reasonUnavailable: "Secondary candidate generation timed out",
                evidenceSummary: "Component unavailable; contributes 0%",
            });
            assert.equal(unavailableComponent.available, false);
            assert.equal(unavailableComponent.weightedContribution, 0.0);
        });

        it("validates complete ConfidenceScoreResult", () => {
            const result: ConfidenceScoreResult = {
                score: 88,
                band: "HIGH",
                breakdown: {
                    intentSlotAgreement: {
                        name: "intentSlotAgreement",
                        weight: 0.35,
                        score: 0.95,
                        weightedContribution: 33.25,
                        available: true,
                        evidenceSummary: "Intent slots matched",
                    },
                    glossaryAndJoinEvidence: {
                        name: "glossaryAndJoinEvidence",
                        weight: 0.30,
                        score: 0.90,
                        weightedContribution: 27.0,
                        available: true,
                        evidenceSummary: "Glossary adherence confirmed",
                    },
                    verifierAgreement: {
                        name: "verifierAgreement",
                        weight: 0.20,
                        score: 0.85,
                        weightedContribution: 17.0,
                        available: true,
                        evidenceSummary: "Verifier agreement high",
                    },
                    candidateStability: {
                        name: "candidateStability",
                        weight: 0.15,
                        score: 0.70,
                        weightedContribution: 10.5,
                        available: true,
                        evidenceSummary: "Candidates agree on joins",
                    },
                },
                isHeuristic: true,
                heuristicDisclaimer:
                    "Heuristic confidence score based on deterministic AST rules, glossary formulas, and verifier evidence. Not an empirical statistical probability.",
                decisionExplanation: "High confidence query meeting all validation criteria.",
                executionEligible: true,
                requiresAcknowledgement: false,
                hasCriticalFindings: false,
            };

            const parsed = ConfidenceScoreResultSchema.parse(result);
            assert.equal(parsed.score, 88);
            assert.equal(parsed.band, "HIGH");
            assert.equal(parsed.isHeuristic, true);
            assert.equal(parsed.executionEligible, true);
        });
    });

    describe("Review Acknowledgement & Execution Integration", () => {
        it("validates ReviewAcknowledgement schema", () => {
            const valid = ReviewAcknowledgementSchema.parse({
                confirmed: true,
                reviewedWarnings: ["Missing optional date bounds", "High row volume"],
                analystNote: "Confirmed with business team",
            });
            assert.equal(valid.confirmed, true);
            assert.equal(valid.reviewedWarnings.length, 2);

            // Rejects confirmed: false
            assert.throws(() =>
                ReviewAcknowledgementSchema.parse({
                    confirmed: false,
                })
            );
        });

        it("validates ExecuteQueryRequestSchema with optional acknowledgement", () => {
            const reqWithoutAck = ExecuteQueryRequestSchema.parse({
                artifactId: "art-123",
            });
            assert.equal(reqWithoutAck.artifactId, "art-123");
            assert.equal(reqWithoutAck.acknowledgement, undefined);

            const reqWithAck = ExecuteQueryRequestSchema.parse({
                artifactId: "art-123",
                acknowledgement: {
                    confirmed: true,
                    reviewedWarnings: ["Warning 1"],
                },
            });
            assert.equal(reqWithAck.acknowledgement?.confirmed, true);
        });

        it("validates new ExecutionErrorCodes for semantic and confidence boundaries", () => {
            const codes = [
                "REVIEW_ACKNOWLEDGEMENT_REQUIRED",
                "SEMANTIC_VALIDATION_FAILED",
                "BLOCKED_CONFIDENCE_BAND",
            ];
            for (const c of codes) {
                assert.equal(ExecutionErrorCodeSchema.parse(c), c);
            }
        });

        it("validates QueryGenerationResponseSchema with Sprint 5 confidence and semantic fields", () => {
            const response = QueryGenerationResponseSchema.parse({
                type: "generation",
                artifactId: "art-456",
                status: "preview_ready",
                sql: "SELECT * FROM customers LIMIT 50",
                assumptions: ["Assumed all active customers"],
                referencedTables: ["customers"],
                referencedColumns: ["id", "name"],
                explanation: "Lists top customers",
                confidencePreview: 0.9,
                confidenceScore: 92,
                confidenceBand: "HIGH",
                provider: "ollama",
                model: "qwen2.5-coder:7b",
                versions: {
                    promptVersion: "1.0.0",
                    schemaVersion: "1.0.0",
                    glossaryVersion: "1.0.0",
                },
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            });

            assert.equal(response.status, "preview_ready");
            assert.equal(response.confidenceScore, 92);
            assert.equal(response.confidenceBand, "HIGH");
        });
    });
});
