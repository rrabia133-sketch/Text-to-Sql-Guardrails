import { BaseProvider } from "./base.provider.js";
import type {
    GenerationOptions,
    ProviderRawResponse,
    ModelInfo,
} from "./provider.interface.js";
import { config } from "../../config/env.js";

export interface OllamaProviderOptions {
    host?: string;
    model?: string;
    timeoutMs?: number;
    fetchFn?: typeof fetch;
}

export class OllamaProvider extends BaseProvider {
    private host: string;
    private model: string;
    private fetchFn: typeof fetch;

    constructor(options: OllamaProviderOptions = {}) {
        super(options.timeoutMs ?? config.GENERATION_TIMEOUT_LOCAL_MS);
        this.host = (options.host || config.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "");
        this.model = options.model || config.OLLAMA_MODEL || "qwen2.5-coder:7b";
        this.fetchFn = options.fetchFn || fetch;
    }

    getModelInfo(): ModelInfo {
        return {
            provider: "ollama",
            model: this.model,
            isLocal: true,
        };
    }

    async checkHealth(): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);
            const res = await this.fetchFn(`${this.host}/api/tags`, {
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!res.ok) return false;
            const data = (await res.json()) as { models?: Array<{ name: string }> };
            if (!Array.isArray(data.models)) return false;

            // Verify if target model (or prefix) is present
            const modelNameLower = this.model.toLowerCase();
            const hasModel = data.models.some((m) =>
                m.name.toLowerCase().startsWith(modelNameLower.split(":")[0])
            );
            return hasModel || data.models.length > 0;
        } catch {
            return false;
        }
    }

    protected async executeCompletion(
        prompt: string,
        options: GenerationOptions,
        signal: AbortSignal
    ): Promise<ProviderRawResponse> {
        const payload: Record<string, any> = {
            model: this.model,
            prompt: prompt,
            format: "json", // Native Ollama JSON grammar enforcement
            stream: false,
            options: {
                temperature: options.temperature ?? 0.1,
            },
        };

        if (options.systemPrompt) {
            payload.system = options.systemPrompt;
        }

        const res = await this.fetchFn(`${this.host}/api/generate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal,
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => "");
            throw new Error(`Ollama HTTP ${res.status}: ${errText}`);
        }

        const data = (await res.json()) as {
            response: string;
            prompt_eval_count?: number;
            eval_count?: number;
            total_duration?: number;
        };

        return {
            rawText: data.response,
            promptTokens: data.prompt_eval_count || 0,
            completionTokens: data.eval_count || 0,
            latencyMs: data.total_duration ? Math.round(data.total_duration / 1_000_000) : 0,
            model: this.model,
            provider: "ollama",
        };
    }
}
