import { GuardrailFinding } from "@text2sql/contracts";

export const DEFAULT_APPROVED_FUNCTIONS = new Set([
    // Aggregates
    "count",
    "sum",
    "avg",
    "min",
    "max",
    // Scalars & Date/Math
    "date_trunc",
    "extract",
    "coalesce",
    "round",
    "lower",
    "upper",
]);

export interface FunctionValidationOptions {
    allowedFunctions?: Set<string> | string[];
}

export interface FunctionValidationResult {
    ok: boolean;
    findings: GuardrailFinding[];
    validatedFunctions: string[];
}

export class FunctionValidator {
    private allowedFunctions: Set<string>;

    constructor(options?: FunctionValidationOptions) {
        if (options?.allowedFunctions) {
            this.allowedFunctions = options.allowedFunctions instanceof Set
                ? options.allowedFunctions
                : new Set(options.allowedFunctions.map(f => f.toLowerCase()));
        } else {
            this.allowedFunctions = DEFAULT_APPROVED_FUNCTIONS;
        }
    }

    /**
     * Validates all function calls, EXTRACT expressions, and administrative keyword calls against the approved whitelist.
     */
    public validate(ast: any): FunctionValidationResult {
        const findings: GuardrailFinding[] = [];
        const validatedFunctionsSet = new Set<string>();

        const walk = (node: any) => {
            if (!node || typeof node !== "object") return;

            // 1. Function Call Node (type === "call")
            if (node.type === "call" && node.function?.name) {
                const rawName = String(node.function.name);
                const normalizedName = rawName.toLowerCase();

                if (this.allowedFunctions.has(normalizedName)) {
                    validatedFunctionsSet.add(normalizedName);
                } else {
                    findings.push({
                        code: "FORBIDDEN_FUNCTION",
                        severity: "CRITICAL",
                        target: rawName,
                        message: `Function '${rawName}' is strictly forbidden in analytical queries.`,
                    });
                }
            }

            // 2. EXTRACT Node (type === "extract")
            if (node.type === "extract") {
                if (this.allowedFunctions.has("extract")) {
                    validatedFunctionsSet.add("extract");
                } else {
                    findings.push({
                        code: "FORBIDDEN_FUNCTION",
                        severity: "CRITICAL",
                        target: "extract",
                        message: "Construct 'EXTRACT' is not permitted.",
                    });
                }
            }

            // 3. Administrative keywords used as parameterless functions (e.g. current_user, session_user)
            if (node.type === "keyword" && typeof node.keyword === "string") {
                const kw = node.keyword.toLowerCase();
                if (kw === "current_user" || kw === "session_user") {
                    findings.push({
                        code: "FORBIDDEN_FUNCTION",
                        severity: "CRITICAL",
                        target: node.keyword,
                        message: `Administrative construct '${node.keyword}' is strictly forbidden in analytical queries.`,
                    });
                }
            }

            // Recurse into all child properties
            for (const key of Object.keys(node)) {
                const child = node[key];
                if (Array.isArray(child)) {
                    for (const c of child) walk(c);
                } else if (child && typeof child === "object") {
                    walk(child);
                }
            }
        };

        walk(ast);

        return {
            ok: findings.length === 0,
            findings,
            validatedFunctions: Array.from(validatedFunctionsSet),
        };
    }
}
