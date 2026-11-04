import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./features/auth/AuthContext";
import { Header } from "./components/Header";
import { UserSwitcherModal } from "./features/auth/UserSwitcherModal";
import { ProviderSelector } from "./features/query/ProviderSelector";
import { QueryInputBar } from "./features/query/QueryInputBar";
import { SqlPreviewPanel } from "./features/query/SqlPreviewPanel";
import { ClarificationModal } from "./features/clarification/ClarificationModal";
import { QueryHistoryPanel } from "./features/history/QueryHistoryPanel";
import type {
    ProviderType,
    QueryGenerationResponse,
    ClarificationResponse,
    HistoryItemSummary,
} from "@text2sql/contracts";

interface ApiHealthResponse {
    name: string;
    status: string;
    version: string;
}

function MainWorkspace() {
    const { user, loading: authLoading } = useAuth();
    const [apiStatus, setApiStatus] = useState<ApiHealthResponse | null>(null);
    const [connecting, setConnecting] = useState(true);
    const [isUserModalOpen, setIsUserModalOpen] = useState(false);

    // Query History Drawer State (US-15)
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);

    // WCAG 2.2 AA ARIA Live Region State
    const [ariaLiveMessage, setAriaLiveMessage] = useState("");

    // Query Generation State
    const [prompt, setPrompt] = useState("What was our total revenue last month?");
    const [selectedProvider, setSelectedProvider] = useState<ProviderType>("ollama");
    const [generating, setGenerating] = useState(false);
    const [generationError, setGenerationError] = useState<string | null>(null);
    const [generationResponse, setGenerationResponse] = useState<QueryGenerationResponse | null>(null);

    // Clarification Dialog State
    const [clarification, setClarification] = useState<ClarificationResponse | null>(null);
    const [isClarificationOpen, setIsClarificationOpen] = useState(false);

    useEffect(() => {
        fetch("/api/")
            .then((res) => {
                if (!res.ok) throw new Error("API response error");
                return res.json();
            })
            .then((data: ApiHealthResponse) => {
                setApiStatus(data);
                setConnecting(false);
            })
            .catch(() => {
                setConnecting(false);
            });
    }, []);

    // Global keyboard shortcuts (Ctrl+H / Cmd+H for query history)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
                e.preventDefault();
                if (user) {
                    setIsHistoryOpen((prev) => !prev);
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [user]);

    const handleGenerateQuery = async (
        overridePrompt?: string,
        clarificationSessionId?: string,
        selectedOptionId?: string
    ) => {
        const questionToAsk = overridePrompt ?? prompt;
        if (!questionToAsk.trim()) return;

        setGenerating(true);
        setGenerationError(null);
        setAriaLiveMessage("Generating schema-grounded SQL query...");

        const payload: Record<string, any> = {
            question: questionToAsk,
            providerPreference: selectedProvider,
        };

        if (clarificationSessionId && selectedOptionId) {
            payload.clarificationSessionId = clarificationSessionId;
            payload.selectedClarificationOption = selectedOptionId;
        }

        try {
            const res = await fetch("/api/v1/queries", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.message || `Generation failed (${res.status})`);
            }

            if (data.type === "clarification") {
                setClarification(data);
                setIsClarificationOpen(true);
                setAriaLiveMessage("Clarification needed. Please select an option.");
            } else if (data.type === "generation") {
                setGenerationResponse(data);
                setIsClarificationOpen(false);
                setClarification(null);
                setAriaLiveMessage(
                    `SQL generated successfully with confidence band ${data.confidenceBand || "HIGH"}.`
                );
            }
        } catch (err: any) {
            const errMsg = err?.message || "An unexpected error occurred during generation";
            setGenerationError(errMsg);
            setAriaLiveMessage(`Error: ${errMsg}`);
        } finally {
            setGenerating(false);
        }
    };

    const handleClarificationSelection = (optionId: string) => {
        if (!clarification) return;
        handleGenerateQuery(
            clarification.question,
            clarification.clarificationSessionId,
            optionId
        );
    };

    const handleSelectHistoryItem = (item: HistoryItemSummary) => {
        setPrompt(item.question);
        setIsHistoryOpen(false);
        setAriaLiveMessage(`Loaded query: ${item.question}`);

        // Fetch full artifact preview
        fetch(`/api/v1/queries/${encodeURIComponent(item.artifactId)}`, {
            credentials: "include",
        })
            .then((res) => (res.ok ? res.json() : null))
            .then((data: QueryGenerationResponse | null) => {
                if (data) {
                    setGenerationResponse(data);
                }
            })
            .catch(() => {});
    };

    if (authLoading) {
        return (
            <div className="loading-screen">
                <div className="loading-spinner">Verifying session...</div>
            </div>
        );
    }

    return (
        <div className="app-container">
            {/* Screen Reader ARIA live region */}
            <div className="sr-only" role="status" aria-live="polite">
                {ariaLiveMessage}
            </div>

            <Header onOpenHistory={() => setIsHistoryOpen(true)} />

            {user ? (
                /* Authenticated Analyst Workspace */
                <main className="workspace-main">
                    <ProviderSelector
                        selectedProvider={selectedProvider}
                        onSelectProvider={(p) => setSelectedProvider(p)}
                        disabled={generating}
                    />

                    <QueryInputBar
                        prompt={prompt}
                        onPromptChange={setPrompt}
                        onSubmit={() => handleGenerateQuery()}
                        loading={generating}
                        error={generationError}
                    />

                    <SqlPreviewPanel
                        generationResponse={generationResponse}
                        loading={generating}
                    />

                    <ClarificationModal
                        isOpen={isClarificationOpen}
                        clarification={clarification}
                        onSelectOption={handleClarificationSelection}
                        onClose={() => setIsClarificationOpen(false)}
                        submitting={generating}
                    />

                    <QueryHistoryPanel
                        isOpen={isHistoryOpen}
                        onClose={() => setIsHistoryOpen(false)}
                        onSelectHistoryItem={handleSelectHistoryItem}
                    />
                </main>
            ) : (
                /* Unauthenticated Empty State */
                <main className="unauth-workspace">
                    <div className="empty-state-card">
                        <div className="empty-state-icon">🔒</div>
                        <h2>Authentication Required</h2>
                        <p>Sign in to access your protected SQL query workspace and session history.</p>
                        <button
                            className="action-btn"
                            onClick={() => setIsUserModalOpen(true)}
                        >
                            Select Demo User to Sign In
                        </button>
                    </div>

                    <UserSwitcherModal
                        isOpen={isUserModalOpen}
                        onClose={() => setIsUserModalOpen(false)}
                    />
                </main>
            )}

            <footer className="app-statusbar">
                <div className="status-group">
                    <div
                        id="backend-status-pill"
                        className={`status-pill ${apiStatus ? "online" : connecting ? "" : "offline"}`}
                    >
                        <span>●</span>
                        <span>
                            {connecting
                                ? "Connecting to API..."
                                : apiStatus
                                    ? `Fastify API: Connected (v${apiStatus.version})`
                                    : "Fastify API: Offline"}
                        </span>
                    </div>

                    <div className="status-pill">
                        <span>Schema Grounding:</span>
                        <span style={{ color: "#38bdf8" }}>v1-allowlisted</span>
                    </div>

                    <div className="status-pill">
                        <span>Glossary:</span>
                        <span style={{ color: "#a78bfa" }}>v1.0.0</span>
                    </div>
                </div>

                <div className="status-group">
                    <div className="status-pill">
                        <span>Persona:</span>
                        <span style={{ color: user ? "#10b981" : "#9ca3af" }}>
                            {user ? `${user.displayName} [${user.role.toUpperCase()}]` : "GUEST"}
                        </span>
                    </div>
                </div>
            </footer>
        </div>
    );
}

export function App() {
    return (
        <AuthProvider>
            <MainWorkspace />
        </AuthProvider>
    );
}

export default App;
