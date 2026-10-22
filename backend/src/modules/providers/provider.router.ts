import { config } from "../../config/env.js";
import type { ProviderType, ProviderMode, ProviderSummaryResponse, ProviderInfo } from "@text2sql/contracts";
import type { ILLMProvider } from "./provider.interface.js";
import { OllamaProvider } from "./ollama.provider.js";
import { GroqProvider } from "./groq.provider.js";
import { BudgetService } from "./budget.service.js";
import { PolicyViolationError, ProviderNetworkError } from "./base.provider.js";

export interface ProviderRouterOptions {
    mode?: ProviderMode;
    ollamaProvider?: OllamaProvider;
    groqProvider?: GroqProvider;
    budgetService?: BudgetService;
}

export class ProviderRouter {
    private mode: ProviderMode;
    private ollamaProvider: OllamaProvider;
    private groqProvider: GroqProvider;
    private budgetService: BudgetService;

    constructor(options: ProviderRouterOptions = {}) {
        this.mode = options.mode || (config.PROVIDER_MODE as ProviderMode) || "local";
        this.ollamaProvider = options.ollamaProvider || new OllamaProvider();
        this.groqProvider = options.groqProvider || new GroqProvider();
        this.budgetService = options.budgetService || new BudgetService();
    }

    getMode(): ProviderMode {
        return this.mode;
    }

    getBudgetService(): BudgetService {
        return this.budgetService;
    }

    /**
     * Resolves the appropriate LLM provider enforcing privacy airgap policies.
     * In 'local' mode:
     *   - Unconditionally rejects Groq requests with PolicyViolationError.
     *   - If Ollama is down, returns 503 error; NEVER falls back silently to cloud.
     */
    async resolveProvider(userPreference?: ProviderType): Promise<ILLMProvider> {
        // 1. LOCAL AIRGAP MODE
        if (this.mode === "local") {
            if (userPreference === "groq") {
                throw new PolicyViolationError(
                    "Cloud provider (Groq) is strictly prohibited in local airgap mode (PROVIDER_MODE=local)."
                );
            }

            const isOllamaUp = await this.ollamaProvider.checkHealth();
            if (!isOllamaUp) {
                throw new ProviderNetworkError(
                    "ollama",
                    "Local Ollama daemon is unreachable. Local airgap policy prohibits fallback to cloud."
                );
            }

            return this.ollamaProvider;
        }

        // 2. CLOUD EXCLUSIVE MODE
        if (this.mode === "cloud") {
            if (userPreference === "ollama") {
                throw new PolicyViolationError(
                    "Local provider (Ollama) is disabled in cloud-only mode (PROVIDER_MODE=cloud)."
                );
            }

            // Enforce budget before egress
            await this.budgetService.checkBudgetOrThrow("groq");

            const isGroqUp = await this.groqProvider.checkHealth();
            if (!isGroqUp) {
                throw new ProviderNetworkError(
                    "groq",
                    "Groq cloud API service is unreachable or credentials invalid."
                );
            }

            return this.groqProvider;
        }

        // 3. HYBRID MODE
        if (userPreference === "groq") {
            await this.budgetService.checkBudgetOrThrow("groq");
            const isGroqUp = await this.groqProvider.checkHealth();
            if (!isGroqUp) {
                throw new ProviderNetworkError("groq", "Requested cloud provider (Groq) is currently unavailable.");
            }
            return this.groqProvider;
        }

        if (userPreference === "ollama") {
            const isOllamaUp = await this.ollamaProvider.checkHealth();
            if (!isOllamaUp) {
                throw new ProviderNetworkError("ollama", "Requested local provider (Ollama) is currently unreachable.");
            }
            return this.ollamaProvider;
        }

        // Hybrid default: prefer local Ollama if healthy, else groq if budget permits
        const isOllamaUp = await this.ollamaProvider.checkHealth();
        if (isOllamaUp) {
            return this.ollamaProvider;
        }

        // Only fallback to cloud in hybrid mode if local is down AND budget permits
        await this.budgetService.checkBudgetOrThrow("groq");
        const isGroqUp = await this.groqProvider.checkHealth();
        if (isGroqUp) {
            return this.groqProvider;
        }

        throw new ProviderNetworkError("hybrid", "All configured LLM providers (Ollama, Groq) are currently unavailable.");
    }

    /**
     * Lists available providers and current budget status without revealing secrets.
     */
    async getAvailableProviders(): Promise<ProviderSummaryResponse> {
        const allowedProviders: ProviderType[] = [];
        const providerInfos: ProviderInfo[] = [];

        const [ollamaHealthy, groqHealthy, budgetStatus] = await Promise.all([
            this.ollamaProvider.checkHealth().catch(() => false),
            this.groqProvider.checkHealth().catch(() => false),
            this.budgetService.getBudgetStatus(),
        ]);

        if (this.mode === "local" || this.mode === "hybrid") {
            allowedProviders.push("ollama");
            providerInfos.push({
                provider: "ollama",
                name: "Ollama Local (Airgapped)",
                model: this.ollamaProvider.getModelInfo().model,
                mode: this.mode,
                status: ollamaHealthy ? "online" : "offline",
                isLocal: true,
                description: "Private zero-egress local inference model running on loopback.",
            });
        }

        if (this.mode === "cloud" || this.mode === "hybrid") {
            allowedProviders.push("groq");
            let groqStatus: ProviderInfo["status"] = groqHealthy ? "online" : "offline";
            if (budgetStatus.isCapReached) {
                groqStatus = "quota_exceeded";
            }

            providerInfos.push({
                provider: "groq",
                name: "Groq Cloud (Llama 3.3 70B)",
                model: this.groqProvider.getModelInfo().model,
                mode: this.mode,
                status: groqStatus,
                isLocal: false,
                description: "Fast cloud inference with token budget caps and data minimization.",
            });
        }

        return {
            activeMode: this.mode,
            allowedProviders,
            providers: providerInfos,
            dailyBudget: budgetStatus,
        };
    }
}
