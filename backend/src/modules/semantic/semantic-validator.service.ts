import {
    type IntentSlots,
    type SemanticFinding,
    type SemanticValidationResult,
    SemanticValidationResultSchema,
} from "@text2sql/contracts";
import { MetricVerifier } from "./metric-verifier.js";
import { FilterVerifier } from "./filter-verifier.js";
import { CardinalityVerifier } from "./cardinality-verifier.js";
import { GlossaryVerifier } from "./glossary-verifier.js";

export class SemanticValidatorService {
    private readonly metricVerifier: MetricVerifier;
    private readonly filterVerifier: FilterVerifier;
    private readonly cardinalityVerifier: CardinalityVerifier;
    private readonly glossaryVerifier: GlossaryVerifier;

    constructor(options?: {
        metricVerifier?: MetricVerifier;
        filterVerifier?: FilterVerifier;
        cardinalityVerifier?: CardinalityVerifier;
        glossaryVerifier?: GlossaryVerifier;
    }) {
        this.metricVerifier = options?.metricVerifier ?? new MetricVerifier();
        this.filterVerifier = options?.filterVerifier ?? new FilterVerifier();
        this.cardinalityVerifier = options?.cardinalityVerifier ?? new CardinalityVerifier();
        this.glossaryVerifier = options?.glossaryVerifier ?? new GlossaryVerifier();
    }

    /**
     * Executes all deterministic semantic verifiers against the query AST and intent slots.
     * @param ast The parsed SQL AST (SelectStatement / WithStatement)
     * @param intent The structured intent slots extracted from the user question
     * @returns Consolidated SemanticValidationResult
     */
    public validate(ast: any, intent: IntentSlots): SemanticValidationResult {
        const checkedRules: string[] = [
            "metric_aggregation",
            "filter_status_temporal",
            "join_cardinality_fanout",
            "glossary_formula",
        ];

        const findings: SemanticFinding[] = [];

        // 1. Metric Definition & Aggregation
        const metricResult = this.metricVerifier.verify(ast, intent);
        findings.push(...metricResult.findings);

        // 2. Filter, Status & Temporal Boundaries
        const filterResult = this.filterVerifier.verify(ast, intent);
        findings.push(...filterResult.findings);

        // 3. Join Cardinality & Fanout Duplication
        const cardinalityResult = this.cardinalityVerifier.verify(ast, intent);
        findings.push(...cardinalityResult.findings);

        // 4. Business Glossary & Formula Alignment
        const glossaryResult = this.glossaryVerifier.verify(ast, intent);
        findings.push(...glossaryResult.findings);

        // 5. Aggregate metrics & determine validity
        const criticalCount = findings.filter((f) => f.severity === "CRITICAL").length;
        const warningCount = findings.filter((f) => f.severity === "WARNING").length;
        const infoCount = findings.filter((f) => f.severity === "INFO").length;
        const isValid = criticalCount === 0;

        const hasRepairableFindings = findings.some((f) => f.repairable);

        const summary = isValid
            ? (warningCount > 0
                ? `Semantically valid with ${warningCount} advisory warning(s).`
                : "Semantically valid: matches intent slots, glossary rules, and schema cardinalities.")
            : `Semantic validation failed with ${criticalCount} critical violation(s)${warningCount > 0 ? ` and ${warningCount} warning(s)` : ""}.`;

        const result: SemanticValidationResult = {
            isValid,
            findings,
            intentSlots: intent,
            criticalCount,
            warningCount,
            infoCount,
            hasRepairableFindings,
            summary,
        };

        // Assert schema compliance
        return SemanticValidationResultSchema.parse(result);
    }

    /**
     * Computes the ratio (0.0 to 1.0) of user intent slots that are satisfied by the query.
     */
    public calculateIntentSlotAgreementRatio(intent: IntentSlots, findings: SemanticFinding[]): number {
        let totalSlots = 1; // Metric is always an intent slot
        if (intent.dimensions.length > 0) totalSlots += intent.dimensions.length;
        if (intent.filters.length > 0) totalSlots += intent.filters.length;
        if (intent.temporal) totalSlots += 1;

        const slotViolationCodes = new Set([
            "WRONG_AGGREGATION",
            "MISSING_DATE_FILTER",
            "INVALID_DATE_BOUNDS",
            "UNRESOLVED_INTENT_SLOT",
            "UNHANDLED_ORDER_STATUS",
        ]);

        const violatedCount = findings.filter((f) => slotViolationCodes.has(f.code)).length;
        return Math.max(0, Math.min(1, (totalSlots - violatedCount) / totalSlots));
    }

    /**
     * Computes the glossary and join evidence ratio (0.0 to 1.0).
     */
    public calculateGlossaryEvidenceRatio(findings: SemanticFinding[]): number {
        const glossaryViolationCodes = new Set([
            "GLOSSARY_FORMULA_MISMATCH",
            "JOIN_FANOUT_DUPLICATION",
            "UNHANDLED_ORDER_STATUS",
        ]);

        const violations = findings.filter((f) => glossaryViolationCodes.has(f.code));
        if (violations.some((v) => v.severity === "CRITICAL")) return 0.0;
        if (violations.length > 0) return 0.5;
        return 1.0;
    }

    /**
     * Computes the verifier consensus agreement ratio (0.0 to 1.0).
     */
    public calculateVerifierAgreementRatio(findings: SemanticFinding[]): number {
        const hasCritical = findings.some((f) => f.severity === "CRITICAL");
        if (hasCritical) return 0.0;
        const hasWarning = findings.some((f) => f.severity === "WARNING");
        if (hasWarning) return 0.75;
        return 1.0;
    }
}
