import React from "react";
import type { ExecutionResultResponse, ColumnTypeMetadata } from "@text2sql/contracts";
import { CsvExportButton } from "./CsvExportButton";

export interface ResultsTablePanelProps {
    result: ExecutionResultResponse | null;
    error?: string | null;
    loading?: boolean;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatCellValue(value: unknown, colMeta?: ColumnTypeMetadata): React.ReactNode {
    if (value === null || value === undefined) {
        return <span className="null-cell-badge" aria-label="Null value">NULL</span>;
    }

    if (typeof value === "boolean") {
        return (
            <span className={`boolean-pill ${value ? "bool-true" : "bool-false"}`}>
                {value ? "TRUE" : "FALSE"}
            </span>
        );
    }

    if (typeof value === "number") {
        return (
            <span className="tabular-num">
                {Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2)}
            </span>
        );
    }

    if (colMeta?.jsType === "date" || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value))) {
        return <time className="date-cell" dateTime={String(value)}>{String(value)}</time>;
    }

    if (typeof value === "object") {
        return <code className="json-inline">{JSON.stringify(value)}</code>;
    }

    return String(value);
}

export function ResultsTablePanel({
    result,
    error,
    loading = false,
}: ResultsTablePanelProps) {
    if (loading) {
        return (
            <section className="results-panel-card" aria-label="Executing Query" aria-busy="true">
                <div className="results-header">
                    <div className="title-group">
                        <h3 className="results-title">Query Execution</h3>
                        <span className="badge badge-running">Executing...</span>
                    </div>
                </div>
                <div className="results-loading-body">
                    <div className="spinner-lg" aria-hidden="true" />
                    <p className="loading-text">
                        Running read-only query against analytics database inside isolated transaction...
                    </p>
                </div>
            </section>
        );
    }

    if (error) {
        return (
            <section className="results-panel-card results-error-card" aria-label="Execution Failed" role="alert">
                <div className="results-header">
                    <div className="title-group">
                        <h3 className="results-title">Execution Refused or Failed</h3>
                        <span className="badge badge-failed">FAILED</span>
                    </div>
                </div>
                <div className="results-error-body">
                    <div className="error-icon" aria-hidden="true">🚫</div>
                    <div className="error-content">
                        <h4>Query Execution Refused</h4>
                        <p className="error-message">{error}</p>
                    </div>
                </div>
            </section>
        );
    }

    if (!result) {
        return null;
    }

    const isSuccess = result.status === "completed";
    const isEmpty = result.rowCount === 0;

    return (
        <section className="results-panel-card" aria-label="Query Execution Results">
            {/* Header with Stats & CSV Action */}
            <div className="results-header">
                <div className="title-group">
                    <h3 className="results-title">Execution Results</h3>
                    <span className={`badge ${isSuccess ? "badge-completed" : "badge-warn"}`}>
                        {result.status.toUpperCase()}
                    </span>
                    {result.truncated && (
                        <span className="badge badge-truncated" title="Capped at 500 rows / 1 MiB bound">
                            ⚠️ TRUNCATED (500 MAX)
                        </span>
                    )}
                </div>

                <div className="results-actions">
                    <div className="results-stats">
                        <span className="stat-item" title="Returned row count">
                            <strong>{result.rowCount}</strong> row{result.rowCount === 1 ? "" : "s"}
                        </span>
                        <span className="stat-separator">•</span>
                        <span className="stat-item" title="Execution latency">
                            <strong>{result.executionTimeMs}</strong> ms
                        </span>
                        <span className="stat-separator">•</span>
                        <span className="stat-item" title="Payload size">
                            <strong>{formatBytes(result.byteSize)}</strong>
                        </span>
                    </div>

                    <CsvExportButton
                        executionId={result.executionId}
                        rowCount={result.rowCount}
                        truncated={result.truncated}
                    />
                </div>
            </div>

            {/* Truncation Notice Banner */}
            {result.truncated && (
                <div className="truncation-alert-banner" role="status">
                    <span className="alert-icon" aria-hidden="true">ℹ️</span>
                    <div className="alert-text">
                        <strong>Result Capped:</strong> Query returned more than 500 rows. The result set has been truncated to the first 500 rows (1 MiB memory boundary) for browser responsiveness and safety.
                    </div>
                </div>
            )}

            {/* Table or Empty State */}
            {isEmpty ? (
                <div className="results-empty-state" role="status">
                    <div className="empty-icon" aria-hidden="true">📊</div>
                    <h4>0 Rows Returned</h4>
                    <p>The query executed cleanly, but no records in the analytics database matched your criteria.</p>
                </div>
            ) : (
                <div className="results-table-scroll-container" tabIndex={0} aria-label="Scrollable results table">
                    <table className="results-data-table" role="table">
                        <caption className="sr-only">Query results containing {result.rowCount} rows</caption>
                        <thead>
                            <tr>
                                <th scope="col" className="row-num-col">#</th>
                                {result.columns.map((col) => (
                                    <th key={col.name} scope="col">
                                        <div className="th-content">
                                            <span className="col-name">{col.name}</span>
                                            <span className="col-type-tag" title={`PostgreSQL type: ${col.pgType}`}>
                                                {col.pgType}
                                            </span>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {result.rows.map((row, rowIdx) => (
                                <tr key={rowIdx}>
                                    <td className="row-num-cell">{rowIdx + 1}</td>
                                    {result.columns.map((col) => (
                                        <td
                                            key={col.name}
                                            className={col.jsType === "number" ? "align-right" : "align-left"}
                                        >
                                            {formatCellValue(row[col.name], col)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Footer with Timestamp and Execution ID */}
            <div className="results-footer">
                <span className="execution-id-tag">
                    Execution ID: <code>{result.executionId}</code>
                </span>
                <span className="executed-at-tag">
                    Executed: <time dateTime={result.executedAt}>{new Date(result.executedAt).toLocaleTimeString()}</time>
                </span>
            </div>
        </section>
    );
}

