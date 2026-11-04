import { useState } from "react";

export interface CsvExportButtonProps {
    executionId: string;
    rowCount: number;
    truncated?: boolean;
    disabled?: boolean;
}

export function CsvExportButton({
    executionId,
    rowCount,
    truncated = false,
    disabled = false,
}: CsvExportButtonProps) {
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);

    const handleExport = async () => {
        if (!executionId || exporting || disabled) return;

        setExporting(true);
        setExportError(null);

        try {
            const res = await fetch(`/api/v1/executions/${encodeURIComponent(executionId)}/export.csv`, {
                method: "GET",
                credentials: "include",
            });

            if (res.status === 410) {
                throw new Error("Result expired (15m ephemeral window). Please re-run the query to export.");
            }

            if (!res.ok) {
                const errorData = await res.json().catch(() => null);
                throw new Error(errorData?.message || `Export failed with status ${res.status}`);
            }

            const blob = await res.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = downloadUrl;
            a.download = `query-results-${executionId}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(downloadUrl);
        } catch (err: any) {
            setExportError(err?.message || "Failed to download CSV export.");
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="csv-export-container">
            <button
                type="button"
                className="btn-export-csv"
                onClick={handleExport}
                disabled={disabled || exporting || rowCount === 0}
                title={
                    rowCount === 0
                        ? "No rows available to export"
                        : truncated
                        ? "Export first 500 rows to safe CSV (formula-neutralized)"
                        : "Download results as RFC 4180 safe CSV"
                }
                aria-label={`Export ${rowCount} rows as CSV`}
            >
                {exporting ? (
                    <>
                        <span className="spinner-inline" aria-hidden="true">⏳</span>
                        <span>Exporting...</span>
                    </>
                ) : (
                    <>
                        <span aria-hidden="true">📥</span>
                        <span>Export CSV</span>
                        {truncated && <span className="truncation-sub-badge">(500 row cap)</span>}
                    </>
                )}
            </button>

            {exportError && (
                <div className="export-error-toast" role="alert">
                    <span>⚠️ {exportError}</span>
                    <button
                        type="button"
                        className="error-dismiss-btn"
                        onClick={() => setExportError(null)}
                        aria-label="Dismiss error"
                    >
                        ✕
                    </button>
                </div>
            )}
        </div>
    );
}

