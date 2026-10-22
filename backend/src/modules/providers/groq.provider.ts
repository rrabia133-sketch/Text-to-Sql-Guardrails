import { BaseProvider, ProviderQuotaError, ProviderNetworkError, ProviderInvalidResponseError } from "./base.provider.js";
import type {
    GenerationOptions,
    ProviderRawResponse,
    ModelInfo,
} from "./provider.interface.js";
import { config } from "../../config/env.js";

export interface GroqProviderOptions {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    timeoutMs?: number;
    fetchFn?: typeof fetch;
}

export class GroqProvider extends BaseProvider {
    private apiKey: string;
    private model: string;
    private baseUrl: string;
    private fetchFn: typeof fetch;

    constructor(options: GroqProviderOptions = {}) {
        super(options.timeoutMs ?? config.GENERATION_TIMEOUT_CLOUD_MS);
        this.apiKey = options.apiKey ?? config.GROQ_API_KEY;
        this.model = options.model || config.GROQ_MODEL || "llama-3.3-70b-versatile";
        this.baseUrl = (options.baseUrl || "https://api.groq.com/openai/v1").replace(/\/$/, "");
        this.fetchFn = options.fetchFn || fetch;
    }

    getModelInfo(): ModelInfo {
        return {
            provider: "groq",
            model: this.model,
            isLocal: false,
        };
    }

    async checkHealth(): Promise<boolean> {
        if (!this.apiKey || this.apiKey.trim().length === 0) {
            return false;
        }

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);
            const res = await this.fetchFn(`${this.baseUrl}/models`, {
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                },
                signal: controller.signal,
            });
            clearTimeout(timeout);
            return res.ok;
        } catch {
            return false;
        }
    }

    protected async executeCompletion(
        prompt: string,
        options: GenerationOptions,
        signal: AbortSignal
    ): Promise<ProviderRawResponse> {
        if (!this.apiKey || this.apiKey.trim().length === 0) {
            throw new ProviderInvalidResponseError(
                "groq",
                "GROQ_API_KEY is not configured on the server"
            );
        }

        const messages: Array<{ role: string; content: string }> = [];
        if (options.systemPrompt) {
            messages.push({ role: "system", content: options.systemPrompt });
        }
        messages.push({ role: "user", content: prompt });

        const payload = {
            model: this.model,
            messages,
            response_format: { type: "json_object" }, // Native JSON object mode
            temperature: options.temperature ?? 0.1,
        };

        let res: Response;
        try {
            res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify(payload),
                signal,
            });
        } catch (fetchErr: any) {
            const safeMsg = this.sanitizeErrorMessage(fetchErr?.message || String(fetchErr));
            if (safeMsg.includes("ECONNREFUSED") || safeMsg.includes("fetch failed") || safeMsg.includes("ENOTFOUND")) {
                throw new ProviderNetworkError("groq", safeMsg);
            }
            throw fetchErr;
        }

        if (res.status === 429) {
            throw new ProviderQuotaError("groq", "Groq cloud rate limit or quota exceeded (HTTP 429)");
        }

        if (!res.ok) {
            const rawErr = await res.text().catch(() => "");
            const safeErr = this.sanitizeErrorMessage(rawErr);
            throw new ProviderInvalidResponseError("groq", `Groq HTTP ${res.status}: ${safeErr}`);
        }

        const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
            };
        };

        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== "string") {
            throw new ProviderInvalidResponseError("groq", "Missing message content in Groq API response");
        }

        return {
            rawText: content,
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0,
            latencyMs: 0, // BaseProvider fills latencyMs
            model: this.model,
            provider: "groq",
        };
    }

    /**
     * Strictly redacts API keys and sensitive tokens from error messages and logs.
     */
    private sanitizeErrorMessage(msg: string): string {
        if (!this.apiKey) return msg;
        return msg.split(this.apiKey).join("[REDACTED_API_KEY]");
    }
}
