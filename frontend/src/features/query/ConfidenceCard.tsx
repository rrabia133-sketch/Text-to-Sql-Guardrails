import { useState } from "react";
import type {
    ConfidenceBand,
    ConfidenceComponentEvidence,
    ConfidenceScoreBreakdown,
    SemanticFinding,
} from "@text2sql/contracts";
import { SemanticFindingsList } from "./SemanticFindingsList";
import "./ConfidenceCard.css";

export interface ConfidenceCardProps {
    score: number;
    band: ConfidenceBand;
    breakdown?: ConfidenceScoreBreakdown;
    findings?: SemanticFinding[];
}

interface ComponentRowConfig {
    key: keyof ConfidenceScoreBreakdown;
    label: string;
    weightPercent: number;
    evidence: ConfidenceComponentEvidence;
}

export function ConfidenceCard({
    score,
    band,
    breakdown,
    findings = [],
}: ConfidenceCardProps) {
    const [expanded, setExpanded] = useState(true);

    const normalizedBand = band.toUpperCase() as ConfidenceBand;
    const bandClass = normalizedBand.toLowerCase();

    const bandDescriptions: Record<ConfidenceBand, string> = {
        HIGH: "High semantic & structural agreement. Ready for immediate read-only execution.",
        REVIEW: "Medium confidence with advisory findings. Explicit analyst review & acknowledgement required before running.",
        BLOCKED: "Critical semantic or safety violations detected. Execution is strictly blocked.",
    };

    const rows: ComponentRowConfig[] = breakdown
        ? [
              {
                  key: "intentSlotAgreement",
                  label: "Intent Match",
                  weightPercent: 35,
                  evidence: breakdown.intentSlotAgreement,
              },
              {
                  key: "glossaryAndJoinEvidence",
                  label: "Glossary & Joins",
                  weightPercent: 30,
                  evidence: breakdown.glossaryAndJoinEvidence,
              },
              {
                  key: "verifierAgreement",
                  label: "Verifier Consensus",
                  weightPercent: 20,
                  evidence: breakdown.verifierAgreement,
              },
              {
                  key: "candidateStability",
                  label: "Candidate Stability",
                  weightPercent: 15,
                  evidence: breakdown.candidateStability,
              },
          ]
        : [];

    // Circular gauge parameters (radius 28 -> circumference ~ 175.9)
    const radius = 28;
    const circumference = 2 * Math.PI * radius;
    const clampedScore = Math.max(0, Math.min(100, score));
    const strokeDashoffset = circumference - (clampedScore / 100) * circumference;

    return (
        <div
            className={`confidence-card band-border-${bandClass}`}
            aria-label="Semantic confidence scorecard"
        >
            {/* Prominent Heuristic Disclaimer Banner */}
            <div className="heuristic-disclaimer-banner" role="note">
                <span className="disclaimer-icon" aria-hidden="true">
                    ℹ️
                </span>
                <span className="disclaimer-text">
                    Heuristic confidence score based on structural and semantic rules. Not a statistical probability.
                </span>
            </div>

            {/* Primary Score Header */}
            <div className="confidence-header">
                <div className="confidence-gauge-group">
                    <div className="confidence-gauge-wrapper" aria-hidden="true">
                        <svg className="confidence-gauge-svg" width="72" height="72" viewBox="0 0 72 72">
                            <circle
                                className="confidence-gauge-bg"
                                cx="36"
                                cy="36"
                                r={radius}
                                strokeWidth="6"
                            />
                            <circle
                                className={`confidence-gauge-fill gauge-${bandClass}`}
                                cx="36"
                                cy="36"
                                r={radius}
                                strokeWidth="6"
                                strokeDasharray={circumference}
                                strokeDashoffset={strokeDashoffset}
                            />
                        </svg>
                        <div className="confidence-gauge-value">
                            <span className="gauge-number">{clampedScore}</span>
                            <span className="gauge-max">/100</span>
                        </div>
                    </div>

                    <div className="confidence-summary">
                        <div className="confidence-title-row">
                            <h3 className="confidence-title">Explained Confidence Score</h3>
                            <span
                                className={`confidence-band-badge band-${bandClass}`}
                                data-testid="confidence-band-badge"
                            >
                                {normalizedBand}
                            </span>
                        </div>
                        <p className="confidence-band-desc">{bandDescriptions[normalizedBand]}</p>
                    </div>
                </div>

                {rows.length > 0 && (
                    <button
                        type="button"
                        className="confidence-toggle-btn"
                        onClick={() => setExpanded((prev) => !prev)}
                        aria-expanded={expanded}
                    >
                        {expanded ? "Hide Evidence ▲" : "Show Evidence ▼"}
                    </button>
                )}
            </div>

            {/* Expandable 4-Component Breakdown */}
            {expanded && rows.length > 0 && (
                <div className="confidence-breakdown-section">
                    <div className="breakdown-grid">
                        {rows.map(({ key, label, weightPercent, evidence }) => {
                            const pctScore = Math.round(evidence.score * 100);
                            const isUnavailable = !evidence.available;

                            return (
                                <div
                                    key={key}
                                    className={`breakdown-component-card ${
                                        isUnavailable ? "component-unavailable" : ""
                                    }`}
                                >
                                    <div className="component-header-row">
                                        <span className="component-name">
                                            {label}{" "}
                                            <span className="component-weight">
                                                ({weightPercent}%)
                                            </span>
                                        </span>

                                        {isUnavailable ? (
                                            <span
                                                className="unavailable-badge"
                                                title={
                                                    evidence.reasonUnavailable ||
                                                    "Component not computed within current latency/provider budget."
                                                }
                                            >
                                                UNAVAILABLE: 0%
                                            </span>
                                        ) : (
                                            <span className="component-score-pill">
                                                +{evidence.weightedContribution.toFixed(1)} pts ({pctScore}%)
                                            </span>
                                        )}
                                    </div>

                                    <div className="component-progress-track">
                                        <div
                                            className={`component-progress-bar ${
                                                isUnavailable
                                                    ? "bar-unavailable"
                                                    : pctScore >= 80
                                                    ? "bar-high"
                                                    : pctScore >= 50
                                                    ? "bar-review"
                                                    : "bar-blocked"
                                            }`}
                                            style={{ width: `${isUnavailable ? 0 : pctScore}%` }}
                                        />
                                    </div>

                                    <p className="component-evidence-text">
                                        {isUnavailable && evidence.reasonUnavailable
                                            ? evidence.reasonUnavailable
                                            : evidence.evidenceSummary}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Semantic Validation Findings List */}
            <SemanticFindingsList findings={findings} />
        </div>
    );
}

