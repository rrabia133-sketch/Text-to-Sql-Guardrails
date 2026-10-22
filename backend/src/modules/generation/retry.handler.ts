import type { ILLMProvider, GenerationOptions } from "../providers/provider.interface.js";
import { OutputValidator, type ValidationResult } from "./output-validator.js";
import type { StructuredGenerationOutput } from "@text2sql/contracts";
import { ProviderTimeoutError, ProviderError } from "../providers/base.provider.js";

export class GenerationValidationFailedError extends ProviderError {
    readonly validationDetails: unknown;

    constructor(message: string, provider: string, details?: unknown) {
        super(
            message,
            provider,
            "GENERATION_VALIDATION_FAILED",
            422 // Unprocessable Entity
        );
        this.validationDetails = details;
    }
}

export interface GenerationResult {
    output: StructuredGenerationOutput;
    attempts: number;
    promptTokens: number;
    completionTokens: number;
    totalLatencyMs: number;
    provider: string;
    model: string;
}

export interface RetryHandlerOptions {
    maxAttempts?: number; // Default: 2 (1 initial + 1 repair attempt)
    totalDeadlineMs?: number; // Default: 45000ms
    validator?: OutputValidator;
}

export class GenerationRetryHandler {
    private validator: OutputValidator;
    private maxAttempts: number;
    private totalDeadlineMs: number;

    constructor(options: RetryHandlerOptions = {}) {
        this.validator = options.validator || new OutputValidator();
        this.maxAttempts = options.maxAttempts ?? 2;
        this.totalDeadlineMs = options.totalDeadlineMs ?? 45000;
    }

    /**
     * Executes bounded generation with at most ONE repair retry upon schema/JSON validation error.
     */
    async execute(
        provider: ILLMProvider,
        initialPrompt: string,
        options: GenerationOptions = {}
    ): Promise<GenerationResult> {
        const startTime = Date.now();
        const deadline = startTime + this.totalDeadlineMs;

        let accumulatedPromptTokens = 0;
        let accumulatedCompletionTokens = 0;
        let attempts = 0;

        let currentPrompt = initialPrompt;
        let lastValidationResult: ValidationResult | null = null;
        const modelInfo = provider.getModelInfo();

        while (attempts < this.maxAttempts) {
            attempts++;
            const remainingBudgetMs = deadline - Date.now();
            if (remainingBudgetMs <= 0) {
                throw new ProviderTimeoutError(modelInfo.provider, this.totalDeadlineMs);
            }

            const perAttemptTimeout = Math.min(
                options.timeoutMs ?? remainingBudgetMs,
                remainingBudgetMs
            );

            const rawResponse = await provider.generate(currentPrompt, {
                ...options,
                timeoutMs: perAttemptTimeout,
            });

            accumulatedPromptTokens += rawResponse.promptTokens;
            accumulatedCompletionTokens += rawResponse.completionTokens;

            const validation = this.validator.validate(rawResponse.rawText);
            if (validation.valid) {
                return {
                    output: validation.data,
                    attempts,
                    promptTokens: accumulatedPromptTokens,
                    completionTokens: accumulatedCompletionTokens,
                    totalLatencyMs: Date.now() - startTime,
                    provider: rawResponse.provider,
                    model: rawResponse.model,
                };
            }

            lastValidationResult = validation;

            // If we have not exhausted our single retry, craft repair prompt
            if (attempts < this.maxAttempts) {
                currentPrompt = `${initialPrompt}\n\n---\nIMPORTANT REPAIR INSTRUCTION: Your previous response was rejected due to a critical validation error:\n${validation.reason}\n\nPlease regenerate the JSON response correcting this error immediately. Output ONLY the compliant JSON object.`;
            }
        }

        // Fail closed on repeated validation failure
        throw new GenerationValidationFailedError(
            `Generation failed validation after ${attempts} attempts: ${lastValidationResult ? (lastValidationResult as any).reason : "Unknown error"}`,
            modelInfo.provider,
            lastValidationResult ? (lastValidationResult as any).details : undefined
        );
    }
}
