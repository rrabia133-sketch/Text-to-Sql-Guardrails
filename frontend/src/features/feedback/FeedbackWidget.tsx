import { useState, useEffect } from "react";
import type { FeedbackVerdict, FeedbackReasonCode, FeedbackRecord } from "@text2sql/contracts";

export interface FeedbackWidgetProps {
    artifactId: string;
    onFeedbackSubmitted?: (record: FeedbackRecord) => void;
}

const REASON_LABELS: Record<FeedbackReasonCode, string> = {
    wrong_metric: "Wrong metric (e.g., used sales instead of net revenue)",
    wrong_filter: "Missing or incorrect filter/condition",
    wrong_date: "Incorrect date or time boundary",
    missing_rows: "Missing expected rows or excessive rows",
    other: "Other logical or SQL syntax issue",
};

export function FeedbackWidget({
    artifactId,
    onFeedbackSubmitted,
}: FeedbackWidgetProps) {
    const [verdict, setVerdict] = useState<FeedbackVerdict | null>(null);
    const [reasonCode, setReasonCode] = useState<FeedbackReasonCode>("wrong_metric");
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showIncorrectForm, setShowIncorrectForm] = useState(false);

    useEffect(() => {
        // Reset state on artifact change and load any existing feedback
        setVerdict(null);
        setReasonCode("wrong_metric");
        setNotes("");
        setSubmitted(false);
        setError(null);
        setShowIncorrectForm(false);

        if (!artifactId) return;

        let active = true;
        fetch(`/api/v1/queries/${encodeURIComponent(artifactId)}/feedback`, {
            credentials: "include",
        })
            .then((res) => (res.ok ? res.json() : null))
            .then((data: FeedbackRecord | null) => {
                if (active && data) {
                    setVerdict(data.verdict);
                    if (data.reasonCode) setReasonCode(data.reasonCode);
                    if (data.notes) setNotes(data.notes);
                    setSubmitted(true);
                }
            })
            .catch(() => {
                // Ignore feedback load errors gracefully
            });

        return () => {
            active = false;
        };
    }, [artifactId]);

    const submitFeedback = async (
        chosenVerdict: FeedbackVerdict,
        reason?: FeedbackReasonCode,
        feedbackNotes?: string
    ) => {
        setSubmitting(true);
        setError(null);

        try {
            const body: {
                verdict: FeedbackVerdict;
                reasonCode?: FeedbackReasonCode;
                notes?: string;
            } = { verdict: chosenVerdict };

            if (chosenVerdict === "incorrect") {
                body.reasonCode = reason || reasonCode;
                if (feedbackNotes?.trim() || notes.trim()) {
                    body.notes = (feedbackNotes ?? notes).trim();
                }
            }

            const res = await fetch(`/api/v1/queries/${encodeURIComponent(artifactId)}/feedback`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(body),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || `Failed to submit feedback (${res.status})`);
            }

            setVerdict(chosenVerdict);
            setSubmitted(true);
            setShowIncorrectForm(false);
            if (onFeedbackSubmitted) {
                onFeedbackSubmitted(data);
            }
        } catch (err: any) {
            setError(err?.message || "Failed to submit feedback");
        } finally {
            setSubmitting(false);
        }
    };

    const handleCorrectClick = () => {
        void submitFeedback("correct");
    };

    const handleIncorrectToggle = () => {
        setShowIncorrectForm(true);
    };

    return (
        <div className="feedback-widget-box" role="region" aria-label="Query Feedback">
            <div className="feedback-header">
                <span className="feedback-prompt-text">
                    Was this query and execution result accurate?
                </span>

                <div className="feedback-buttons-group">
                    <button
                        type="button"
                        className={`feedback-btn btn-thumbs-up ${verdict === "correct" && submitted ? "active" : ""}`}
                        onClick={handleCorrectClick}
                        disabled={submitting}
                        title="Mark query as correct"
                        aria-pressed={verdict === "correct"}
                    >
                        👍 Correct
                    </button>

                    <button
                        type="button"
                        className={`feedback-btn btn-thumbs-down ${verdict === "incorrect" && submitted ? "active" : ""}`}
                        onClick={handleIncorrectToggle}
                        disabled={submitting}
                        title="Mark query as incorrect or flawed"
                        aria-pressed={verdict === "incorrect"}
                    >
                        👎 Incorrect
                    </button>
                </div>
            </div>

            {/* Success Toast */}
            {submitted && !showIncorrectForm && (
                <div className="feedback-success-banner" role="status">
                    <span>
                        ✓ Feedback recorded ({verdict === "correct" ? "Accurate" : "Needs Review"}). Thank you!
                    </span>
                    <button
                        type="button"
                        className="feedback-edit-link"
                        onClick={() => setShowIncorrectForm(verdict === "incorrect")}
                    >
                        Change
                    </button>
                </div>
            )}

            {/* Error Banner */}
            {error && (
                <div className="feedback-error-banner" role="alert">
                    <span>⚠️ {error}</span>
                </div>
            )}

            {/* Incorrect Feedback Details Form */}
            {showIncorrectForm && (
                <form
                    className="incorrect-feedback-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void submitFeedback("incorrect", reasonCode, notes);
                    }}
                >
                    <div className="form-group">
                        <label htmlFor="feedback-reason-select">What went wrong?</label>
                        <select
                            id="feedback-reason-select"
                            value={reasonCode}
                            onChange={(e) => setReasonCode(e.target.value as FeedbackReasonCode)}
                            className="reason-select"
                            disabled={submitting}
                        >
                            {Object.entries(REASON_LABELS).map(([code, label]) => (
                                <option key={code} value={code}>
                                    {label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="form-group">
                        <label htmlFor="feedback-notes-input">Additional notes (optional):</label>
                        <textarea
                            id="feedback-notes-input"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Describe what you expected instead..."
                            maxLength={1000}
                            rows={2}
                            className="feedback-textarea"
                            disabled={submitting}
                        />
                        <span className="char-count">{notes.length}/1000</span>
                    </div>

                    <div className="form-actions">
                        <button
                            type="button"
                            className="btn-cancel"
                            onClick={() => setShowIncorrectForm(false)}
                            disabled={submitting}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn-submit-feedback"
                            disabled={submitting}
                        >
                            {submitting ? "Submitting..." : "Submit Feedback"}
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}

