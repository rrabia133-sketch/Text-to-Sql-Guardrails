import type {
    ILLMProvider,
    ProviderRawResponse,
    GenerationOptions,
    ModelInfo,
} from "./provider.interface.js";

// ==========================================
// Standardized Provider Errors
// ==========================================

export class ProviderError extends Error {
    readonly provider: string;
    readonly code: string;
    readonly statusCode: number;

    constructor(message: string, provider: string, code: string, statusCode = 500) {
        super(message);
        this.name = this.constructor.name;
        this.provider = provider;
        this.code = code;
        this.statusCode = statusCode;
    }
}

export class ProviderTimeoutError extends ProviderError {
    constructor(provider: string, timeoutMs: number) {
        super(
            `Provider '${provider}' request timed out after ${timeoutMs}ms`,
            provider,
            "PROVIDER_TIMEOUT",
            504
        );
    }
}

export class ProviderQuotaError extends ProviderError {
    constructor(provider: string, message = "Daily cloud budget or rate quota exceeded") {
        super(message, provider, "PROVIDER_QUOTA_EXCEEDED", 429);
    }
}

export class ProviderNetworkError extends ProviderError {
    constructor(provider: string, message: string) {
        super(`Provider '${provider}' network connection failed: ${message}`, provider, "PROVIDER_NETWORK_ERROR", 503);
    }
}

export class ProviderInvalidResponseError extends ProviderError {
    constructor(provider: string, message: string) {
        super(`Provider '${provider}' returned an invalid response: ${message}`, provider, "PROVIDER_INVALID_RESPONSE", 502);
    }
}

export class PolicyViolationError extends ProviderError {
    constructor(message: string) {
        super(message, "policy-engine", "POLICY_VIOLATION", 403);
    }
}

// ==========================================
// Base Provider Abstract Class
// ==========================================

export abstract class BaseProvider implements ILLMProvider {
    protected defaultTimeoutMs: number;

    constructor(defaultTimeoutMs: number) {
        this.defaultTimeoutMs = defaultTimeoutMs;
    }

    abstract getModelInfo(): ModelInfo;
    abstract checkHealth(): Promise<boolean>;

    protected abstract executeCompletion(
        prompt: string,
        options: GenerationOptions,
        signal: AbortSignal
    ): Promise<ProviderRawResponse>;

    async generate(prompt: string, options: GenerationOptions = {}): Promise<ProviderRawResponse> {
        const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
        const controller = new AbortController();

        let timedOut = false;
        const timeoutHandle = setTimeout(() => {
            timedOut = true;
            controller.abort(new Error("Request timed out"));
        }, timeoutMs);

        // Forward external signal abort if provided
        if (options.signal) {
            options.signal.addEventListener("abort", () => {
                controller.abort(options.signal?.reason);
            });
        }

        const startTime = Date.now();
        const modelInfo = this.getModelInfo();

        try {
            const response = await this.executeCompletion(prompt, options, controller.signal);
            const latencyMs = Date.now() - startTime;

            return {
                ...response,
                latencyMs: response.latencyMs || latencyMs,
                promptTokens: response.promptTokens || this.estimateTokens(prompt),
                completionTokens: response.completionTokens || this.estimateTokens(response.rawText),
                model: response.model || modelInfo.model,
                provider: response.provider || modelInfo.provider,
            };
        } catch (error: any) {
            if (timedOut || error?.name === "AbortError" || controller.signal.aborted) {
                throw new ProviderTimeoutError(modelInfo.provider, timeoutMs);
            }
            if (error instanceof ProviderError) {
                throw error;
            }
            throw this.normalizeError(error, modelInfo.provider);
        } finally {
            clearTimeout(timeoutHandle);
        }
    }

    protected normalizeError(error: any, provider: string): ProviderError {
        const message = error?.message || String(error);
        if (message.includes("ECONNREFUSED") || message.includes("ENOTFOUND") || message.includes("fetch failed")) {
            return new ProviderNetworkError(provider, message);
        }
        if (message.includes("429") || message.includes("quota") || message.includes("rate limit")) {
            return new ProviderQuotaError(provider, message);
        }
        return new ProviderInvalidResponseError(provider, message);
    }

    /**
     * Fallback heuristic for estimating tokens (~4 characters per token).
     */
    protected estimateTokens(text: string): number {
        return Math.ceil((text || "").length / 4);
    }
}
