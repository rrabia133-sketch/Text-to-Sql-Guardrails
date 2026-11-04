import { useState, useEffect, useCallback } from "react";
import type { HistoryItemSummary, PaginatedHistoryResponse } from "@text2sql/contracts";

export interface QueryHistoryPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectHistoryItem: (item: HistoryItemSummary) => void;
}

const PAGE_SIZE = 10;

export function QueryHistoryPanel({
    isOpen,
    onClose,
    onSelectHistoryItem,
}: QueryHistoryPanelProps) {
    const [history, setHistory] = useState<HistoryItemSummary[]>([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const fetchHistory = useCallback(async (currentOffset: number) => {
        setLoading(true);
        setError(null);

        try {
            const res = await fetch(
                `/api/v1/history?limit=${PAGE_SIZE}&offset=${currentOffset}`,
                { credentials: "include" }
            );

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.message || `Failed to fetch history (${res.status})`);
            }

            const data: PaginatedHistoryResponse = await res.json();
            setHistory(data.items);
            setTotal(data.total);
            setOffset(data.offset);
        } catch (err: any) {
            setError(err?.message || "Failed to load query history");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            void fetchHistory(0);
        }
    }, [isOpen, fetchHistory]);

    // Handle Escape key to close drawer
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isOpen) {
                onClose();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    const handleDelete = async (artifactId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (deletingId) return;

        setDeletingId(artifactId);
        try {
            const res = await fetch(`/api/v1/history/${encodeURIComponent(artifactId)}`, {
                method: "DELETE",
                credentials: "include",
            });

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.message || `Failed to delete artifact (${res.status})`);
            }

            // Refresh current page
            await fetchHistory(offset);
        } catch (err: any) {
            setError(err?.message || "Failed to delete artifact");
        } finally {
            setDeletingId(null);
        }
    };

    if (!isOpen) return null;

    const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
    const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

    return (
        <div className="drawer-backdrop" onClick={onClose} aria-hidden={!isOpen}>
            <aside
                className="history-drawer-panel"
                role="dialog"
                aria-modal="true"
                aria-label="Query History Drawer"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="drawer-header">
                    <div className="title-group">
                        <span className="drawer-icon" aria-hidden="true">📜</span>
                        <h2 className="drawer-title">Query History</h2>
                        <span className="badge badge-neutral">{total} item{total === 1 ? "" : "s"}</span>
                    </div>
                    <button
                        type="button"
                        className="close-drawer-btn"
                        onClick={onClose}
                        aria-label="Close query history drawer (Escape)"
                    >
                        ✕
                    </button>
                </div>

                {error && (
                    <div className="history-error-banner" role="alert">
                        <span>⚠️ {error}</span>
                        <button type="button" onClick={() => setError(null)}>✕</button>
                    </div>
                )}

                <div className="drawer-body">
                    {loading && history.length === 0 ? (
                        <div className="history-loading-state">
                            <div className="spinner-inline" />
                            <p>Loading your query history...</p>
                        </div>
                    ) : history.length === 0 ? (
                        <div className="history-empty-state">
                            <span className="empty-icon">📭</span>
                            <h3>No Past Queries</h3>
                            <p>Queries generated and run during your sessions will appear here.</p>
                        </div>
                    ) : (
                        <div className="history-items-list" role="feed" aria-label="Past Queries">
                            {history.map((item) => (
                                <article
                                    key={item.artifactId}
                                    className="history-card"
                                    onClick={() => onSelectHistoryItem(item)}
                                    tabIndex={0}
                                    role="article"
                                    aria-label={`Query: ${item.question}`}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            onSelectHistoryItem(item);
                                        }
                                    }}
                                >
                                    <div className="history-card-header">
                                        <div className="history-badges">
                                            {item.confidenceBand && (
                                                <span className={`confidence-pill band-${item.confidenceBand.toLowerCase()}`}>
                                                    {item.confidenceBand === "HIGH" ? "✓ HIGH" : item.confidenceBand === "REVIEW" ? "⚠️ REVIEW" : "🚫 BLOCKED"}
                                                    {item.confidenceScore !== undefined && ` (${item.confidenceScore}%)`}
                                                </span>
                                            )}
                                            <span className="provider-subtag">
                                                {item.provider} / {item.model}
                                            </span>
                                        </div>

                                        <button
                                            type="button"
                                            className="delete-history-btn"
                                            onClick={(e) => void handleDelete(item.artifactId, e)}
                                            disabled={deletingId === item.artifactId}
                                            title="Delete this query artifact"
                                            aria-label={`Delete artifact ${item.artifactId}`}
                                        >
                                            {deletingId === item.artifactId ? "..." : "🗑️"}
                                        </button>
                                    </div>

                                    <h4 className="history-question">{item.question}</h4>

                                    <pre className="history-sql-snippet">
                                        <code>{item.sql}</code>
                                    </pre>

                                    <div className="history-card-footer">
                                        <time dateTime={item.createdAt} className="history-time">
                                            {new Date(item.createdAt).toLocaleString(undefined, {
                                                month: "short",
                                                day: "numeric",
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            })}
                                        </time>
                                        <span className="load-action-hint">Click to load in editor ↗</span>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </div>

                {/* Pagination Controls */}
                {total > PAGE_SIZE && (
                    <div className="drawer-pagination">
                        <button
                            type="button"
                            className="btn-page"
                            onClick={() => void fetchHistory(Math.max(0, offset - PAGE_SIZE))}
                            disabled={offset === 0 || loading}
                            aria-label="Previous page"
                        >
                            ← Previous
                        </button>

                        <span className="page-indicator">
                            Page {currentPage} of {totalPages}
                        </span>

                        <button
                            type="button"
                            className="btn-page"
                            onClick={() => void fetchHistory(offset + PAGE_SIZE)}
                            disabled={offset + PAGE_SIZE >= total || loading}
                            aria-label="Next page"
                        >
                            Next →
                        </button>
                    </div>
                )}
            </aside>
        </div>
    );
}

