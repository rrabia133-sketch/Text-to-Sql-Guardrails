import { useState, useEffect, useRef } from "react";
import type {
    ConfidenceBand,
    QueryGenerationResponse,
    ExecutionResultResponse,
    ReviewAcknowledgement,
} from "@text2sql/contracts";
import { ConfidenceCard } from "./ConfidenceCard";
import { ReviewAcknowledgementModal } from "./ReviewAcknowledgementModal";
import { ResultsTablePanel } from "../results/ResultsTablePanel";
import { FeedbackWidget } from "../feedback/FeedbackWidget";
import { VsCodeSqlEditor } from "./VsCodeSqlEditor";
import {
    AlertTriangleIcon,
    BanIcon,
    CheckIcon,
    DatabaseIcon,
    PlayIcon,
    ShieldCheckIcon,
    TableIcon,
    TerminalIcon,
} from "../../components/Icons";

export interface SqlPreviewPanelProps {
    generationResponse: QueryGenerationResponse | null;
    autoExecuteSeq?: number;
    loading: boolean;
}

function resolveExecutionPolicy(res: QueryGenerationResponse | null) {
    if (!res) {
        return {
            normalizedBand: "HIGH" as ConfidenceBand,
            isBlocked: false,
            isReviewRequired: false,
            isCompletedArtifact: false,
        };
    }

    const normalizedBand: ConfidenceBand = (
        res.confidenceBand?.toUpperCase() ||
        (res.status === "preview_blocked"
            ? "BLOCKED"
            : res.status === "preview_review"
            ? "REVIEW"
            : "HIGH")
    ) as ConfidenceBand;

    const isBlocked =
        normalizedBand === "BLOCKED" ||
        res.status === "preview_blocked" ||
        res.status === "failed";

    const isReviewRequired =
        !isBlocked &&
        (normalizedBand === "REVIEW" || res.status === "preview_review");

    return {
        normalizedBand,
        isBlocked,
        isReviewRequired,
        isCompletedArtifact: res.status === "executed",
    };
}

export function SqlPreviewPanel({
    generationResponse,
    autoExecuteSeq = 0,
    loading,
}: SqlPreviewPanelProps) {
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [executionError, setExecutionError] = useState<string | null>(null);
    const [executionResult, setExecutionResult] = useState<ExecutionResultResponse | null>(null);
    const lastAutoExecutedSeqRef = useRef(0);

    const executeArtifact = async (
        acknowledgement?: ReviewAcknowledgement,
        targetArtifactId?: string
    ) => {
        const artifactId = targetArtifactId || generationResponse?.artifactId;
        if (!artifactId) return;
        setExecuting(true);
        setExecutionError(null);

        try {
            const res = await fetch(
                `/api/v1/queries/${encodeURIComponent(artifactId)}/execute`,
                {
                    method: "POST",
                    credentials: "include",
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

    useEffect(() => {
        setIsReviewModalOpen(false);
        setExecuting(false);
        setExecutionError(null);
        setExecutionResult(null);

        if (
            !generationResponse ||
            autoExecuteSeq <= 0 ||
            autoExecuteSeq === lastAutoExecutedSeqRef.current
        ) {
            return;
        }

        lastAutoExecutedSeqRef.current = autoExecuteSeq;

        const { isBlocked, isReviewRequired, isCompletedArtifact } =
            resolveExecutionPolicy(generationResponse);

        if (isBlocked || isCompletedArtifact) {
            return;
        }

        if (isReviewRequired) {
            setIsReviewModalOpen(true);
            return;
        }

        void executeArtifact(undefined, generationResponse.artifactId);
    }, [generationResponse?.artifactId, autoExecuteSeq]);

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
                    <h2 className="panel-title">SQL Query & Database Answer</h2>
                    <span className="brand-badge idle-badge">Idle</span>
                </div>
                <div className="panel-body empty-preview-content">
                    <div className="empty-preview-icon-ring" aria-hidden="true">
                        <DatabaseIcon size={28} />
                    </div>
                    <h3 className="empty-preview-heading">Ready for Analytical Query</h3>
                    <p className="empty-preview-text">
                        Ask a question on the left to compile AST-validated PostgreSQL SQL, verify semantic confidence, and view live database results side by side.
                    </p>
                    <div className="empty-workflow-strip" aria-hidden="true">
                        <span className="empty-workflow-pill">
                            <ShieldCheckIcon size={13} />
                            <span>AST Verified</span>
                        </span>
                        <span className="empty-workflow-pill">
                            <TerminalIcon size={13} />
                            <span>Read-Only Sandbox</span>
                        </span>
                        <span className="empty-workflow-pill">
                            <TableIcon size={13} />
                            <span>Live Answer</span>
                        </span>
                    </div>
                </div>
            </section>
        );
    }

    const { normalizedBand, isBlocked, isReviewRequired, isCompletedArtifact } =
        resolveExecutionPolicy(generationResponse);
    const hasExecuted =
        executionResult?.status === "completed" || isCompletedArtifact;

    const handleRunClick = () => {
        if (isBlocked || executing || hasExecuted) return;
        if (isReviewRequired) {
            setIsReviewModalOpen(true);
            return;
        }
        void executeArtifact();
    };

    const findings = generationResponse.semanticFindings || [];
    const displayStatus = executing
        ? "EXECUTING"
        : executionResult
        ? executionResult.status.toUpperCase()
        : executionError
        ? "EXECUTION_ERROR"
        : generationResponse.status.toUpperCase();

    return (
        <section className="panel-card" id="sql-preview-section">
            <div className="panel-header">
                <div className="panel-title-group">
                    <h2 className="panel-title">SQL Query & Database Answer</h2>
                    <span className="brand-badge preview-badge">
                        Status: {displayStatus}
                    </span>
                </div>
                <div className="header-meta-tags">
                    <span className="provider-tag">
                        {generationResponse.provider.toUpperCase()} ({generationResponse.model})
                    </span>

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
                        disabled={isBlocked || executing || hasExecuted}
                        title={
                            isBlocked
                                ? "Execution blocked due to critical semantic or safety findings"
                                : hasExecuted
                                ? "Query already executed against analytics_db"
                                : isReviewRequired
                                ? "Review and acknowledge warnings before running query"
                                : "Execute read-only SQL query against analytics_db"
                        }
                    >
                        {executing ? (
                            <>
                                <span className="btn-spinner btn-spinner-sm" aria-hidden="true"></span>
                                <span>Running...</span>
                            </>
                        ) : isBlocked ? (
                            <>
                                <BanIcon size={13} />
                                <span>Execution Blocked</span>
                            </>
                        ) : hasExecuted ? (
                            <>
                                <CheckIcon size={13} />
                                <span>Executed</span>
                            </>
                        ) : isReviewRequired ? (
                            <>
                                <AlertTriangleIcon size={13} />
                                <span>Review & Run Query</span>
                            </>
                        ) : (
                            <>
                                <PlayIcon size={12} />
                                <span>Run Query</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            <div className="panel-body">
                {/* Corrective Guidance Banner when Blocked */}
                {isBlocked && (
                    <div className="blocked-guidance-banner" role="alert">
                        <div className="banner-icon" aria-hidden="true">
                            <BanIcon size={20} />
                        </div>
                        <div className="banner-text">
                            <strong>Execution Blocked — Critical Semantic or Guardrail Refusal</strong>
                            <p>
                                This query cannot be executed because one or more critical findings or low-confidence rules failed. Refine your question with specific metrics, filters, or date boundaries and regenerate.
                            </p>
                        </div>
                    </div>
                )}

                {/* VS Code Style SQL Editor */}
                <VsCodeSqlEditor
                    sql={generationResponse.sql}
                    schemaVersion={generationResponse.versions.schemaVersion}
                />

                {/* Execution Results Panel (Database Answer) */}
                {(executing || executionError || executionResult) && (
                    <ResultsTablePanel
                        result={executionResult}
                        error={executionError}
                        loading={executing}
                    />
                )}

                {typeof generationResponse.confidenceScore === "number" && (
                    <ConfidenceCard
                        score={generationResponse.confidenceScore}
                        band={normalizedBand}
                        breakdown={generationResponse.confidenceBreakdown}
                        findings={findings}
                    />
                )}

                {/* Analyst Feedback Widget (Task 13) */}
                <FeedbackWidget
                    artifactId={generationResponse.artifactId}
                />

                {/* Referenced Tables & Metadata */}
                <div className="preview-details-grid">
                    <div className="metadata-grid">
                        <div className="metadata-item">
                            <span className="meta-label">Referenced Tables:</span>
                            <div className="tags-list">
                                {generationResponse.referencedTables.map((tbl, i) => (
                                    <span key={i} className="table-badge">
                                        <TableIcon size={12} />
                                        <span>{tbl}</span>
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

                    {/* Plain-English Explanation */}
                    <div className="explanation-box">
                        <h4 className="box-title">Query Explanation</h4>
                        <p className="explanation-text">{generationResponse.explanation}</p>
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
