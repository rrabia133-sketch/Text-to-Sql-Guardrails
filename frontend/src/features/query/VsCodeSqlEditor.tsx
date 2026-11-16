import { useMemo } from "react";
import { Database, FileCode, ShieldCheck } from "lucide-react";

export interface VsCodeSqlEditorProps {
    sql: string;
    schemaVersion?: string;
}

const SQL_KEYWORDS = new Set([
    "SELECT", "FROM", "WHERE", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS",
    "ON", "AS", "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET",
    "AND", "OR", "NOT", "IN", "IS", "NULL", "BETWEEN", "LIKE", "ILIKE",
    "CASE", "WHEN", "THEN", "ELSE", "END", "ASC", "DESC", "DISTINCT", "UNION", "ALL",
    "TRUE", "FALSE"
]);

const SQL_FUNCTIONS = new Set([
    "SUM", "COUNT", "AVG", "MIN", "MAX", "ROUND", "COALESCE", "DATE_TRUNC", "NOW",
    "CONCAT", "LOWER", "UPPER", "TRIM", "LENGTH", "CAST", "EXTRACT", "ABS"
]);

interface SqlToken {
    type: "keyword" | "function" | "string" | "number" | "operator" | "identifier" | "comment" | "plain";
    text: string;
}

function formatSqlLines(rawSql: string): string[] {
    const trimmed = rawSql.trim();
    if (!trimmed) return [];

    const existingLines = trimmed.split("\n");
    if (existingLines.length > 2) {
        return existingLines.map((line) => line.trimEnd());
    }

    // Intelligently format single-line SQL by breaking before major SQL clauses
    const formatted = trimmed
        .replace(/\s+/g, " ")
        .replace(/\s+(FROM)\s+/gi, "\nFROM ")
        .replace(/\s+(INNER JOIN|LEFT JOIN|RIGHT JOIN|CROSS JOIN|JOIN)\s+/gi, "\n$1 ")
        .replace(/\s+(WHERE)\s+/gi, "\nWHERE ")
        .replace(/\s+(AND)\s+/gi, "\n  AND ")
        .replace(/\s+(OR)\s+/gi, "\n  OR ")
        .replace(/\s+(GROUP BY)\s+/gi, "\nGROUP BY ")
        .replace(/\s+(HAVING)\s+/gi, "\nHAVING ")
        .replace(/\s+(ORDER BY)\s+/gi, "\nORDER BY ")
        .replace(/\s+(LIMIT)\s+/gi, "\nLIMIT ");

    return formatted.split("\n");
}

function tokenizeLine(line: string): SqlToken[] {
    const regex = /'[^']*'|--[^\n]*|\b\d+(?:\.\d+)?\b|[a-zA-Z_][a-zA-Z0-9_.]*|[(),;=<>+*/-]|[\s]+/g;
    const tokens: SqlToken[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(line)) !== null) {
        const text = match[0];
        const upper = text.toUpperCase();

        if (text.startsWith("'")) {
            tokens.push({ type: "string", text });
        } else if (text.startsWith("--")) {
            tokens.push({ type: "comment", text });
        } else if (/^\d+(?:\.\d+)?$/.test(text)) {
            tokens.push({ type: "number", text });
        } else if (SQL_FUNCTIONS.has(upper)) {
            tokens.push({ type: "function", text });
        } else if (SQL_KEYWORDS.has(upper)) {
            tokens.push({ type: "keyword", text });
        } else if (/^[a-zA-Z_]/.test(text)) {
            tokens.push({ type: "identifier", text });
        } else if (/^[(),;=<>+*/-]$/.test(text)) {
            tokens.push({ type: "operator", text });
        } else {
            tokens.push({ type: "plain", text });
        }
    }

    if (tokens.length === 0 && line.length > 0) {
        tokens.push({ type: "plain", text: line });
    }

    return tokens;
}

export function VsCodeSqlEditor({ sql, schemaVersion }: VsCodeSqlEditorProps) {
    const lines = useMemo(() => formatSqlLines(sql), [sql]);

    return (
        <div className="vscode-editor-frame" id="vscode-sql-editor">
            {/* Window title bar & Tabs */}
            <div className="vscode-titlebar">
                <div className="vscode-controls" aria-hidden="true">
                    <span className="vscode-dot dot-close" title="Close" />
                    <span className="vscode-dot dot-minimize" title="Minimize" />
                    <span className="vscode-dot dot-maximize" title="Maximize" />
                </div>

                <div className="vscode-tabs-track">
                    <div className="vscode-tab active">
                        <Database size={13} className="vscode-tab-file-icon" />
                        <span className="vscode-tab-name">query.sql</span>
                        <span className="vscode-tab-badge">POSTGRESQL</span>
                        <span className="vscode-tab-close-icon" aria-hidden="true">×</span>
                    </div>
                </div>

                <div className="vscode-titlebar-actions">
                    {schemaVersion && (
                        <span className="vscode-schema-pill" title={`Schema Version: ${schemaVersion}`}>
                            Schema: {schemaVersion}
                        </span>
                    )}
                </div>
            </div>

            {/* Breadcrumbs Navigation */}
            <div className="vscode-breadcrumbs-bar">
                <span className="breadcrumb-segment">
                    <Database size={11} className="breadcrumb-icon" />
                    <span>analytics_db</span>
                </span>
                <span className="breadcrumb-sep">›</span>
                <span className="breadcrumb-segment">
                    <FileCode size={11} className="breadcrumb-icon" />
                    <span>public</span>
                </span>
                <span className="breadcrumb-sep">›</span>
                <span className="breadcrumb-segment">query.sql</span>
                <span className="breadcrumb-sep">›</span>
                <span className="breadcrumb-segment breadcrumb-symbol">
                    <span className="symbol-tag">SELECT</span>
                </span>
            </div>

            {/* Main Code Canvas: Gutter + Code Lines */}
            <div className="vscode-canvas">
                <div className="vscode-gutter" aria-hidden="true">
                    {lines.map((_, i) => (
                        <div key={i} className="gutter-number">
                            {i + 1}
                        </div>
                    ))}
                </div>

                <div className="vscode-code-container">
                    <pre className="vscode-pre">
                        <code>
                            {lines.map((line, lineIdx) => {
                                const tokens = tokenizeLine(line);
                                return (
                                    <div key={lineIdx} className="vscode-line">
                                        {tokens.map((token, tokenIdx) => (
                                            <span
                                                key={tokenIdx}
                                                className={`token-${token.type}`}
                                            >
                                                {token.text}
                                            </span>
                                        ))}
                                    </div>
                                );
                            })}
                        </code>
                    </pre>
                </div>
            </div>

            {/* Editor Bottom Status Bar */}
            <div className="vscode-statusbar">
                <div className="vscode-status-section">
                    <span className="status-cell">Ln {lines.length}, Col 1</span>
                    <span className="status-cell">Spaces: 2</span>
                    <span className="status-cell">UTF-8</span>
                    <span className="status-cell">LF</span>
                </div>
                <div className="vscode-status-section status-right">
                    <span className="status-cell status-ast-safe">
                        <ShieldCheck size={11} />
                        <span>PostgreSQL (Read-Only)</span>
                    </span>
                    <span className="status-cell">SQL</span>
                </div>
            </div>
        </div>
    );
}

