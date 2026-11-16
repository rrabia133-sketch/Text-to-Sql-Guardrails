import { useEffect, useState } from "react";
import type { ProviderType, ProviderSummaryResponse } from "@text2sql/contracts";
import { GlobeIcon, LockIcon, ShieldCheckIcon } from "../../components/Icons";

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

    const isLocalAirgap = summary?.activeMode === "local" || loading;
    const groqAllowed = summary?.allowedProviders.includes("groq") ?? false;
    const ollamaModel =
        summary?.providers.find((p) => p.provider === "ollama")?.model ||
        "qwen2.5-coder:7b";
    const groqModel =
        summary?.providers.find((p) => p.provider === "groq")?.model ||
        "groq-cloud";

    return (
        <section className="provider-selector-card" id="provider-selector" aria-label="LLM Provider & Policy">
            <div className="provider-selector-header">
                <span className="selector-label">LLM Provider &amp; Policy</span>
                {isLocalAirgap ? (
                    <span className="airgap-badge" title="Local-only privacy mode: zero outbound egress">
                        <ShieldCheckIcon size={12} />
                        <span>Local Airgap</span>
                    </span>
                ) : (
                    <span className="hybrid-badge">
                        <GlobeIcon size={12} />
                        <span>{summary?.activeMode.toUpperCase()} Mode</span>
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
                    <span className="provider-status-dot online" aria-hidden="true"></span>
                    <span className="provider-pill-copy">
                        <span className="provider-name">Ollama Local</span>
                        <span className="provider-model-tag">{ollamaModel}</span>
                    </span>
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
                    <span className={`provider-status-dot ${groqAllowed ? "online" : "offline"}`} aria-hidden="true"></span>
                    <span className="provider-pill-copy">
                        <span className="provider-name">Groq Cloud</span>
                        <span className="provider-model-tag">{groqModel}</span>
                    </span>
                    {!groqAllowed && <LockIcon size={13} className="lock-icon" />}
                </button>
            </div>
        </section>
    );
}
