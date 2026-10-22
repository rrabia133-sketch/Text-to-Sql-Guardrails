import { z } from "zod";
import { ProviderTypeSchema } from "./provider.js";

// ==========================================
// 1. Structured Model Output Contract (LLM JSON output)
// ==========================================

export const StructuredGenerationOutputSchema = z.object({
    sql: z.string().min(1, "Generated SQL cannot be empty"),
    assumptions: z.array(z.string()).default([]),
    referencedTables: z.array(z.string()).min(1, "At least one table must be referenced"),
    referencedColumns: z.array(z.string()).default([]),
    explanation: z.string().min(1, "Explanation cannot be empty"),
});

export type StructuredGenerationOutput = z.infer<typeof StructuredGenerationOutputSchema>;

// ==========================================
// 2. Request DTOs
// ==========================================

export const QueryGenerationRequestSchema = z.object({
    question: z
        .string()
        .min(1, "Question cannot be empty")
        .max(500, "Question cannot exceed 500 characters")
        .refine((val) => val.trim().length > 0, "Question cannot be only whitespace"),
    providerPreference: ProviderTypeSchema.optional(),
    clarificationSessionId: z.string().optional(),
    selectedClarificationOption: z.string().optional(),
});

export type QueryGenerationRequest = z.infer<typeof QueryGenerationRequestSchema>;

// ==========================================
// 3. Response DTOs
// ==========================================

export const ClarificationOptionSchema = z.object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    suggestedFilter: z.string().optional(),
});
export type ClarificationOption = z.infer<typeof ClarificationOptionSchema>;

export const ClarificationResponseSchema = z.object({
    type: z.literal("clarification"),
    question: z.string(),
    options: z.array(ClarificationOptionSchema),
    reasonCode: z.enum([
        "AMBIGUOUS_METRIC",
        "MISSING_TIME_BOUND",
        "UNSUPPORTED_DOMAIN",
        "MULTIPLE_INTERPRETATIONS",
    ]),
    clarificationSessionId: z.string(),
    message: z.string(),
});

export type ClarificationResponse = z.infer<typeof ClarificationResponseSchema>;

export const QueryGenerationResponseSchema = z.object({
    type: z.literal("generation"),
    artifactId: z.string(),
    status: z.literal("preview"),
    sql: z.string(),
    assumptions: z.array(z.string()),
    referencedTables: z.array(z.string()),
    referencedColumns: z.array(z.string()),
    explanation: z.string(),
    confidencePreview: z.number().min(0).max(1),
    provider: ProviderTypeSchema,
    model: z.string(),
    versions: z.object({
        promptVersion: z.string(),
        schemaVersion: z.string(),
        glossaryVersion: z.string(),
    }),
    createdAt: z.string(),
    expiresAt: z.string(),
});

export type QueryGenerationResponse = z.infer<typeof QueryGenerationResponseSchema>;

export type GenerationApiResponse = QueryGenerationResponse | ClarificationResponse;
