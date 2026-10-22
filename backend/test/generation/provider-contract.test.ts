import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OllamaProvider } from "../../src/modules/providers/ollama.provider.js";
import { GroqProvider } from "../../src/modules/providers/groq.provider.js";
import {
    StructuredGenerationOutputSchema,
    type ProviderRawResponse,
} from "@text2sql/contracts";
import { OutputValidator } from "../../src/modules/generation/output-validator.js";

describe("Task 17: Provider Contract Equivalence & Output Conformance (US-06 / US-08)", () => {
    const validator = new OutputValidator();

    const mockSqlPayload = {
        sql: "SELECT id, name, region FROM customers WHERE region = 'West' LIMIT 50;",
        assumptions: ["Filtering on region 'West'"],
        referencedTables: ["customers"],
        referencedColumns: ["customers.id", "customers.name", "customers.region"],
        explanation: "Lists customers located in the West region.",
    };

    const mockOllamaFetch: typeof fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
            response: JSON.stringify(mockSqlPayload),
            prompt_eval_count: 100,
            eval_count: 50,
            total_duration: 250_000_000,
        }),
    } as any);

    const mockGroqFetch: typeof fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
            choices: [{ message: { content: JSON.stringify(mockSqlPayload) } }],
            usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150,
            },
        }),
    } as any);

    it("verifies Ollama and Groq adapters return identical ProviderRawResponse structure", async () => {
        const ollama = new OllamaProvider({ fetchFn: mockOllamaFetch });
        const groq = new GroqProvider({ apiKey: "gsk_test", fetchFn: mockGroqFetch });

        const ollamaRes: ProviderRawResponse = await ollama.generate("Show customers in West");
        const groqRes: ProviderRawResponse = await groq.generate("Show customers in West");

        const expectedKeys = ["rawText", "promptTokens", "completionTokens", "latencyMs", "model", "provider"].sort();
        assert.deepEqual(Object.keys(ollamaRes).sort(), expectedKeys);
        assert.deepEqual(Object.keys(groqRes).sort(), expectedKeys);

        assert.equal(typeof ollamaRes.rawText, "string");
        assert.equal(typeof groqRes.rawText, "string");
        assert.equal(typeof ollamaRes.promptTokens, "number");
        assert.equal(typeof groqRes.promptTokens, "number");
        assert.equal(typeof ollamaRes.completionTokens, "number");
        assert.equal(typeof groqRes.completionTokens, "number");
        assert.equal(typeof ollamaRes.latencyMs, "number");
        assert.equal(typeof groqRes.latencyMs, "number");
    });

    it("verifies structured model outputs from both providers validate cleanly against contract schema", async () => {
        const ollama = new OllamaProvider({ fetchFn: mockOllamaFetch });
        const groq = new GroqProvider({ apiKey: "gsk_test", fetchFn: mockGroqFetch });

        const [ollamaRaw, groqRaw] = await Promise.all([
            ollama.generate("Show customers in West"),
            groq.generate("Show customers in West"),
        ]);

        const ollamaValidation = validator.validate(ollamaRaw.rawText);
        const groqValidation = validator.validate(groqRaw.rawText);

        assert.equal(ollamaValidation.valid, true);
        assert.equal(groqValidation.valid, true);

        if (ollamaValidation.valid && groqValidation.valid) {
            // Verify Zod schema conformance
            assert.doesNotThrow(() => StructuredGenerationOutputSchema.parse(ollamaValidation.data));
            assert.doesNotThrow(() => StructuredGenerationOutputSchema.parse(groqValidation.data));

            assert.equal(ollamaValidation.data.sql, groqValidation.data.sql);
            assert.deepEqual(ollamaValidation.data.referencedTables, groqValidation.data.referencedTables);
        }
    });

    it("verifies provider metadata contracts (getModelInfo)", () => {
        const ollama = new OllamaProvider({ model: "qwen2.5-coder:7b" });
        const groq = new GroqProvider({ apiKey: "gsk_test", model: "llama-3.3-70b-versatile" });

        const ollamaInfo = ollama.getModelInfo();
        assert.equal(ollamaInfo.provider, "ollama");
        assert.equal(ollamaInfo.model, "qwen2.5-coder:7b");
        assert.equal(ollamaInfo.isLocal, true);

        const groqInfo = groq.getModelInfo();
        assert.equal(groqInfo.provider, "groq");
        assert.equal(groqInfo.model, "llama-3.3-70b-versatile");
        assert.equal(groqInfo.isLocal, false);
    });
});
