import {
    GuardrailFinding,
    GuardrailViolationCode,
} from "@text2sql/contracts";

export interface NodeVisitorOptions {
    allowedNodeTypes?: Set<string>;
    onNode?: (node: any, path: string[]) => void;
    maxDepth?: number;
}

export interface CollectedNodes {
    tables: any[];
    columns: any[];
    functions: any[];
    subqueries: any[];
    ctes: any[];
}

export interface VisitorResult {
    ok: boolean;
    findings: GuardrailFinding[];
    visitedNodesCount: number;
    collected: CollectedNodes;
}

/**
 * Approved AST node types for read-only analytical SQL queries.
 * Any node type not in this allowlist will fail closed with UNSUPPORTED_NODE_TYPE.
 */
export const APPROVED_AST_NODE_TYPES: Set<string> = new Set([
    // Statements
    "select",
    "with",
    "union",
    "union all",

    // Structural / Clauses
    "table",
    "statement",
    "ref",
    "call",
    "binary",
    "unary",
    "ternary",
    "cast",
    "case",
    "extract",
    "list",
    "array",
    "arrayindex",
    "parameter",

    // Literals & Constants
    "constant",
    "integer",
    "numeric",
    "string",
    "boolean",
    "null",
    "keyword",
    "member",

    // Joins
    "inner join",
    "left join",
    "right join",
    "full join",
    "cross join",
]);

/**
 * Explicit forbidden node types mapped to precise security reason codes.
 */
export const FORBIDDEN_NODE_TYPES: Record<string, { code: GuardrailViolationCode; description: string }> = {
    // Administrative Commands
    set: { code: "ADMINISTRATIVE_COMMAND", description: "Administrative statement 'SET'" },
    show: { code: "ADMINISTRATIVE_COMMAND", description: "Administrative statement 'SHOW'" },
    reset: { code: "ADMINISTRATIVE_COMMAND", description: "Administrative statement 'RESET'" },
    listen: { code: "ADMINISTRATIVE_COMMAND", description: "Administrative statement 'LISTEN'" },
    notify: { code: "ADMINISTRATIVE_COMMAND", description: "Administrative statement 'NOTIFY'" },
    vacuum: { code: "ADMINISTRATIVE_COMMAND", description: "Administrative statement 'VACUUM'" },

    // Transaction Controls
    commit: { code: "TRANSACTION_CONTROL", description: "Transaction control statement 'COMMIT'" },
    rollback: { code: "TRANSACTION_CONTROL", description: "Transaction control statement 'ROLLBACK'" },
    "start transaction": { code: "TRANSACTION_CONTROL", description: "Transaction control statement 'START TRANSACTION'" },
    transaction: { code: "TRANSACTION_CONTROL", description: "Transaction control statement" },

    // DDL & DML Mutations
    insert: { code: "FORBIDDEN_STATEMENT_TYPE", description: "Data mutation statement 'INSERT'" },
    update: { code: "FORBIDDEN_STATEMENT_TYPE", description: "Data mutation statement 'UPDATE'" },
    delete: { code: "FORBIDDEN_STATEMENT_TYPE", description: "Data mutation statement 'DELETE'" },
    truncate: { code: "FORBIDDEN_STATEMENT_TYPE", description: "Data mutation statement 'TRUNCATE'" },
    droptable: { code: "FORBIDDEN_STATEMENT_TYPE", description: "Schema definition statement 'DROP TABLE'" },
    "drop table": { code: "FORBIDDEN_STATEMENT_TYPE", description: "Schema definition statement 'DROP TABLE'" },
    altertable: { code: "FORBIDDEN_STATEMENT_TYPE", description: "Schema definition statement 'ALTER TABLE'" },
    "alter table": { code: "FORBIDDEN_STATEMENT_TYPE", description: "Schema definition statement 'ALTER TABLE'" },
    createtable: { code: "FORBIDDEN_STATEMENT_TYPE", description: "Schema definition statement 'CREATE TABLE'" },
    "create table": { code: "FORBIDDEN_STATEMENT_TYPE", description: "Schema definition statement 'CREATE TABLE'" },
    selectinto: { code: "FORBIDDEN_STATEMENT_TYPE", description: "Statement 'SELECT INTO'" },
    "select into": { code: "FORBIDDEN_STATEMENT_TYPE", description: "Statement 'SELECT INTO'" },
    copy: { code: "FORBIDDEN_STATEMENT_TYPE", description: "Host filesystem statement 'COPY'" },


    // Locking
    for: { code: "LOCKING_CLAUSE", description: "Locking clause 'FOR UPDATE / FOR SHARE'" },
};

/**
 * NodeVisitor performs recursive, depth-first traversal over a parsed SQL AST.
 * Enforces an explicit node type allowlist and captures specific forbidden node constructs.
 */
export class NodeVisitor {
    private readonly allowedTypes: Set<string>;
    private readonly onNode?: (node: any, path: string[]) => void;
    private readonly maxDepth: number;

    constructor(options?: NodeVisitorOptions) {
        this.allowedTypes = options?.allowedNodeTypes || APPROVED_AST_NODE_TYPES;
        this.onNode = options?.onNode;
        this.maxDepth = options?.maxDepth || 100;
    }

    /**
     * Traverses the AST root node recursively and returns validation findings and collected node groups.
     */
    public visit(root: any): VisitorResult {
        const findings: GuardrailFinding[] = [];
        const collected: CollectedNodes = {
            tables: [],
            columns: [],
            functions: [],
            subqueries: [],
            ctes: [],
        };
        let visitedNodesCount = 0;

        const traverse = (node: any, path: string[], depth: number) => {
            if (!node || typeof node !== "object") return;

            if (depth > this.maxDepth) {
                findings.push({
                    code: "SYNTAX_ERROR",
                    severity: "CRITICAL",
                    message: `AST traversal exceeded maximum depth limit (${this.maxDepth}). Query nesting is too deep.`,
                });
                return;
            }

            visitedNodesCount++;

            // If node has a 'type' property, validate against allowlist and blocklist
            if (typeof node.type === "string") {
                const normalizedType = node.type.trim().toLowerCase();

                // 1. Check if node is an explicitly forbidden type
                if (normalizedType in FORBIDDEN_NODE_TYPES) {
                    const rule = FORBIDDEN_NODE_TYPES[normalizedType];
                    findings.push({
                        code: rule.code,
                        severity: "CRITICAL",
                        nodeType: node.type,
                        message: `${rule.description} is strictly forbidden.`,
                    });
                } else if (!this.allowedTypes.has(normalizedType)) {
                    // 2. Fail closed on any unapproved / unknown node type
                    findings.push({
                        code: "UNSUPPORTED_NODE_TYPE",
                        severity: "CRITICAL",
                        nodeType: node.type,
                        message: `Unsupported or unapproved AST construct '${node.type}' is strictly forbidden.`,
                    });
                }

                // Collect categories for downstream guardrail modules
                if (normalizedType === "table") {
                    collected.tables.push(node);
                } else if (normalizedType === "ref") {
                    collected.columns.push(node);
                } else if (normalizedType === "call") {
                    collected.functions.push(node);
                } else if (normalizedType === "statement") {
                    collected.subqueries.push(node);
                } else if (normalizedType === "with" && Array.isArray(node.bind)) {
                    collected.ctes.push(...node.bind);
                }
            }

            // Also check for nested locking clauses (.for property on statements)
            if (node.for) {
                const lockType = node.for.type ? `FOR ${String(node.for.type).toUpperCase()}` : "LOCKING CLAUSE";
                findings.push({
                    code: "LOCKING_CLAUSE",
                    severity: "CRITICAL",
                    nodeType: "for",
                    target: lockType,
                    message: `Locking clause (${lockType}) is strictly forbidden.`,
                });
            }

            // Invoke custom hook if provided
            if (this.onNode) {
                this.onNode(node, path);
            }

            // Recurse over child properties
            for (const key of Object.keys(node)) {
                // Skip primitive values or symbol keys
                const child = node[key];
                if (Array.isArray(child)) {
                    for (let i = 0; i < child.length; i++) {
                        traverse(child[i], [...path, `${key}[${i}]`], depth + 1);
                    }
                } else if (child && typeof child === "object") {
                    traverse(child, [...path, key], depth + 1);
                }
            }
        };

        traverse(root, ["root"], 0);

        return {
            ok: findings.length === 0,
            findings,
            visitedNodesCount,
            collected,
        };
    }
}
