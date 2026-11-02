import type { SemanticFinding } from "@text2sql/contracts";

export interface SemanticFindingsListProps {
    findings: SemanticFinding[];
}

export function SemanticFindingsList({ findings }: SemanticFindingsListProps) {
    if (!findings || findings.length === 0) {
        return (
            <div className="semantic-findings-empty" role="status">
                <span className="semantic-empty-icon">✓</span>
                <span>No semantic mismatches or cardinality warnings detected.</span>
            </div>
        );
    }

    const severityOrder: Record<SemanticFinding["severity"], number> = {
        CRITICAL: 0,
        WARNING: 1,
        INFO: 2,
    };

    const sortedFindings = [...findings].sort(
        (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
    );

    return (
        <div className="semantic-findings-container" aria-label="Semantic validation findings">
            <h4 className="semantic-findings-heading">
                Semantic Validation Findings ({findings.length})
            </h4>
            <ul className="semantic-findings-list">
                {sortedFindings.map((finding, idx) => {
                    const severityClass = finding.severity.toLowerCase();
                    return (
                        <li
                            key={`${finding.code}-${idx}`}
                            className={`semantic-finding-item severity-${severityClass}`}
                        >
                            <div className="semantic-finding-header">
                                <span
                                    className={`semantic-severity-badge badge-${severityClass}`}
                                >
                                    {finding.severity}
                                </span>
                                <code className="semantic-finding-code">{finding.code}</code>
                                {finding.field && (
                                    <span className="semantic-finding-field">
                                        Target: <code>{finding.field}</code>
                                    </span>
                                )}
                            </div>

                            <p className="semantic-finding-message">{finding.message}</p>

                            {(finding.expected || finding.actual) && (
                                <div className="semantic-finding-diff">
                                    {finding.expected && (
                                        <span className="diff-expected">
                                            Expected: <code>{finding.expected}</code>
                                        </span>
                                    )}
                                    {finding.actual && (
                                        <span className="diff-actual">
                                            Actual: <code>{finding.actual}</code>
                                        </span>
                                    )}
                                </div>
                            )}

                            {finding.suggestion && (
                                <div className="semantic-finding-suggestion">
                                    <strong>Remediation:</strong> {finding.suggestion}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

