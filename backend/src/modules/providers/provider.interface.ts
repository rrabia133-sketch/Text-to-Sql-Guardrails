import type { ProviderType } from "@text2sql/contracts";

export interface ProviderRawResponse {
    rawText: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    model: string;
    provider: ProviderType;
}

export interface GenerationOptions {
    timeoutMs?: number;
    systemPrompt?: string;
    signal?: AbortSignal;
    temperature?: number;
}

export interface ModelInfo {
    provider: ProviderType;
    model: string;
    isLocal: boolean;
}

export interface ILLMProvider {
    generate(prompt: string, options?: GenerationOptions): Promise<ProviderRawResponse>;
    checkHealth(): Promise<boolean>;
    getModelInfo(): ModelInfo;
}
