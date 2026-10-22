import { useState } from "react";

interface QueryInputBarProps {
    prompt: string;
    onPromptChange: (val: string) => void;
    onSubmit: () => void;
    loading: boolean;
    error?: string | null;
}

const EXAMPLE_QUERIES = [
    "What was our total revenue last month?",
    "Show top 10 products by unit price in electronics",
    "List all completed orders this year",
    "Active customers in the last 30 days",
];

export function QueryInputBar({
    prompt,
    onPromptChange,
    onSubmit,
    loading,
    error,
}: QueryInputBarProps) {
    const maxChars = 500;
    const charCount = prompt.length;
    const isOverLimit = charCount > maxChars;
    const isNearLimit = charCount >= 450;
    const isEmpty = prompt.trim().length === 0;

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!loading && !isEmpty && !isOverLimit) {
                onSubmit();
            }
        }
    };

    return (
        <section className="panel-card" id="prompt-section">
            <div className="panel-header">
                <div className="panel-title-group">
                    <h2 className="panel-title">Natural Language Request</h2>
                    <span className="panel-subtitle">
                        Ask analytical questions grounded in customers, products, and orders schema.
                    </span>
                </div>
                <div
                    className={`char-counter ${isOverLimit ? "limit-error" : isNearLimit ? "limit-warning" : ""}`}
                    aria-live="polite"
                >
                    {charCount}/{maxChars}
                </div>
            </div>

            <div className="panel-body">
                <div className="textarea-container">
                    <textarea
                        id="prompt-input"
                        className={`prompt-input ${error ? "input-has-error" : ""}`}
                        value={prompt}
                        onChange={(e) => onPromptChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="e.g. Calculate total revenue for completed orders last quarter..."
                        disabled={loading}
                        rows={3}
                        maxLength={maxChars}
                        aria-label="Analytical Question Input"
                    />
                </div>

                {error && (
                    <div className="error-alert-banner" role="alert">
                        <span className="error-icon">⚠️</span>
                        <span className="error-text">{error}</span>
                    </div>
                )}

                <div className="prompt-actions-bar">
                    <div className="example-chips-group">
                        <span className="chips-label">Try:</span>
                        {EXAMPLE_QUERIES.map((q, idx) => (
                            <button
                                key={idx}
                                type="button"
                                className="chip-btn"
                                onClick={() => onPromptChange(q)}
                                disabled={loading}
                            >
                                {q}
                            </button>
                        ))}
                    </div>

                    <button
                        id="generate-sql-btn"
                        className="action-btn generate-btn"
                        onClick={onSubmit}
                        disabled={loading || isEmpty || isOverLimit}
                    >
                        {loading ? (
                            <>
                                <span className="btn-spinner" aria-hidden="true"></span>
                                <span>Generating Grounded SQL...</span>
                            </>
                        ) : (
                            <>
                                <span>⚡ Generate SQL Preview</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </section>
    );
}
