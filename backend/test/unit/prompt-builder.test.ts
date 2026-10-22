import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PromptBuilder } from "../../src/modules/generation/prompts/prompt-builder.js";
import { PROMPT_VERSION } from "../../src/modules/generation/prompts/system-prompt.js";
import { GLOSSARY_VERSION } from "@text2sql/contracts";

describe("Task 5: Versioned Prompt Templates & Schema Grounding Context Builder (US-06)", () => {
    const builder = new PromptBuilder();
    const anchorDate = new Date("2026-10-01T00:00:00.000Z");

    it("assembles complete grounded prompt with schema, glossary, temporal, and user question", async () => {
        const result = await builder.buildPrompt(
            "What was our revenue last month?",
            { anchorDate }
        );

        // Metadata checks
        assert.equal(result.metadata.promptVersion, PROMPT_VERSION);
        assert.equal(result.metadata.glossaryVersion, GLOSSARY_VERSION);
        assert.ok(result.metadata.schemaVersion.startsWith("v1-"));
        assert.ok(result.metadata.estimatedTokens > 100);

        // System prompt rules
        assert.ok(result.systemPrompt.includes("READ-ONLY SELECT ONLY"));
        assert.ok(result.systemPrompt.includes("SELECT *\" is strictly forbidden"));
        assert.ok(result.systemPrompt.includes("MANDATORY LIMIT"));

        // Grounding sections in user prompt
        assert.ok(result.userPrompt.includes("### Database Schema"));
        assert.ok(result.userPrompt.includes("#### Table: `customers`"));
        assert.ok(result.userPrompt.includes("#### Table: `orders`"));
        assert.ok(result.userPrompt.includes("Total Recognized Revenue (`revenue`)"));
        assert.ok(result.userPrompt.includes("SUM(oi.quantity * oi.unit_price)"));
        assert.ok(result.userPrompt.includes("2026-09-01T00:00:00.000Z"));
        assert.ok(result.userPrompt.includes('Question: "What was our revenue last month?"'));
    });

    it("injects clarification context when provided", async () => {
        const result = await builder.buildPrompt(
            "Top customers",
            {
                anchorDate,
                clarificationContext: "User selected metric: Total Recognized Revenue (revenue).",
            }
        );

        assert.ok(result.userPrompt.includes("### Prior Clarification Context"));
        assert.ok(result.userPrompt.includes("Total Recognized Revenue (revenue)"));
    });
});
