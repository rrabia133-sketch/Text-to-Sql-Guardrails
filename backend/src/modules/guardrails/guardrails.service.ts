import { parse } from "pgsql-ast-parser";
import {
    GuardrailValidationResult,
    GuardrailFinding,
    AstValidationMetadata,
} from "@text2sql/contracts";
import { AstParserService } from "./ast-parser.service.js";
import { NodeVisitor } from "./node-visitor.js";
import { ScopeResolver } from "./scope-resolver.js";
import { SchemaValidator } from "./schema-validator.js";
import { FunctionValidator } from "./function-validator.js";
import { SqlNormalizer } from "./normalizer.js";
import { PlanCostGate } from "./plan-cost-gate.js";
import { ALLOWED_COLUMNS } from "../schema/schema.types.js";

export interface GuardrailsServiceOptions {
    parser?: AstParserService;
    visitor?: NodeVisitor;
    scopeResolver?: ScopeResolver;
    schemaValidator?: SchemaValidator;
    functionValidator?: FunctionValidator;
    normalizer?: SqlNormalizer;
    planGate?: PlanCostGate;
    checkPlanCost?: boolean;
}

/**
 * GuardrailsService orchestrates the multi-layer AST and privilege containment pipeline:
 * 1. Statement Count & Root SELECT Policy (AstParserService)
 * 2. Recursive AST Node Allowlist (NodeVisitor)
 * 3. Dialect Normalization & Row-Cap Enforcement (SqlNormalizer)
 * 4. Lexical Scope & Alias Resolution (ScopeResolver)
 * 5. Allowlist Schema Objects & Catalog Protection (SchemaValidator)
 * 6. Approved Function Whitelist (FunctionValidator)
 * 7. EXPLAIN Plan Cost Gating (PlanCostGate)
 * 8. Deterministic Finding Aggregation & Fail-Closed Verdict
 */
export class GuardrailsService {
    private parser: AstParserService;
    private visitor: NodeVisitor;
    private scopeResolver: ScopeResolver;
    private schemaValidator: SchemaValidator;
    private functionValidator: FunctionValidator;
    private normalizer: SqlNormalizer;
    private planGate: PlanCostGate;
    private checkPlanCost: boolean;

    constructor(options?: GuardrailsServiceOptions) {
        this.parser = options?.parser || new AstParserService();
        this.visitor = options?.visitor || new NodeVisitor();
        this.scopeResolver = options?.scopeResolver || new ScopeResolver({ catalog: ALLOWED_COLUMNS });
        this.schemaValidator = options?.schemaValidator || new SchemaValidator();
        this.functionValidator = options?.functionValidator || new FunctionValidator();
        this.normalizer = options?.normalizer || new SqlNormalizer();
        this.planGate = options?.planGate || new PlanCostGate();
        this.checkPlanCost = options?.checkPlanCost ?? false;
    }

    /**
     * Executes the complete deterministic guardrail pipeline over an incoming SQL query string.
     */
    public async validate(sql: string): Promise<GuardrailValidationResult> {
        const allFindings: GuardrailFinding[] = [];
        const pushFindings = (findings: GuardrailFinding[]) => {
            allFindings.push(...findings);
        };

        // ---------------------------------------------------------
        // Step 1: Parse and enforce statement-level security policies
        // ---------------------------------------------------------
        const parseResult = this.parser.parse(sql);
        if (!parseResult.ok) {
            return {
                valid: false,
                status: "rejected",
                sql,
                findings: parseResult.findings,
                violations: parseResult.findings,
            };
        }

        const ast = parseResult.ast;

        // ---------------------------------------------------------
        // Step 2: Recursive AST Node Whitelist (Fail-Closed)
        // ---------------------------------------------------------
        const visitorResult = this.visitor.visit(ast);
        if (!visitorResult.ok) {
            pushFindings(visitorResult.findings);
        }

        // ---------------------------------------------------------
        // Step 3: Dialect Normalization & Mandatory Row-Cap Injection
        // ---------------------------------------------------------
        const normalizerResult = this.normalizer.normalize(sql);
        let normalizedSql: string = sql;

        if (!normalizerResult.ok) {
            pushFindings(normalizerResult.findings);
        } else {
            normalizedSql = normalizerResult.result.normalizedSql;
        }

        // ---------------------------------------------------------
        // Step 4: Lexical Scope & Alias Resolution
        // ---------------------------------------------------------
        const scopeResult = this.scopeResolver.resolve(ast);
        if (!scopeResult.ok) {
            pushFindings(scopeResult.findings);
        }

        // ---------------------------------------------------------
        // Step 5: Schema Object & Catalog Protection Verification
        // ---------------------------------------------------------
        const schemaResult = this.schemaValidator.validate(ast, scopeResult);
        if (!schemaResult.ok) {
            pushFindings(schemaResult.findings);
        }

        // ---------------------------------------------------------
        // Step 6: Approved Function Whitelist Enforcement
        // ---------------------------------------------------------
        const functionResult = this.functionValidator.validate(ast);
        if (!functionResult.ok) {
            pushFindings(functionResult.findings);
        }

        // ---------------------------------------------------------
        // Step 7: Optional EXPLAIN Plan Cost Gating
        // ---------------------------------------------------------
        let planCostResult;
        if (this.checkPlanCost) {
            const planRes = await this.planGate.estimateCost(normalizedSql);
            if (!planRes.ok) {
                pushFindings(planRes.findings);
            }
            planCostResult = planRes.costResult;
        }

        // ---------------------------------------------------------
        // Step 8: Build Rich Metadata & Aggregate Verdict
        // ---------------------------------------------------------
        const referencedTables = Array.from(
            new Set(scopeResult.tables.filter(t => !t.isCte).map(t => t.name.toLowerCase()))
        );

        const referencedColumns = Array.from(
            new Set(scopeResult.columns.map(c => `${c.sourceTable.toLowerCase()}.${c.column.toLowerCase()}`))
        );

        const functionCalls = functionResult.validatedFunctions;

        // Extract limit & offset details from the normalized statement
        let hasLimit = false;
        let limitValue: number | undefined;
        let offsetValue: number | undefined;

        try {
            const normAst = parse(normalizedSql)[0];
            const targetStmt: any = normAst.type === "with" && normAst.in ? normAst.in : normAst;
            if (targetStmt.limit?.limit?.value) {
                hasLimit = true;
                limitValue = targetStmt.limit.limit.value;
            }
            if (targetStmt.limit?.offset?.value) {
                offsetValue = targetStmt.limit.offset.value;
            }
        } catch {
            // Fallback to checking raw result values
            if (normalizerResult.ok && normalizerResult.result.injectedLimit) {
                hasLimit = true;
                limitValue = normalizerResult.result.injectedLimit;
            }
        }

        const hasCte = ast.type === "with";

        const metadata: AstValidationMetadata = {
            referencedTables,
            referencedColumns,
            functionCalls,
            hasLimit,
            limitValue,
            offsetValue,
            hasCte,
            planCost: planCostResult,
        };

        const violations = allFindings.filter(f => f.severity === "CRITICAL");
        const valid = violations.length === 0;
        const status = valid ? "passed" : "rejected";

        return {
            valid,
            status,
            sql,
            normalizedSql,
            findings: allFindings,
            violations,
            metadata,
        };
    }
}
