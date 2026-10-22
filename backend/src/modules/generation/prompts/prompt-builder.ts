import { SYSTEM_PROMPT, PROMPT_VERSION } from "./system-prompt.js";
import { GLOSSARY_VERSION, formatGlossaryForPrompt, BUSINESS_GLOSSARY } from "@text2sql/contracts";
import type { SanitizedCatalog } from "../../schema/schema.types.js";
import { SchemaService } from "../../schema/schema.service.js";
import { DateResolver, type DateResolutionResult } from "../../intent/date-resolver.js";

export interface GroundedPromptContext {
    systemPrompt: string;
    userPrompt: string;
    completePrompt: string;
    metadata: {
        promptVersion: string;
        schemaVersion: string;
        glossaryVersion: string;
        resolvedDates: DateResolutionResult;
        estimatedTokens: number;
    };
}

export interface PromptBuilderOptions {
    catalog?: SanitizedCatalog;
    anchorDate?: Date;
    clarificationContext?: string;
}

export class PromptBuilder {
    private schemaService: SchemaService;
    private dateResolver: DateResolver;

    constructor(schemaService?: SchemaService, dateResolver?: DateResolver) {
        this.schemaService = schemaService || new SchemaService();
        this.dateResolver = dateResolver || new DateResolver();
    }

    /**
     * Builds grounded prompt context injecting schema, glossary, date context, and question.
     */
    async buildPrompt(
        question: string,
        options: PromptBuilderOptions = {}
    ): Promise<GroundedPromptContext> {
        const catalog = options.catalog || (await this.schemaService.getSanitizedCatalog());
        const schemaContext = this.schemaService.formatForPrompt(catalog);
        const glossaryContext = formatGlossaryForPrompt(BUSINESS_GLOSSARY);
        const dateResult = this.dateResolver.resolve(question, options.anchorDate);

        let userPrompt = "";

        // 1. Schema Section
        userPrompt += `${schemaContext}\n\n`;

        // 2. Glossary Section
        userPrompt += `${glossaryContext}\n\n`;

        // 3. Temporal Context Section
        userPrompt += `### Temporal Grounding Context\n${dateResult.formattedContext}\n\n`;

        // 4. Clarification / Follow-up context (if applicable)
        if (options.clarificationContext) {
            userPrompt += `### Prior Clarification Context\n${options.clarificationContext}\n\n`;
        }

        // 5. User Question
        userPrompt += `### User Natural Language Analytical Request\nQuestion: "${question.trim()}"\n\n`;
        userPrompt += "Generate the structured JSON response complying with all PostgreSQL guardrails and business rules:";

        const completePrompt = `${SYSTEM_PROMPT}\n\n---\n\n${userPrompt}`;

        // Token budget estimation (~4 characters per token heuristic)
        const estimatedTokens = Math.ceil(completePrompt.length / 4);

        return {
            systemPrompt: SYSTEM_PROMPT,
            userPrompt,
            completePrompt,
            metadata: {
                promptVersion: PROMPT_VERSION,
                schemaVersion: catalog.schemaVersion,
                glossaryVersion: GLOSSARY_VERSION,
                resolvedDates: dateResult,
                estimatedTokens,
            },
        };
    }
}
