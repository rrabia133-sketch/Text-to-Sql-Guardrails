import { GuardrailFinding } from "@text2sql/contracts";

export interface ResolvedColumn {
    column: string;         // e.g. "name"
    sourceTable: string;    // e.g. "customers"
    aliasUsed?: string;     // e.g. "c"
}

export interface ResolvedTable {
    name: string;           // e.g. "customers"
    alias?: string;         // e.g. "c"
    isCte: boolean;
}

export interface ScopeResolutionResult {
    ok: boolean;
    findings: GuardrailFinding[];
    tables: ResolvedTable[];
    columns: ResolvedColumn[];
}

export interface ScopeResolverOptions {
    catalog?: Record<string, string[]>;
}

export interface TableBinding {
    tableName: string;    // Real underlying table (e.g. "customers")
    alias?: string;        // Alias used in query (e.g. "c")
    isCte: boolean;        // Whether this is a virtual CTE
    cteColumns?: string[]; // Columns projected by the CTE (if known)
}

export class Scope {
    public parent?: Scope;
    // Map of alias or table name (lowercase) -> TableBinding
    public tables: Map<string, TableBinding> = new Map();
    // Set of available CTE names in this scope
    public ctes: Set<string> = new Set();

    constructor(parent?: Scope) {
        this.parent = parent;
        // Inherit CTEs from parent scope if present
        if (parent) {
            for (const cte of parent.ctes) {
                this.ctes.add(cte);
            }
        }
    }

    public registerTable(binding: TableBinding): boolean {
        const key = (binding.alias || binding.tableName).toLowerCase();
        if (this.tables.has(key)) {
            return false; // Duplicate alias in the same scope!
        }
        this.tables.set(key, binding);
        return true;
    }

    public resolveTable(nameOrAlias: string): TableBinding | undefined {
        const key = nameOrAlias.toLowerCase();
        if (this.tables.has(key)) {
            return this.tables.get(key);
        }
        return this.parent?.resolveTable(nameOrAlias);
    }

    public registerCte(name: string): void {
        this.ctes.add(name.toLowerCase());
    }

    public isCte(name: string): boolean {
        return this.ctes.has(name.toLowerCase());
    }

    public getAllTables(): TableBinding[] {
        return Array.from(this.tables.values());
    }
}

export class ScopeResolver {
    private catalog: Record<string, string[]>;

    constructor(options?: ScopeResolverOptions) {
        this.catalog = options?.catalog || {};
    }

    public resolve(ast: any): ScopeResolutionResult {
        const findings: GuardrailFinding[] = [];
        const tables: ResolvedTable[] = [];
        const columns: ResolvedColumn[] = [];
        const rootScope = new Scope();

        let mainQuery = ast;

        // Phase 1: If root statement is a WITH query, process CTEs and check for cycles
        if (ast && ast.type === "with") {
            const cycleFinding = this.checkCircularCtes(ast.bind);
            if (cycleFinding) {
                findings.push(cycleFinding);
                return { ok: false, findings, tables, columns };
            }

            // Register each CTE into root scope
            for (const cte of ast.bind || []) {
                const cteName = cte.alias?.name;
                if (cteName) {
                    rootScope.registerCte(cteName);
                    tables.push({
                        name: cteName,
                        isCte: true,
                    });
                    // Also resolve inner CTE query in its own subscope
                    const cteScope = new Scope(rootScope);
                    this.resolveStatement(cte.statement, cteScope, findings, tables, columns);
                }
            }
            mainQuery = ast.in;
        }

        // Phase 2: Resolve the main SELECT query
        if (mainQuery) {
            this.resolveStatement(mainQuery, rootScope, findings, tables, columns);
        }

        return {
            ok: findings.length === 0,
            findings,
            tables,
            columns,
        };
    }

    /**
     * Detects circular dependencies in Common Table Expressions (CTEs).
     * Builds a directed graph and runs depth-first search (DFS) to identify cycles.
     */
    private checkCircularCtes(bindings: any[]): GuardrailFinding | null {
        if (!Array.isArray(bindings) || bindings.length === 0) return null;

        const cteNames = new Set<string>();
        for (const b of bindings) {
            if (b.alias?.name) {
                cteNames.add(b.alias.name.toLowerCase());
            }
        }

        // Build dependency map: cteName -> Set<referencedCteNames>
        const depMap = new Map<string, Set<string>>();
        for (const b of bindings) {
            const name = b.alias?.name?.toLowerCase();
            if (!name) continue;
            const refs = new Set<string>();
            const tablesInStmt = this.extractTableNames(b.statement);
            for (const t of tablesInStmt) {
                if (cteNames.has(t.toLowerCase())) {
                    refs.add(t.toLowerCase());
                }
            }
            depMap.set(name, refs);
        }

        // Cycle detection using DFS
        const visited = new Set<string>();
        const recStack = new Set<string>();
        let cycleNodes: string[] = [];

        const dfs = (node: string, path: string[]): boolean => {
            visited.add(node);
            recStack.add(node);

            const neighbors = depMap.get(node) || new Set();
            for (const neighbor of neighbors) {
                if (!visited.has(neighbor)) {
                    if (dfs(neighbor, [...path, neighbor])) return true;
                } else if (recStack.has(neighbor)) {
                    cycleNodes = [...path, neighbor];
                    return true;
                }
            }

            recStack.delete(node);
            return false;
        };

        for (const name of cteNames) {
            if (!visited.has(name)) {
                if (dfs(name, [name])) {
                    const uniqueCycle = Array.from(new Set(cycleNodes));
                    return {
                        code: "UNRESOLVED_IDENTIFIER",
                        severity: "CRITICAL",
                        message: `Circular CTE reference detected between '${uniqueCycle.join("' and '")}'.`,
                    };
                }
            }
        }

        return null;
    }

    /**
     * Recursively extracts all table names referenced inside a query statement.
     */
    private extractTableNames(node: any): string[] {
        const tableNames: string[] = [];
        const walk = (n: any) => {
            if (!n || typeof n !== "object") return;
            if (n.type === "table" && n.name?.name) {
                tableNames.push(n.name.name);
            }
            for (const key of Object.keys(n)) {
                const child = n[key];
                if (Array.isArray(child)) {
                    for (const c of child) walk(c);
                } else if (child && typeof child === "object") {
                    walk(child);
                }
            }
        };
        walk(node);
        return tableNames;
    }

    /**
     * Resolves a single query statement (SELECT or subquery).
     */
    private resolveStatement(
        stmt: any,
        scope: Scope,
        findings: GuardrailFinding[],
        tables: ResolvedTable[],
        columns: ResolvedColumn[]
    ): void {
        if (!stmt || typeof stmt !== "object") return;

        // 1. Process FROM clause and register tables in scope
        if (Array.isArray(stmt.from)) {
            for (const item of stmt.from) {
                this.registerFromItem(item, scope, findings, tables, columns);
            }
        }

        // 2. Walk AST to resolve column references and subqueries
        this.walkAndResolveReferences(stmt, scope, findings, tables, columns, true);
    }

    /**
     * Registers a single table, subquery, or join into the lexical scope.
     */
    private registerFromItem(
        item: any,
        scope: Scope,
        findings: GuardrailFinding[],
        tables: ResolvedTable[],
        columns: ResolvedColumn[]
    ): void {
        if (!item) return;

        if (item.type === "table") {
            const tableName = item.name?.name;
            const alias = item.name?.alias || item.alias;
            if (tableName) {
                const isCte = scope.isCte(tableName);
                const registered = scope.registerTable({
                    tableName,
                    alias,
                    isCte,
                });

                if (!registered) {
                    findings.push({
                        code: "UNRESOLVED_IDENTIFIER",
                        severity: "CRITICAL",
                        message: `Duplicate alias '${alias || tableName}' in the same query scope.`,
                    });
                } else {
                    tables.push({
                        name: tableName,
                        alias,
                        isCte,
                    });
                }
            }
        } else if (item.type === "statement") {
            // Subquery in FROM clause
            const subqueryAlias = item.alias;
            if (subqueryAlias) {
                const registered = scope.registerTable({
                    tableName: subqueryAlias,
                    alias: subqueryAlias,
                    isCte: false,
                });
                if (!registered) {
                    findings.push({
                        code: "UNRESOLVED_IDENTIFIER",
                        severity: "CRITICAL",
                        message: `Duplicate alias '${subqueryAlias}' in the same query scope.`,
                    });
                } else {
                    tables.push({
                        name: subqueryAlias,
                        alias: subqueryAlias,
                        isCte: false,
                    });
                }
            }
            // Subquery has its own scope
            const subScope = new Scope(scope);
            this.resolveStatement(item.statement, subScope, findings, tables, columns);
        }

        // Process joins attached to this item
        if (item.join?.on) {
            this.walkAndResolveReferences(item.join.on, scope, findings, tables, columns, false);
        }
    }

    /**
     * Traverses expressions, clauses, and subqueries to resolve column references.
     */
    private walkAndResolveReferences(
        node: any,
        scope: Scope,
        findings: GuardrailFinding[],
        tables: ResolvedTable[],
        columns: ResolvedColumn[],
        isRootNode: boolean = false
    ): void {
        if (!node || typeof node !== "object") return;

        // Nested subquery expression
        if (!isRootNode && (node.type === "select" || node.type === "statement")) {
            const subScope = new Scope(scope);
            this.resolveStatement(node.statement || node, subScope, findings, tables, columns);
            return;
        }

        // Column reference
        if (node.type === "ref") {
            this.resolveColumnRef(node, scope, findings, columns);
            return;
        }

        for (const key of Object.keys(node)) {
            // Skip 'from' array top-level items because tables were already registered,
            // but DO visit their join conditions!
            if (key === "from" && Array.isArray(node[key])) {
                for (const item of node[key]) {
                    if (item?.join?.on) {
                        this.walkAndResolveReferences(item.join.on, scope, findings, tables, columns, false);
                    }
                }
                continue;
            }

            const child = node[key];
            if (Array.isArray(child)) {
                for (const c of child) {
                    this.walkAndResolveReferences(c, scope, findings, tables, columns, false);
                }
            } else if (child && typeof child === "object") {
                this.walkAndResolveReferences(child, scope, findings, tables, columns, false);
            }
        }
    }

    /**
     * Resolves a column reference to its underlying table source and checks for ambiguity.
     */
    private resolveColumnRef(
        ref: any,
        scope: Scope,
        findings: GuardrailFinding[],
        columns: ResolvedColumn[]
    ): void {
        if (!ref || ref.type !== "ref" || !ref.name || ref.name === "*") {
            return;
        }

        const colName = ref.name;

        // Case 1: Qualified reference, e.g. c.id or orders.id
        if (ref.table && ref.table.name) {
            const aliasOrTable = ref.table.name;
            const binding = scope.resolveTable(aliasOrTable);

            if (!binding) {
                findings.push({
                    code: "UNRESOLVED_IDENTIFIER",
                    severity: "CRITICAL",
                    message: `Unknown table alias '${aliasOrTable}'.`,
                });
                return;
            }

            columns.push({
                column: colName,
                sourceTable: binding.tableName,
                aliasUsed: aliasOrTable,
            });
            return;
        }

        // Case 2: Unqualified reference, e.g. id
        const tablesInScope = scope.getAllTables();
        if (tablesInScope.length === 0) {
            return;
        }

        if (this.catalog && Object.keys(this.catalog).length > 0) {
            // Find all tables in scope that contain this column in the catalog
            const matchingTables = tablesInScope.filter((t) => {
                const tableCols = this.catalog[t.tableName.toLowerCase()];
                return Array.isArray(tableCols) && tableCols.includes(colName.toLowerCase());
            });

            if (matchingTables.length > 1) {
                findings.push({
                    code: "UNRESOLVED_IDENTIFIER",
                    severity: "CRITICAL",
                    message: `Ambiguous column '${colName}' present in multiple tables (${matchingTables.map((t) => t.tableName).join(", ")}).`,
                });
                return;
            }

            if (matchingTables.length === 1) {
                columns.push({
                    column: colName,
                    sourceTable: matchingTables[0].tableName,
                });
                return;
            }
        }

        // If only one table exists in scope, bind to it by default
        if (tablesInScope.length === 1) {
            columns.push({
                column: colName,
                sourceTable: tablesInScope[0].tableName,
            });
        } else {
            // Ambiguous if multiple tables in scope and not found in catalog uniquely
            findings.push({
                code: "UNRESOLVED_IDENTIFIER",
                severity: "CRITICAL",
                message: `Ambiguous column '${colName}' present in multiple tables.`,
            });
        }
    }
}
