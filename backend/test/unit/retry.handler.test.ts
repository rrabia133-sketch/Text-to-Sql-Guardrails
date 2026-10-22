import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    GenerationRetryHandler,
    GenerationValidationFailedError,
} from "../../src/modules/generation/retry.handler.js";
import type { ILLMProvider, ProviderRawResponse } from "../../src/modules/providers/provider.interface.js";

describe("Task 12: Bounded Generation Retry Handler & Deadline Manager (US-06)", () => {
    it("returns immediately on first attempt when response is valid", async () => {
        let callCount = 0;
        const mockProvider: ILLMProvider = {
            getModelInfo: () => ({ provider: "ollama", model: "qwen2.5-coder:7b", isLocal: true }),
            checkHealth: async () => true,
            generate: async () => {
                callCount++;
                return {
                    rawText: JSON.stringify({
                        sql: "SELECT id, name FROM customers LIMIT 10;",
                        assumptions: [],
                        referencedTables: ["customers"],
                        referencedColumns: ["customers.id", "customers.name"],
                        explanation: "Returns 10 customers.",
                    }),
                    promptTokens: 100,
                    completionTokens: 40,
                    latencyMs: 150,
                    model: "qwen2.5-coder:7b",
                    provider: "ollama",
                };
            },
        };

        const handler = new GenerationRetryHandler();
        const result = await handler.execute(mockProvider, "Show customers");

        assert.equal(callCount, 1);
        assert.equal(result.attempts, 1);
        assert.equal(result.output.sql, "SELECT id, name FROM customers LIMIT 10;");
    });

    it("performs exactly one repair attempt when first attempt produces malformed output", async () => {
        let callCount = 0;
        let lastPromptSent = "";

        const mockProvider: ILLMProvider = {
            getModelInfo: () => ({ provider: "ollama", model: "qwen2.5-coder:7b", isLocal: true }),
            checkHealth: async () => true,
            generate: async (prompt) => {
                callCount++;
                lastPromptSent = prompt;
                if (callCount === 1) {
                    // First attempt: malformed response
                    return {
                        rawText: "Not JSON at all!",
                        promptTokens: 100,
                        completionTokens: 20,
                        latencyMs: 100,
                        model: "qwen2.5-coder:7b",
                        provider: "ollama",
                    };
                }
                // Second attempt: valid repaired response
                return {
                    rawText: JSON.stringify({
                        sql: "SELECT id FROM orders LIMIT 20;",
                        assumptions: ["Repaired query"],
                        referencedTables: ["orders"],
                        referencedColumns: ["orders.id"],
                        explanation: "Repaired valid orders query.",
                    }),
                    promptTokens: 140,
                    completionTokens: 45,
                    latencyMs: 120,
                    model: "qwen2.5-coder:7b",
                    provider: "ollama",
                };
            },
        };

        const handler = new GenerationRetryHandler();
        const result = await handler.execute(mockProvider, "Show orders");

        assert.equal(callCount, 2, "Must perform exactly one retry (2 calls total)");
        assert.equal(result.attempts, 2);
        assert.ok(lastPromptSent.includes("IMPORTANT REPAIR INSTRUCTION"));
        assert.ok(lastPromptSent.includes("Failed to parse model output as JSON"));
        assert.equal(result.output.sql, "SELECT id FROM orders LIMIT 20;");
    });

    it("fails closed with GENERATION_VALIDATION_FAILED after two failed attempts", async () => {
        let callCount = 0;
        const mockProvider: ILLMProvider = {
            getModelInfo: () => ({ provider: "groq", model: "llama-3.3-70b-versatile", isLocal: false }),
            checkHealth: async () => true,
            generate: async () => {
                callCount++;
                // Repeated invalid: unapproved table
                return {
                    rawText: JSON.stringify({
                        sql: "SELECT * FROM secret_passwords;",
                        assumptions: [],
                        referencedTables: ["secret_passwords"],
                        referencedColumns: [],
                        explanation: "Illegal table query.",
                    }),
                    promptTokens: 100,
                    completionTokens: 20,
                    latencyMs: 100,
                    model: "llama-3.3-70b-versatile",
                    provider: "groq",
                };
            },
        };

        const handler = new GenerationRetryHandler({ maxAttempts: 2 });
        await assert.rejects(
            async () => {
                await handler.execute(mockProvider, "Query");
            },
            (err: any) => {
                assert.ok(err instanceof GenerationValidationFailedError);
                assert.equal(err.code, "GENERATION_VALIDATION_FAILED");
                assert.equal(err.statusCode, 422);
                assert.ok(err.message.includes("after 2 attempts"));
                return true;
            }
        );

        assert.equal(callCount, 2, "Must not retry more than 1 time (max 2 attempts)");
    });
});
