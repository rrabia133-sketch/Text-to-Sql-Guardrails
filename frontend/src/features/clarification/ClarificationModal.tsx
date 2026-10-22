import { useState } from "react";
import type { ClarificationResponse } from "@text2sql/contracts";

interface ClarificationModalProps {
    isOpen: boolean;
    clarification: ClarificationResponse | null;
    onSelectOption: (optionId: string) => void;
    onClose: () => void;
    submitting?: boolean;
}

export function ClarificationModal({
    isOpen,
    clarification,
    onSelectOption,
    onClose,
    submitting = false,
}: ClarificationModalProps) {
    const [selectedId, setSelectedId] = useState<string>("");

    if (!isOpen || !clarification) return null;

    const handleConfirm = () => {
        if (!selectedId) return;
        onSelectOption(selectedId);
    };

    const getReasonTitle = (code: string) => {
        switch (code) {
            case "AMBIGUOUS_METRIC":
                return "Specify Metric Definition";
            case "MISSING_TIME_BOUND":
                return "Select Time Window";
            case "UNSUPPORTED_DOMAIN":
                return "Unsupported Domain Query";
            default:
                return "Clarification Needed";
        }
    };

    return (
        <div className="modal-backdrop" onClick={onClose} role="presentation">
            <div
                className="modal-content clarification-modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="clarification-title"
            >
                <div className="modal-header">
                    <div className="modal-title-group">
                        <span className="clarification-badge">Clarification</span>
                        <h3 id="clarification-title" className="modal-title">
                            {getReasonTitle(clarification.reasonCode)}
                        </h3>
                    </div>
                    <button
                        type="button"
                        className="modal-close-btn"
                        onClick={onClose}
                        aria-label="Close clarification dialog"
                    >
                        ✕
                    </button>
                </div>

                <div className="modal-body">
                    <div className="clarification-question-box">
                        <span className="q-label">Your Question:</span>
                        <p className="q-text">"{clarification.question}"</p>
                    </div>

                    <p className="clarification-message">{clarification.message}</p>

                    <div className="options-selection-list" role="radiogroup" aria-label="Clarification options">
                        {clarification.options.map((opt) => (
                            <label
                                key={opt.id}
                                className={`clarification-option-card ${selectedId === opt.id ? "selected" : ""}`}
                            >
                                <input
                                    type="radio"
                                    name="clarification_opt"
                                    value={opt.id}
                                    checked={selectedId === opt.id}
                                    onChange={() => setSelectedId(opt.id)}
                                    className="option-radio"
                                />
                                <div className="option-text-group">
                                    <span className="option-title">{opt.label}</span>
                                    {opt.description && (
                                        <span className="option-desc">{opt.description}</span>
                                    )}
                                </div>
                            </label>
                        ))}
                    </div>
                </div>

                <div className="modal-footer">
                    <button
                        type="button"
                        className="btn-secondary"
                        onClick={onClose}
                        disabled={submitting}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="action-btn"
                        onClick={handleConfirm}
                        disabled={!selectedId || submitting}
                    >
                        {submitting ? "Resuming Generation..." : "Continue with Selection →"}
                    </button>
                </div>
            </div>
        </div>
    );
}
