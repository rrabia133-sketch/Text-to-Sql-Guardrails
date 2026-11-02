import type {
    ConfidenceBand,
    QueryArtifactStatus,
    ReviewAcknowledgement,
    ExecutionErrorCode,
} from "@text2sql/contracts";

export interface CanExecuteResult {
    allowed: boolean;
    errorCode?: ExecutionErrorCode;
    errorMessage?: string;
}

export class ArtifactStateService {
    /**
     * Resolves query artifact lifecycle state based on confidence band, semantic findings, and guardrails.
     * - If guardrails failed, or critical semantic findings exist, or band is BLOCKED -> 'preview_blocked'
     * - If band is REVIEW -> 'preview_review'
     * - If band is HIGH -> 'preview_ready'
     */
    public resolveState(params: {
        confidenceBand?: ConfidenceBand;
        hasCriticalFindings?: boolean;
        guardrailsValid?: boolean;
    }): QueryArtifactStatus {
        if (
            params.guardrailsValid === false ||
            params.hasCriticalFindings === true ||
            params.confidenceBand === "BLOCKED"
        ) {
            return "preview_blocked";
        }

        if (params.confidenceBand === "REVIEW") {
            return "preview_review";
        }

        if (params.confidenceBand === "HIGH") {
            return "preview_ready";
        }

        // Fallback default
        return "preview_ready";
    }

    /**
     * Enforces the artifact execution gate based on status and required review acknowledgement.
     */
    public canExecute(
        status: string,
        acknowledgement?: ReviewAcknowledgement
    ): CanExecuteResult {
        // 1. Blocked artifacts cannot be executed under any circumstance
        if (status === "preview_blocked") {
            return {
                allowed: false,
                errorCode: "BLOCKED_CONFIDENCE_BAND",
                errorMessage:
                    "Query artifact is in 'preview_blocked' state due to low confidence or critical validation findings. Execution is prohibited.",
            };
        }

        // 2. Review artifacts require explicit analyst confirmation of warnings
        if (status === "preview_review") {
            if (!acknowledgement || acknowledgement.confirmed !== true) {
                return {
                    allowed: false,
                    errorCode: "REVIEW_ACKNOWLEDGEMENT_REQUIRED",
                    errorMessage:
                        "Query artifact is in 'preview_review' state. Explicit acknowledgement of warnings is required before execution.",
                };
            }
            return { allowed: true };
        }

        // 3. Ready artifacts (and legacy 'preview') can execute immediately
        if (status === "preview_ready" || status === "preview") {
            return { allowed: true };
        }

        // 4. Any other status is an invalid transaction state
        return {
            allowed: false,
            errorCode: "TRANSACTION_VIOLATION",
            errorMessage: `Artifact is in '${status}' state and cannot be executed (only 'preview' artifacts may be executed).`,
        };
    }

    /**
     * Validates permitted query artifact lifecycle status transitions.
     */
    public isValidTransition(current: QueryArtifactStatus, next: QueryArtifactStatus): boolean {
        const allowedTransitions: Record<QueryArtifactStatus, QueryArtifactStatus[]> = {
            preview: ["executing", "failed"],
            preview_ready: ["executing", "failed"],
            preview_review: ["executing", "failed"],
            preview_blocked: [], // Terminal blocked state; cannot execute
            executing: ["executed", "failed"],
            executed: [],
            failed: [],
        };

        const allowed = allowedTransitions[current] || [];
        return allowed.includes(next);
    }
}

