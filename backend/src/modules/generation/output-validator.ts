import {
    StructuredGenerationOutputSchema,
    type StructuredGenerationOutput,
} from "@text2sql/contracts";
import { ALLOWED_TABLES, type AllowedTableName } from "../schema/schema.types.js";

export interface ValidationSuccess {
    valid: true;
    data: StructuredGenerationOutput;
}

export interface ValidationFailure {
    valid: false;
    reason: string;
    code: "MALFORMED_JSON" | "SCHEMA_VALIDATION_ERROR" | "FORBIDDEN_SQL_STATEMENT" | "UNAPPROVED_TABLE_REFERENCE";
    details?: unknown;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

export class OutputValidator {
    /**
     * Strips leading and trailing markdown fences (e.g. ```json ... ```).
     */
    cleanRawText(rawText: string): string {
        let cleaned = (rawText || "").trim();

        // Remove opening code fences
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, "");
        // Remove closing code fences
        cleaned = cleaned.replace(/\s*```$/i, "");

        return cleaned.trim();
    }

    /**
     * Validates raw LLM response text against structured output schemas and safety rules.
     */
    validate(rawText: string): ValidationResult {
        const cleaned = this.cleanRawText(rawText);

        // 1. JSON Parse
        let parsed: unknown;
        try {
            parsed = JSON.parse(cleaned);
        } catch (err: any) {
            return {
                valid: false,
                code: "MALFORMED_JSON",
                reason: `Failed to parse model output as JSON: ${err?.message || "Invalid syntax"}`,
            };
        }

        // 2. Schema Validation via Zod
        const schemaResult = StructuredGenerationOutputSchema.safeParse(parsed);
        if (!schemaResult.success) {
            const formattedErrors = schemaResult.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ");
            return {
                valid: false,
                code: "SCHEMA_VALIDATION_ERROR",
                reason: `Output structure does not match contract schema: ${formattedErrors}`,
                details: schemaResult.error.issues,
            };
        }

        const data = schemaResult.data;

        // 3. SQL Statement Type Verification
        // Strip SQL comments before checking statement prefix
        const strippedSql = data.sql
            .replace(/--.*$/gm, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .trim();

        const upperSql = strippedSql.toUpperCase();
        if (!upperSql.startsWith("SELECT") && !upperSql.startsWith("WITH")) {
            return {
                valid: false,
                code: "FORBIDDEN_SQL_STATEMENT",
                reason: "Generated SQL must be a read-only query starting with SELECT or WITH.",
            };
        }

        // Check for forbidden DDL / DML keywords in SQL
        const forbiddenKeywords = [
            "INSERT INTO",
            "UPDATE ",
            "DELETE FROM",
            "DROP TABLE",
            "DROP DATABASE",
            "TRUNCATE ",
            "ALTER TABLE",
            "CREATE TABLE",
            "GRANT ",
            "REVOKE ",
        ];
        for (const kw of forbiddenKeywords) {
            if (upperSql.includes(kw)) {
                return {
                    valid: false,
                    code: "FORBIDDEN_SQL_STATEMENT",
                    reason: `Generated SQL contains forbidden mutation keyword: "${kw.trim()}".`,
                };
            }
        }

        // 4. Referenced Tables Allowlist Check
        for (const table of data.referencedTables) {
            const normalizedTable = table.toLowerCase().trim();
            if (!ALLOWED_TABLES.includes(normalizedTable as AllowedTableName)) {
                return {
                    valid: false,
                    code: "UNAPPROVED_TABLE_REFERENCE",
                    reason: `Query references unapproved table "${table}". Only allowlisted tables (${ALLOWED_TABLES.join(", ")}) are permitted.`,
                };
            }
        }

        // Check for forbidden catalog references in SQL string
        if (
            upperSql.includes("PG_CATALOG") ||
            upperSql.includes("INFORMATION_SCHEMA") ||
            upperSql.includes("PG_TOAST")
        ) {
            return {
                valid: false,
                code: "UNAPPROVED_TABLE_REFERENCE",
                reason: "Direct access to PostgreSQL system catalogs is strictly prohibited.",
            };
        }

        return {
            valid: true,
            data,
        };
    }
}
