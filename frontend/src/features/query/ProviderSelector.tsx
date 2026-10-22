import { useEffect, useState } from "react";
import type { ProviderType, ProviderSummaryResponse } from "@text2sql/contracts";

interface ProviderSelectorProps {
    selectedProvider: ProviderType;
    onSelectProvider: (provider: ProviderType) => void;
    disabled?: boolean;
}

export function ProviderSelector({
    selectedProvider,
    onSelectProvider,
    disabled = false,
}: ProviderSelectorProps) {
    const [summary, setSummary] = useState<ProviderSummaryResponse | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch("/api/v1/providers")
            .then((res) => {
                if (!res.ok) throw new Error("Failed to load providers");
                return res.json();
            })
            .then((data: ProviderSummaryResponse) => {
                setSummary(data);
                setLoading(false);
            })
            .catch(() => {
                setLoading(false);
            });
    }, []);

    const isLocalAirgap = summary?.activeMode === "local";
    const groqAllowed = summary?.allowedProviders.includes("groq") ?? false;
    const dailySpend = summary?.dailyBudget.spentTodayUsd ?? 0;
    const dailyCap = summary?.dailyBudget.budgetLimitUsd ?? 5.0;

    return (
        <div className="provider-selector-card" id="provider-selector">
            <div className="provider-selector-header">
                <span className="selector-label">LLM Provider & Policy:</span>
                {isLocalAirgap ? (
                    <span className="airgap-badge" title="Local-only privacy mode: zero outbound egress">
                        🛡️ Local Airgap Mode
                    </span>
                ) : (
                    <span className="hybrid-badge">
                        🌐 {summary?.activeMode.toUpperCase()} Mode
                    </span>
                )}
            </div>

            <div className="provider-options-group" role="radiogroup" aria-label="LLM Provider Selection">
                {/* Ollama Local Button */}
                <button
                    type="button"
                    role="radio"
                    aria-checked={selectedProvider === "ollama"}
                    className={`provider-pill ${selectedProvider === "ollama" ? "active" : ""}`}
                    onClick={() => onSelectProvider("ollama")}
                    disabled={disabled}
                    id="provider-ollama-btn"
                >
                    <span className="provider-status-dot online"></span>
                    <span className="provider-name">Ollama Local</span>
                    <span className="provider-model-tag">qwen2.5-coder:7b</span>
                </button>

                {/* Groq Cloud Button */}
                <button
                    type="button"
                    role="radio"
                    aria-checked={selectedProvider === "groq"}
                    className={`provider-pill ${selectedProvider === "groq" ? "active" : ""} ${!groqAllowed ? "disabled-pill" : ""}`}
                    onClick={() => {
                        if (groqAllowed) onSelectProvider("groq");
                    }}
                    disabled={disabled || !groqAllowed}
                    title={!groqAllowed ? "Groq cloud is disabled in local airgap mode" : "Fast cloud inference"}
                    id="provider-groq-btn"
                >
                    <span className={`provider-status-dot ${groqAllowed ? "online" : "offline"}`}></span>
                    <span className="provider-name">Groq Cloud</span>
                    <span className="provider-model-tag">llama-3.3-70b</span>
                    {!groqAllowed && <span className="lock-icon">🔒</span>}
                </button>
            </div>

            {/* Cloud Budget Meter */}
            {groqAllowed && (
                <div className="budget-meter">
                    <span className="budget-text">
                        Daily Budget: ${dailySpend.toFixed(3)} / ${dailyCap.toFixed(2)} USD
                    </span>
                    <div className="budget-bar-bg">
                        <div
                            className="budget-bar-fill"
                            style={{
                                width: `${Math.min(100, (dailySpend / dailyCap) * 100)}%`,
                            }}
                        ></div>
                    </div>
                </div>
            )}
        </div>
    );
}
