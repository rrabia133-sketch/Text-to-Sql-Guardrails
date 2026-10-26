import { z } from "zod";

// ==========================================
// 1. Guardrail Violation Codes
// ==========================================

export const GuardrailViolationCodeSchema = z.enum([
    "SYNTAX_ERROR",
    "MULTIPLE_STATEMENTS",
    "FORBIDDEN_STATEMENT_TYPE",
    "FORBIDDEN_TABLE",
    "FORBIDDEN_COLUMN",
    "FORBIDDEN_FUNCTION",
    "FORBIDDEN_CATALOG",
    "LOCKING_CLAUSE",
    "TRANSACTION_CONTROL",
    "ADMINISTRATIVE_COMMAND",
    "UNRESOLVED_IDENTIFIER",
    "UNSUPPORTED_NODE_TYPE",
    "WILDCARD_PROJECTION",
    "EXCESSIVE_PLAN_COST",
    "ROW_CAP_EXCEEDED",
]);

export type GuardrailViolationCode = z.infer<typeof GuardrailViolationCodeSchema>;

// ==========================================
// 2. Guardrail Severity Levels
// ==========================================

export const GuardrailSeveritySchema = z.enum(["CRITICAL", "WARNING", "INFO"]);
export type GuardrailSeverity = z.infer<typeof GuardrailSeveritySchema>;

// ==========================================
// 3. Guardrail Finding Details
// ==========================================

export const GuardrailLocationSchema = z.object({
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
});
export type GuardrailLocation = z.infer<typeof GuardrailLocationSchema>;

export const GuardrailFindingSchema = z.object({
    code: GuardrailViolationCodeSchema,
    severity: GuardrailSeveritySchema,
    message: z.string().min(1),
    nodeType: z.string().optional(),
    target: z.string().optional(),
    location: GuardrailLocationSchema.optional(),
});
export type GuardrailFinding = z.infer<typeof GuardrailFindingSchema>;

// Alias for backward compatibility
export type GuardrailViolation = GuardrailFinding;

// ==========================================
// 4. SQL Normalization Result Contract
// ==========================================

export const NormalizedSqlResultSchema = z.object({
    originalSql: z.string(),
    normalizedSql: z.string(),
    injectedLimit: z.number().int().positive().optional(),
    clampedLimit: z.number().int().positive().optional(),
    astModified: z.boolean(),
});
export type NormalizedSqlResult = z.infer<typeof NormalizedSqlResultSchema>;

// ==========================================
// 5. EXPLAIN Plan Cost Result Contract
// ==========================================

export const AstPlanCostResultSchema = z.object({
    totalCost: z.number().nonnegative(),
    maxAllowedCost: z.number().positive(),
    estimatedRows: z.number().nonnegative(),
    acceptable: z.boolean(),
    planNodes: z.array(z.string()).default([]),
});
export type AstPlanCostResult = z.infer<typeof AstPlanCostResultSchema>;

// ==========================================
// 6. AST Validation Metadata Contract
// ==========================================

export const AstValidationMetadataSchema = z.object({
    referencedTables: z.array(z.string()).default([]),
    referencedColumns: z.array(z.string()).default([]),
    functionCalls: z.array(z.string()).default([]),
    hasLimit: z.boolean().default(false),
    limitValue: z.number().int().positive().optional(),
    offsetValue: z.number().int().nonnegative().optional(),
    hasCte: z.boolean().default(false),
    planCost: AstPlanCostResultSchema.optional(),
});
export type AstValidationMetadata = z.infer<typeof AstValidationMetadataSchema>;

// ==========================================
// 7. Full Guardrail Validation Result Contract
// ==========================================

export const GuardrailValidationResultSchema = z.object({
    valid: z.boolean(),
    status: z.enum(["passed", "rejected"]),
    sql: z.string(),
    normalizedSql: z.string().optional(),
    findings: z.array(GuardrailFindingSchema).default([]),
    violations: z.array(GuardrailFindingSchema).default([]),
    metadata: AstValidationMetadataSchema.optional(),
});
export type GuardrailValidationResult = z.infer<typeof GuardrailValidationResultSchema>;
