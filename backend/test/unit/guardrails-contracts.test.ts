import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    GuardrailViolationCodeSchema,
    GuardrailSeveritySchema,
    GuardrailFindingSchema,
    GuardrailValidationResultSchema,
    NormalizedSqlResultSchema,
    AstPlanCostResultSchema,
    AstValidationMetadataSchema,
    GuardrailFinding,
    GuardrailValidationResult,
} from "@text2sql/contracts";

describe("Sprint 4 - Task 1: Guardrails Contracts & Validation Schemas", () => {
    it("validates all approved GuardrailViolationCodes", () => {
        const approvedCodes = [
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
        ];

        for (const code of approvedCodes) {
            assert.equal(GuardrailViolationCodeSchema.parse(code), code);
        }

        // Rejects unapproved code
        assert.throws(() => GuardrailViolationCodeSchema.parse("ARBITRARY_VIOLATION"));
    });

    it("validates GuardrailSeverity levels", () => {
        assert.equal(GuardrailSeveritySchema.parse("CRITICAL"), "CRITICAL");
        assert.equal(GuardrailSeveritySchema.parse("WARNING"), "WARNING");
        assert.equal(GuardrailSeveritySchema.parse("INFO"), "INFO");

        assert.throws(() => GuardrailSeveritySchema.parse("FATAL"));
    });

    it("validates GuardrailFinding schema with location and metadata", () => {
        const validFinding: GuardrailFinding = {
            code: "FORBIDDEN_FUNCTION",
            severity: "CRITICAL",
            message: "Function 'pg_sleep' is strictly forbidden.",
            nodeType: "call",
            target: "pg_sleep",
            location: {
                line: 1,
                column: 15,
            },
        };

        const parsed = GuardrailFindingSchema.parse(validFinding);
        assert.equal(parsed.code, "FORBIDDEN_FUNCTION");
        assert.equal(parsed.target, "pg_sleep");
        assert.equal(parsed.location?.line, 1);
    });

    it("validates NormalizedSqlResult schema", () => {
        const normalized = NormalizedSqlResultSchema.parse({
            originalSql: "SELECT name FROM customers",
            normalizedSql: "SELECT name FROM customers LIMIT 50;",
            injectedLimit: 50,
            astModified: true,
        });

        assert.equal(normalized.injectedLimit, 50);
        assert.equal(normalized.astModified, true);
    });

    it("validates AstPlanCostResult schema", () => {
        const planCost = AstPlanCostResultSchema.parse({
            totalCost: 145.2,
            maxAllowedCost: 10000,
            estimatedRows: 42,
            acceptable: true,
            planNodes: ["Seq Scan on customers", "Aggregate"],
        });

        assert.equal(planCost.acceptable, true);
        assert.equal(planCost.totalCost, 145.2);
        assert.equal(planCost.planNodes.length, 2);
    });

    it("validates GuardrailValidationResult schema for passed and rejected states", () => {
        const passedResult: GuardrailValidationResult = {
            valid: true,
            status: "passed",
            sql: "SELECT name FROM customers LIMIT 50;",
            normalizedSql: "SELECT name FROM customers LIMIT 50;",
            findings: [],
            violations: [],
            metadata: {
                referencedTables: ["customers"],
                referencedColumns: ["name"],
                functionCalls: [],
                hasLimit: true,
                limitValue: 50,
                hasCte: false,
            },
        };

        const parsedPassed = GuardrailValidationResultSchema.parse(passedResult);
        assert.equal(parsedPassed.valid, true);
        assert.equal(parsedPassed.status, "passed");

        const rejectedResult: GuardrailValidationResult = {
            valid: false,
            status: "rejected",
            sql: "DELETE FROM customers;",
            findings: [
                {
                    code: "FORBIDDEN_STATEMENT_TYPE",
                    severity: "CRITICAL",
                    message: "Statement type 'delete' is forbidden. Only SELECT statements are permitted.",
                },
            ],
            violations: [
                {
                    code: "FORBIDDEN_STATEMENT_TYPE",
                    severity: "CRITICAL",
                    message: "Statement type 'delete' is forbidden. Only SELECT statements are permitted.",
                },
            ],
        };

        const parsedRejected = GuardrailValidationResultSchema.parse(rejectedResult);
        assert.equal(parsedRejected.valid, false);
        assert.equal(parsedRejected.status, "rejected");
        assert.equal(parsedRejected.findings[0].code, "FORBIDDEN_STATEMENT_TYPE");
    });
});
