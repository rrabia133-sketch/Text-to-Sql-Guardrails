import { parse, Statement, Expr, SelectStatement } from 'pgsql-ast-parser';

export interface ValidationResult {
    ok: boolean;
    violation?: string;
    reason?: string;
    ast?: Statement;
}

// 1. Allowed Tables Whitelist
const ALLOWED_TABLES = new Set(['customers', 'products', 'orders', 'order_items']);

// 2. Approved Functions Whitelist
const ALLOWED_FUNCTIONS = new Set([
    'count', 'sum', 'avg', 'min', 'max',
    'date_trunc', 'extract', 'coalesce', 'round', 'lower', 'upper'
]);

export function checkSql(sql: string): ValidationResult {
    let astList: Statement[];

    // Step 1: Parse AST (fails on invalid SQL syntax)
    try {
        astList = parse(sql);
    } catch (err: any) {
        return {
            ok: false,
            violation: 'SYNTAX_ERROR',
            reason: `Failed to parse SQL: ${err.message}`
        };
    }

    // Step 2: Enforce strictly 1 statement (Blocks stacked queries like SELECT...; DROP TABLE...)
    if (astList.length !== 1) {
        return {
            ok: false,
            violation: 'MULTIPLE_STATEMENTS',
            reason: `Query contains ${astList.length} statements. Only single statements are permitted.`
        };
    }

    const stmt = astList[0];

    // Step 3: Enforce statement type is strictly SELECT
    if (stmt.type !== 'select') {
        return {
            ok: false,
            violation: 'FORBIDDEN_STATEMENT_TYPE',
            reason: `Statement type '${stmt.type}' is forbidden. Only SELECT statements are permitted.`
        };
    }

    const selectStmt = stmt as SelectStatement;

    // Step 4: Reject locking clauses (FOR UPDATE, FOR SHARE)
    if ((selectStmt as any).for) {
        return {
            ok: false,
            violation: 'LOCKING_CLAUSE',
            reason: 'Locking clauses (FOR UPDATE / FOR SHARE) are strictly forbidden.'
        };
    }

    // Step 5: Recursive AST Node Traversal for Tables and Functions
    const violations: { violation: string; reason: string }[] = [];

    function inspectNode(node: any) {
        if (!node || typeof node !== 'object') return;

        // Check Table References in FROM and JOINs
        if (node.type === 'table') {
            const tableName = node.name?.name?.toLowerCase();
            if (!tableName || !ALLOWED_TABLES.has(tableName)) {
                violations.push({
                    violation: 'FORBIDDEN_TABLE',
                    reason: `Table '${tableName || 'unknown'}' is not in the approved whitelist.`
                });
            }
        }

        // Check Function Calls
        if (node.type === 'call') {
            const funcName = node.function?.name?.toLowerCase();
            if (!funcName || !ALLOWED_FUNCTIONS.has(funcName)) {
                violations.push({
                    violation: 'FORBIDDEN_FUNCTION',
                    reason: `Function '${funcName || 'unknown'}' is not in the approved whitelist.`
                });
            }
        }

        // Recurse over all child properties and arrays
        for (const key of Object.keys(node)) {
            const child = node[key];
            if (Array.isArray(child)) {
                child.forEach(inspectNode);
            } else if (typeof child === 'object') {
                inspectNode(child);
            }
        }
    }

    inspectNode(selectStmt);

    if (violations.length > 0) {
        return {
            ok: false,
            violation: violations[0].violation,
            reason: violations[0].reason
        };
    }

    return { ok: true, ast: stmt };
}
