import { z } from "zod";

// ==========================================
// 1. Intent Slot Extraction Schemas
// ==========================================

export const AggregationTypeSchema = z.enum([
    "SUM",
    "AVG",
    "COUNT",
    "COUNT_DISTINCT",
    "MIN",
    "MAX",
    "NONE",
]);
export type AggregationType = z.infer<typeof AggregationTypeSchema>;

export const SortDirectionSchema = z.enum(["ASC", "DESC"]);
export type SortDirection = z.infer<typeof SortDirectionSchema>;

export const SortSlotSchema = z.object({
    column: z.string().min(1),
    direction: SortDirectionSchema.default("DESC"),
});
export type SortSlot = z.infer<typeof SortSlotSchema>;

export const FilterSlotSchema = z.object({
    column: z.string().min(1),
    operator: z.enum([
        "=",
        "!=",
        ">",
        ">=",
        "<",
        "<=",
        "LIKE",
        "ILIKE",
        "IN",
        "NOT IN",
        "BETWEEN",
        "IS NULL",
        "IS NOT NULL",
    ]),
    value: z.unknown(),
    rawExpression: z.string().optional(),
});
export type FilterSlot = z.infer<typeof FilterSlotSchema>;

export const TemporalSlotSchema = z.object({
    startDate: z.string().optional(), // ISO-8601 string
    endDate: z.string().optional(),   // ISO-8601 string
    timezone: z.string().default("UTC"),
    grain: z.enum(["hour", "day", "week", "month", "quarter", "year"]).optional(),
    rawExpression: z.string().optional(), // e.g. "last quarter", "yesterday"
});
export type TemporalSlot = z.infer<typeof TemporalSlotSchema>;

export const IntentSlotsSchema = z.object({
    metric: z.string().optional(),                // e.g. "revenue", "order_count"
    aggregation: AggregationTypeSchema.default("NONE"),
    dimensions: z.array(z.string()).default([]),  // e.g. ["customers.id", "orders.status"]
    filters: z.array(FilterSlotSchema).default([]),
    temporal: TemporalSlotSchema.optional(),
    sort: SortSlotSchema.optional(),
    rowLimit: z.number().int().positive().optional(),
    rawQuestion: z.string().min(1),
});
export type IntentSlots = z.infer<typeof IntentSlotsSchema>;

// ==========================================
// 2. Semantic Violation Codes & Severities
// ==========================================

export const SemanticViolationCodeSchema = z.enum([
    "WRONG_AGGREGATION",
    "MISSING_DATE_FILTER",
    "INVALID_DATE_BOUNDS",
    "UNHANDLED_ORDER_STATUS",
    "JOIN_FANOUT_DUPLICATION",
    "UNRESOLVED_INTENT_SLOT",
    "GLOSSARY_FORMULA_MISMATCH",
    "AMBIGUOUS_GRAIN",
    "UNBOUNDED_GROUPING",
]);
export type SemanticViolationCode = z.infer<typeof SemanticViolationCodeSchema>;

export const SemanticSeveritySchema = z.enum(["CRITICAL", "WARNING", "INFO"]);
export type SemanticSeverity = z.infer<typeof SemanticSeveritySchema>;

// ==========================================
// 3. Semantic Finding Schema
// ==========================================

export const SemanticFindingSchema = z.object({
    code: SemanticViolationCodeSchema,
    severity: SemanticSeveritySchema,
    message: z.string().min(1),
    field: z.string().optional(),
    expected: z.string().optional(),
    actual: z.string().optional(),
    repairable: z.boolean().default(false),
    suggestion: z.string().optional(),
});
export type SemanticFinding = z.infer<typeof SemanticFindingSchema>;

// ==========================================
// 4. Semantic Validation Result Schema
// ==========================================

export const SemanticValidationResultSchema = z.object({
    isValid: z.boolean(), // true if criticalCount === 0
    findings: z.array(SemanticFindingSchema).default([]),
    intentSlots: IntentSlotsSchema,
    criticalCount: z.number().int().nonnegative().default(0),
    warningCount: z.number().int().nonnegative().default(0),
    infoCount: z.number().int().nonnegative().default(0),
    hasRepairableFindings: z.boolean().default(false),
    summary: z.string(),
});
export type SemanticValidationResult = z.infer<typeof SemanticValidationResultSchema>;

// ==========================================
// 5. Bounded Repair Result Schema
// ==========================================

export const SemanticRepairAttemptSchema = z.object({
    attemptNumber: z.number().int().min(1).max(1),
    originalSql: z.string(),
    repairedSql: z.string(),
    resolvedCodes: z.array(SemanticViolationCodeSchema).default([]),
    remainingFindings: z.array(SemanticFindingSchema).default([]),
    success: z.boolean(),
});
export type SemanticRepairAttempt = z.infer<typeof SemanticRepairAttemptSchema>;
