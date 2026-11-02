import { useState, useEffect } from "react";
import type { SemanticFinding, ReviewAcknowledgement } from "@text2sql/contracts";

export interface ReviewAcknowledgementModalProps {
    isOpen: boolean;
    artifactId: string;
    sql: string;
    assumptions: string[];
    warnings: SemanticFinding[];
    submitting?: boolean;
    onConfirm: (acknowledgement: ReviewAcknowledgement) => void;
    onCancel: () => void;
}

export function ReviewAcknowledgementModal({
    isOpen,
    artifactId,
    sql,
    assumptions,
    warnings,
    submitting = false,
    onConfirm,
    onCancel,
}: ReviewAcknowledgementModalProps) {
    const [confirmed, setConfirmed] = useState(false);
    const [analystNote, setAnalystNote] = useState("");

    useEffect(() => {
        if (isOpen) {
            setConfirmed(false);
            setAnalystNote("");
        }
    }, [isOpen, artifactId]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!confirmed || submitting) return;

        onConfirm({
            confirmed: true,
            reviewedWarnings: warnings.map((w) => w.code),
            acknowledgedAt: new Date().toISOString(),
            analystNote: analystNote.trim() ? analystNote.trim() : undefined,
        });
    };

    return (
        <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-ack-modal-title"
        >
            <div className="modal-card review-ack-modal-card">
                <div className="modal-header">
                    <div>
                        <span className="confidence-band-badge band-review">REVIEW REQUIRED</span>
                        <h3 id="review-ack-modal-title" className="modal-title" style={{ marginTop: 6 }}>
                            Acknowledge SQL Warnings & Assumptions
                        </h3>
                    </div>
                    <button
                        type="button"
                        className="modal-close-btn"
                        onClick={onCancel}
                        disabled={submitting}
                        aria-label="Close modal"
                    >
                        ✕
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="modal-body review-ack-modal-body">
                    <p className="review-ack-intro">
                        This query scored in the <strong>REVIEW</strong> confidence band (`65–84`). Please verify the active semantic warnings and model assumptions below before executing against <code>analytics_db</code>.
                    </p>

                    {warnings.length > 0 && (
                        <div className="review-ack-section">
                            <h4 className="review-ack-subtitle">
                                Active Advisory Warnings ({warnings.length})
                            </h4>
                            <ul className="review-ack-warnings-list">
                                {warnings.map((w, idx) => (
                                    <li key={`${w.code}-${idx}`} className="review-ack-warning-item">
                                        <div className="review-ack-warning-top">
                                            <span className="semantic-severity-badge badge-warning">
                                                {w.severity}
                                            </span>
                                            <code>{w.code}</code>
                                        </div>
                                        <p>{w.message}</p>
                                        {w.suggestion && (
                                            <p className="review-ack-suggestion">
                                                <strong>Tip:</strong> {w.suggestion}
                                            </p>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {assumptions.length > 0 && (
                        <div className="review-ack-section">
                            <h4 className="review-ack-subtitle">Model Assumptions</h4>
                            <ul className="review-ack-assumptions">
                                {assumptions.map((item, idx) => (
                                    <li key={idx}>{item}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="review-ack-section">
                        <h4 className="review-ack-subtitle">SQL Statement to Execute</h4>
                        <pre className="code-viewer review-ack-sql">
                            <code>{sql}</code>
                        </pre>
                    </div>

                    <div className="review-ack-note-group">
                        <label htmlFor="analyst-review-note" className="review-ack-note-label">
                            Optional Audit Note (stored with execution record):
                        </label>
                        <input
                            id="analyst-review-note"
                            type="text"
                            className="review-ack-note-input"
                            placeholder="e.g. Verified distinct grain acceptable for regional summary"
                            maxLength={500}
                            value={analystNote}
                            onChange={(e) => setAnalystNote(e.target.value)}
                            disabled={submitting}
                        />
                    </div>

                    <label className="review-ack-checkbox-row">
                        <input
                            type="checkbox"
                            checked={confirmed}
                            onChange={(e) => setConfirmed(e.target.checked)}
                            disabled={submitting}
                        />
                        <span>I have reviewed the SQL assumptions and warnings.</span>
                    </label>

                    <div className="modal-actions review-ack-actions">
                        <button
                            type="button"
                            className="secondary-btn"
                            onClick={onCancel}
                            disabled={submitting}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="action-btn review-confirm-btn"
                            disabled={!confirmed || submitting}
                        >
                            {submitting ? "Executing Query..." : "Confirm & Run Query"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

