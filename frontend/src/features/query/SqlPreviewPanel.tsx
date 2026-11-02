import { useState, useEffect } from "react";
import type {
    ConfidenceBand,
    QueryGenerationResponse,
    ExecutionResultResponse,
    ReviewAcknowledgement,
} from "@text2sql/contracts";
import { ConfidenceCard } from "./ConfidenceCard";
import { ReviewAcknowledgementModal } from "./ReviewAcknowledgementModal";

export interface SqlPreviewPanelProps {
    generationResponse: QueryGenerationResponse | null;
    loading: boolean;
}

export function SqlPreviewPanel({ generationResponse, loading }: SqlPreviewPanelProps) {
    const [copied, setCopied] = useState(false);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [executionError, setExecutionError] = useState<string | null>(null);
    const [executionResult, setExecutionResult] = useState<ExecutionResultResponse | null>(null);

    useEffect(() => {
        setIsReviewModalOpen(false);
        setExecuting(false);
        setExecutionError(null);
        setExecutionResult(null);
    }, [generationResponse?.artifactId]);

    const handleCopy = () => {
        if (!generationResponse?.sql) return;
        navigator.clipboard.writeText(generationResponse.sql);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const executeArtifact = async (acknowledgement?: ReviewAcknowledgement) => {
        if (!generationResponse) return;
        setExecuting(true);
        setExecutionError(null);

        try {
            const res = await fetch(
                `/api/v1/queries/${encodeURIComponent(generationResponse.artifactId)}/execute`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(
                        acknowledgement ? { acknowledgement } : {}
                    ),
                }
            );

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || `Execution refused (${res.status})`);
            }

            setExecutionResult(data);
            setIsReviewModalOpen(false);
        } catch (err: any) {
            setExecutionError(err?.message || "Query execution failed.");
        } finally {
            setExecuting(false);
        }
    };

    if (loading) {
        return (
            <section className="panel-card" id="sql-preview-section">
                <div className="panel-header">
                    <h2 className="panel-title">SQL Query Generation</h2>
                    <span className="brand-badge loading-badge">Compiling...</span>
                </div>
                <div className="panel-body loading-preview-body">
                    <div className="skeleton-line skeleton-title"></div>
                    <div className="skeleton-code-block"></div>
                    <div className="skeleton-line"></div>
                </div>
            </section>
        );
    }

    if (!generationResponse) {
        return (
            <section className="panel-card empty-preview-card" id="sql-preview-section">
                <div className="panel-header">
                    <h2 className="panel-title">Validated SQL & Generation Preview</h2>
                    <span className="brand-badge idle-badge">Idle</span>
                </div>
                <div className="panel-body empty-preview-content">
                    <div className="empty-preview-icon">🔍</div>
                    <h3 className="empty-preview-heading">No SQL Generated Yet</h3>
                    <p className="empty-preview-text">
                        Type an analytical question above and click <strong>Generate SQL Preview</strong> to compile schema-grounded PostgreSQL code.
                    </p>
                </div>
            </section>
        );
    }

    const normalizedBand: ConfidenceBand = (
        generationResponse.confidenceBand?.toUpperCase() ||
        (generationResponse.status === "preview_blocked"
            ? "BLOCKED"
            : generationResponse.status === "preview_review"
            ? "REVIEW"
            : "HIGH")
    ) as ConfidenceBand;

    const isBlocked =
        normalizedBand === "BLOCKED" ||
        generationResponse.status === "preview_blocked" ||
        generationResponse.status === "failed";

    const isReviewRequired =
        !isBlocked &&
        (normalizedBand === "REVIEW" || generationResponse.status === "preview_review");

    const handleRunClick = () => {
        if (isBlocked || executing) return;
        if (isReviewRequired) {
            setIsReviewModalOpen(true);
            return;
        }
        void executeArtifact();
    };

    const findings = generationResponse.semanticFindings || [];

    return (
        <section className="panel-card" id="sql-preview-section">
            <div className="panel-header">
                <div className="panel-title-group">
                    <h2 className="panel-title">Grounded SQL Preview</h2>
                    <span className="brand-badge preview-badge">
                        Status: {generationResponse.status.toUpperCase()}
                    </span>
                </div>
                <div className="header-meta-tags">
                    <span className="provider-tag">
                        {generationResponse.provider.toUpperCase()} ({generationResponse.model})
                    </span>
                    <button
                        type="button"
                        className="copy-btn"
                        onClick={handleCopy}
                        title="Copy SQL to clipboard"
                    >
                        {copied ? "✓ Copied" : "📋 Copy SQL"}
                    </button>

                    <button
                        type="button"
                        className={`run-query-btn ${
                            isBlocked
                                ? "run-btn-blocked"
                                : isReviewRequired
                                ? "run-btn-review"
                                : "run-btn-ready"
                        }`}
                        onClick={handleRunClick}
                        disabled={isBlocked || executing}
                        title={
                            isBlocked
                                ? "Execution blocked due to critical semantic or safety findings"
                                : isReviewRequired
                                ? "Review and acknowledge warnings before running query"
                                : "Execute read-only SQL query against analytics_db"
                        }
                    >
                        {executing
                            ? "Running..."
                            : isBlocked
                            ? "🚫 Execution Blocked"
                            : isReviewRequired
                            ? "⚠️ Review & Run Query"
                            : "▶ Run Query"}
                    </button>
                </div>
            </div>

            <div className="panel-body">
                {typeof generationResponse.confidenceScore === "number" && (
                    <ConfidenceCard
                        score={generationResponse.confidenceScore}
                        band={normalizedBand}
                        breakdown={generationResponse.confidenceBreakdown}
                        findings={findings}
                    />
                )}

                {/* Corrective Guidance Banner when Blocked */}
                {isBlocked && (
                    <div className="blocked-guidance-banner" role="alert">
                        <div className="banner-icon">🛑</div>
                        <div className="banner-text">
                            <strong>Execution Blocked — Critical Semantic or Guardrail Refusal</strong>
                            <p>
                                This query cannot be executed because one or more critical findings or low-confidence rules failed. Refine your question with specific metrics, filters, or date boundaries and regenerate.
                            </p>
                        </div>
                    </div>
                )}

                {executionError && (
                    <div className="blocked-guidance-banner" role="alert">
                        <div className="banner-icon">⚠️</div>
                        <div className="banner-text">
                            <strong>Execution Error</strong>
                            <p>{executionError}</p>
                        </div>
                    </div>
                )}

                {/* SQL Code Block */}
                <div className="code-block-wrapper">
                    <div className="code-header">
                        <span className="code-lang">PostgreSQL (SELECT only)</span>
                        <span className="schema-ver-badge">
                            Schema: {generationResponse.versions.schemaVersion}
                        </span>
                    </div>
                    <pre className="code-viewer">
                        <code>{generationResponse.sql}</code>
                    </pre>
                </div>

                {/* Execution Results Summary (when executed) */}
                {executionResult && (
                    <div className="execution-result-box" role="region" aria-label="Query results">
                        <div className="execution-result-header">
                            <h4 className="box-title">
                                Query Execution Results ({executionResult.rowCount} row
                                {executionResult.rowCount === 1 ? "" : "s"} in{" "}
                                {executionResult.executionTimeMs}ms)
                            </h4>
                            <span className="confidence-band-badge band-high">COMPLETED</span>
                        </div>
                        {executionResult.rows.length === 0 ? (
                            <p className="explanation-text">
                                Query executed cleanly and returned 0 matching rows.
                            </p>
                        ) : (
                            <div className="results-table-scroll">
                                <table className="results-table">
                                    <thead>
                                        <tr>
                                            {executionResult.columns.map((col) => (
                                                <th key={col.name}>{col.name}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {executionResult.rows.map((row, rIdx) => (
                                            <tr key={rIdx}>
                                                {executionResult.columns.map((col) => (
                                                    <td key={col.name}>
                                                        {row[col.name] === null ||
                                                        row[col.name] === undefined
                                                            ? "NULL"
                                                            : String(row[col.name])}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* Referenced Tables & Metadata */}
                <div className="metadata-grid">
                    <div className="metadata-item">
                        <span className="meta-label">Referenced Tables:</span>
                        <div className="tags-list">
                            {generationResponse.referencedTables.map((tbl, i) => (
                                <span key={i} className="table-badge">
                                    📁 {tbl}
                                </span>
                            ))}
                        </div>
                    </div>

                    {generationResponse.referencedColumns.length > 0 && (
                        <div className="metadata-item">
                            <span className="meta-label">Columns:</span>
                            <div className="tags-list">
                                {generationResponse.referencedColumns.map((col, i) => (
                                    <span key={i} className="column-badge">
                                        {col}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Model Assumptions */}
                {generationResponse.assumptions.length > 0 && (
                    <div className="assumptions-box">
                        <h4 className="box-title">Model Assumptions & Applied Filters</h4>
                        <ul className="assumptions-list">
                            {generationResponse.assumptions.map((item, idx) => (
                                <li key={idx}>{item}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Plain-English Explanation */}
                <div className="explanation-box">
                    <h4 className="box-title">Query Explanation</h4>
                    <p className="explanation-text">{generationResponse.explanation}</p>
                </div>

                {/* Version Registry Footer */}
                <div className="version-registry-bar">
                    <span>
                        Artifact ID: <code>{generationResponse.artifactId}</code>
                    </span>
                    <span>
                        Prompt: <code>v{generationResponse.versions.promptVersion}</code>
                    </span>
                    <span>
                        Glossary: <code>v{generationResponse.versions.glossaryVersion}</code>
                    </span>
                </div>
            </div>

            <ReviewAcknowledgementModal
                isOpen={isReviewModalOpen}
                artifactId={generationResponse.artifactId}
                sql={generationResponse.sql}
                assumptions={generationResponse.assumptions}
                warnings={findings}
                submitting={executing}
                onConfirm={(ack) => void executeArtifact(ack)}
                onCancel={() => setIsReviewModalOpen(false)}
            />
        </section>
    );
}
