import { z } from "zod";

export const ProviderTypeSchema = z.enum(["ollama", "groq"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const ProviderModeSchema = z.enum(["local", "hybrid", "cloud"]);
export type ProviderMode = z.infer<typeof ProviderModeSchema>;

export const ProviderStatusSchema = z.enum(["online", "offline", "degraded", "quota_exceeded"]);
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

export const ProviderInfoSchema = z.object({
    provider: ProviderTypeSchema,
    name: z.string(),
    model: z.string(),
    mode: ProviderModeSchema,
    status: ProviderStatusSchema,
    isLocal: z.boolean(),
    latencyMs: z.number().optional(),
    description: z.string().optional(),
});
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;

export const ProviderSummaryResponseSchema = z.object({
    activeMode: ProviderModeSchema,
    allowedProviders: z.array(ProviderTypeSchema),
    providers: z.array(ProviderInfoSchema),
    dailyBudget: z.object({
        budgetLimitUsd: z.number(),
        spentTodayUsd: z.number(),
        remainingUsd: z.number(),
        isCapReached: z.boolean(),
    }),
});
export type ProviderSummaryResponse = z.infer<typeof ProviderSummaryResponseSchema>;
