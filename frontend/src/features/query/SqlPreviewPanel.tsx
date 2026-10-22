import { useState } from "react";
import type { QueryGenerationResponse } from "@text2sql/contracts";

interface SqlPreviewPanelProps {
    generationResponse: QueryGenerationResponse | null;
    loading: boolean;
}

export function SqlPreviewPanel({ generationResponse, loading }: SqlPreviewPanelProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        if (!generationResponse?.sql) return;
        navigator.clipboard.writeText(generationResponse.sql);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
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

    return (
        <section className="panel-card" id="sql-preview-section">
            <div className="panel-header">
                <div className="panel-title-group">
                    <h2 className="panel-title">Grounded SQL Preview</h2>
                    <span className="brand-badge preview-badge">Status: {generationResponse.status.toUpperCase()}</span>
                </div>
                <div className="header-meta-tags">
                    <span className="provider-tag">{generationResponse.provider.toUpperCase()} ({generationResponse.model})</span>
                    <button
                        type="button"
                        className="copy-btn"
                        onClick={handleCopy}
                        title="Copy SQL to clipboard"
                    >
                        {copied ? "✓ Copied" : "📋 Copy SQL"}
                    </button>
                </div>
            </div>

            <div className="panel-body">
                {/* Sprint 3 Explicit Non-Execution Notice */}
                <div className="preview-only-banner" role="status">
                    <div className="banner-icon">🔒</div>
                    <div className="banner-text">
                        <strong>Preview Only — Execution Disabled Until Sprint 4</strong>
                        <p>
                            This query has been schema-grounded and validated. Execution against <code>analytics_db</code> with AST safety guardrails and strict privilege containment will activate in Sprint 4.
                        </p>
                    </div>
                </div>

                {/* SQL Code Block */}
                <div className="code-block-wrapper">
                    <div className="code-header">
                        <span className="code-lang">PostgreSQL (SELECT only)</span>
                        <span className="schema-ver-badge">Schema: {generationResponse.versions.schemaVersion}</span>
                    </div>
                    <pre className="code-viewer">
                        <code>{generationResponse.sql}</code>
                    </pre>
                </div>

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
                    <span>Artifact ID: <code>{generationResponse.artifactId}</code></span>
                    <span>Prompt: <code>v{generationResponse.versions.promptVersion}</code></span>
                    <span>Glossary: <code>v{generationResponse.versions.glossaryVersion}</code></span>
                </div>
            </div>
        </section>
    );
}
