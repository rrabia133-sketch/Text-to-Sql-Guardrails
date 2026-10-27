import { GuardrailFinding } from "@text2sql/contracts";
import { ScopeResolutionResult } from "./scope-resolver.js";
import { ALLOWED_TABLES, ALLOWED_COLUMNS } from "../schema/schema.types.js";

export interface SchemaValidationOptions {
    allowedTables?: string[];                      // Defaults to customers, products, orders, order_items
    allowedColumns?: Record<string, string[]>;     // Defaults to ALLOWED_COLUMNS
    allowWildcards?: boolean;                      // Defaults to false (strict mode)
}

export interface SchemaValidationResult {
    ok: boolean;
    findings: GuardrailFinding[];
    validatedTables: string[];
    validatedColumns: string[];
}

export class SchemaValidator {
    private allowedTables: Set<string>;
    private allowedColumns: Record<string, Set<string>>;
    private allowWildcards: boolean;

    constructor(options?: SchemaValidationOptions) {
        this.allowedTables = new Set(
            (options?.allowedTables || [...ALLOWED_TABLES]).map(t => t.toLowerCase())
        );
        this.allowWildcards = options?.allowWildcards ?? false;

        const rawCols = options?.allowedColumns || ALLOWED_COLUMNS;
        this.allowedColumns = {};
        for (const [table, cols] of Object.entries(rawCols)) {
            this.allowedColumns[table.toLowerCase()] = new Set(cols.map(c => c.toLowerCase()));
        }
    }

    /**
     * Validates an AST statement and its resolved scope output against the schema allowlist.
     */
    public validate(ast: any, scopeResult?: ScopeResolutionResult): SchemaValidationResult {
        const findings: GuardrailFinding[] = [];
        const validatedTablesSet = new Set<string>();
        const validatedColumnsSet = new Set<string>();

        // 1. Check for Catalog Protection & Wildcard Projection directly in AST
        this.inspectAst(ast, findings);

        // 2. Validate Resolved Tables against Allowlist
        if (scopeResult && Array.isArray(scopeResult.tables)) {
            for (const table of scopeResult.tables) {
                // If it is a virtual CTE table, skip the physical table allowlist check
                if (table.isCte) {
                    continue;
                }

                const tableName = table.name.toLowerCase();

                // If it is a system catalog table, ensure it's recorded under FORBIDDEN_CATALOG
                if (this.isCatalogTable(tableName)) {
                    if (!findings.some(f => f.code === "FORBIDDEN_CATALOG" && f.target === table.name)) {
                        findings.push({
                            code: "FORBIDDEN_CATALOG",
                            severity: "CRITICAL",
                            target: table.name,
                            message: `Access to system catalog '${table.name}' is strictly forbidden.`,
                        });
                    }
                    continue;
                }

                // Verify against approved tables
                if (!this.allowedTables.has(tableName)) {
                    findings.push({
                        code: "FORBIDDEN_TABLE",
                        severity: "CRITICAL",
                        target: table.name,
                        message: `Table '${table.name}' is not in the approved analytics schema.`,
                    });
                } else {
                    validatedTablesSet.add(tableName);
                }
            }
        }

        // 3. Validate Resolved Columns against Table Column Catalog
        if (scopeResult && Array.isArray(scopeResult.columns)) {
            for (const col of scopeResult.columns) {
                // Skip wildcard references (handled by WILDCARD_PROJECTION rule)
                if (col.column === "*") continue;

                const tableLower = col.sourceTable.toLowerCase();
                const colLower = col.column.toLowerCase();

                // If the table is in the allowlist, verify column exists on that table
                if (this.allowedTables.has(tableLower)) {
                    const validCols = this.allowedColumns[tableLower];
                    if (!validCols || !validCols.has(colLower)) {
                        findings.push({
                            code: "FORBIDDEN_COLUMN",
                            severity: "CRITICAL",
                            target: `${col.sourceTable}.${col.column}`,
                            message: `Column '${col.column}' does not exist on table '${col.sourceTable}' in the approved schema.`,
                        });
                    } else {
                        validatedColumnsSet.add(`${col.sourceTable}.${col.column}`);
                    }
                }
            }
        }

        return {
            ok: findings.length === 0,
            findings,
            validatedTables: Array.from(validatedTablesSet),
            validatedColumns: Array.from(validatedColumnsSet),
        };
    }

    /**
     * Checks if a table or schema name targets PostgreSQL internal catalogs.
     */
    private isCatalogTable(nameOrSchema: string): boolean {
        const lower = nameOrSchema.toLowerCase();
        return (
            lower.startsWith("pg_") ||
            lower.startsWith("information_schema") ||
            lower.includes("pg_catalog") ||
            lower.includes("pg_toast")
        );
    }

    /**
     * Recursively traverses AST nodes to detect catalog table references and wildcard projections.
     */
    private inspectAst(node: any, findings: GuardrailFinding[]): void {
        if (!node || typeof node !== "object") return;

        // Check for catalog tables in table references
        if (node.type === "table" && node.name) {
            const schema = typeof node.name.schema === "string" ? node.name.schema.toLowerCase() : "";
            const name = typeof node.name.name === "string" ? node.name.name.toLowerCase() : "";
            const fullName = schema ? `${schema}.${name}` : name;

            if (this.isCatalogTable(schema) || this.isCatalogTable(name)) {
                if (!findings.some(f => f.code === "FORBIDDEN_CATALOG" && f.target === fullName)) {
                    findings.push({
                        code: "FORBIDDEN_CATALOG",
                        severity: "CRITICAL",
                        target: fullName,
                        message: `Access to system catalog '${fullName}' is strictly forbidden.`,
                    });
                }
            }
        }

        // Check for wildcard projection (SELECT * or SELECT c.*)
        if (!this.allowWildcards) {
            if (node.type === "ref" && node.name === "*") {
                const target = node.table?.name ? `${node.table.name}.*` : "*";
                if (!findings.some(f => f.code === "WILDCARD_PROJECTION" && f.target === target)) {
                    findings.push({
                        code: "WILDCARD_PROJECTION",
                        severity: "CRITICAL",
                        target,
                        message: `Wildcard projection '${target}' is strictly forbidden in production policy.`,
                    });
                }
            }
        }

        for (const key of Object.keys(node)) {
            const child = node[key];
            if (Array.isArray(child)) {
                for (const c of child) this.inspectAst(c, findings);
            } else if (child && typeof child === "object") {
                this.inspectAst(child, findings);
            }
        }
    }
}
