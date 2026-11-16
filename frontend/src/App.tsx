import { useState } from "react";
import { AuthProvider, useAuth } from "./features/auth/AuthContext";
import { Header } from "./components/Header";
import { UserSwitcherModal } from "./features/auth/UserSwitcherModal";
import { AuthWelcomeScreen } from "./features/auth/AuthWelcomeScreen";
import { ProviderSelector } from "./features/query/ProviderSelector";
import { QueryInputBar } from "./features/query/QueryInputBar";
import { SqlPreviewPanel } from "./features/query/SqlPreviewPanel";
import { ClarificationModal } from "./features/clarification/ClarificationModal";
import type {
    ProviderType,
    QueryGenerationResponse,
    ClarificationResponse,
} from "@text2sql/contracts";

function MainWorkspace() {
    const { user, loading: authLoading } = useAuth();
    const [isUserModalOpen, setIsUserModalOpen] = useState(false);

    // WCAG 2.2 AA ARIA Live Region State
    const [ariaLiveMessage, setAriaLiveMessage] = useState("");

    // Query Generation State
    const [prompt, setPrompt] = useState("What was our total revenue in September 2026?");
    const [selectedProvider, setSelectedProvider] = useState<ProviderType>("ollama");
    const [generating, setGenerating] = useState(false);
    const [generationError, setGenerationError] = useState<string | null>(null);
    const [generationResponse, setGenerationResponse] = useState<QueryGenerationResponse | null>(null);
    const [autoExecuteSeq, setAutoExecuteSeq] = useState(0);

    // Clarification Dialog State
    const [clarification, setClarification] = useState<ClarificationResponse | null>(null);
    const [isClarificationOpen, setIsClarificationOpen] = useState(false);

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
                setAutoExecuteSeq((prev) => prev + 1);
                setIsClarificationOpen(false);
                setClarification(null);
                setAriaLiveMessage(
                    `SQL generated with confidence band ${data.confidenceBand || "HIGH"}. Running query against database...`
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

    if (authLoading) {
        return (
            <div className="loading-screen">
                <div className="loading-spinner">Verifying session...</div>
            </div>
        );
    }

    return (
        <div className="app-container">
            <a href="#main-workspace" className="skip-link">
                Skip to workspace
            </a>

            {/* Screen Reader ARIA live region */}
            <div className="sr-only" role="status" aria-live="polite">
                {ariaLiveMessage}
            </div>

            <Header />

            {user ? (
                /* Authenticated Analyst Workspace */
                <main id="main-workspace" className="workspace-main">
                    <div className="workspace-sidebar">
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
                    </div>

                    <SqlPreviewPanel
                        generationResponse={generationResponse}
                        autoExecuteSeq={autoExecuteSeq}
                        loading={generating}
                    />

                    <ClarificationModal
                        isOpen={isClarificationOpen}
                        clarification={clarification}
                        onSelectOption={handleClarificationSelection}
                        onClose={() => setIsClarificationOpen(false)}
                        submitting={generating}
                    />
                </main>
            ) : (
                /* Unauthenticated Welcome & Sign-In Stage */
                <>
                    <AuthWelcomeScreen onOpenModal={() => setIsUserModalOpen(true)} />
                    <UserSwitcherModal
                        isOpen={isUserModalOpen}
                        onClose={() => setIsUserModalOpen(false)}
                    />
                </>
            )}
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
