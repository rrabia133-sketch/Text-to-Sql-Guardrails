import type { CsvExportMetadata } from "@text2sql/contracts";

export interface CsvColumn {
    name: string;
    pgType?: string;
    jsType?: string;
    nullable?: boolean;
}

export interface CsvSerializationOptions {
    columns: Array<string | CsvColumn>;
    rows: Array<Record<string, unknown>>;
    executionId?: string;
    artifactId?: string;
    fileName?: string;
    includeHeader?: boolean;
    includeBom?: boolean;
    maxRows?: number;
    maxBytes?: number;
}

export interface CsvSerializationResult {
    csv: string;
    metadata: CsvExportMetadata;
    buffer: Buffer;
    contentType: string;
    contentDisposition: string;
}

/**
 * Regex matching any leading whitespace followed by spreadsheet formula command trigger characters:
 * '=', '+', '-', '@', '\t', '\r'
 */
export const FORMULA_INJECTION_REGEX = /^\s*[=+\-@\t\r]/;

/**
 * Checks if a value string starts with an active formula trigger character.
 */
export function isFormulaPayload(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    const str = typeof value === "object" && !(value instanceof Date)
        ? JSON.stringify(value)
        : String(value);
    return FORMULA_INJECTION_REGEX.test(str);
}

/**
 * Neutralizes spreadsheet formula injection by prefixing active trigger characters with a single quote (').
 * Converts NULL and undefined to empty strings. Formats Dates deterministically to ISO 8601 strings.
 */
export function sanitizeCsvCell(value: unknown): string {
    if (value === null || value === undefined) {
        return "";
    }

    let str: string;
    if (value instanceof Date) {
        str = value.toISOString();
    } else if (typeof value === "object") {
        str = JSON.stringify(value);
    } else {
        str = String(value);
    }

    if (FORMULA_INJECTION_REGEX.test(str)) {
        return `'${str}`;
    }

    return str;
}

/**
 * Formats a single cell according to RFC 4180:
 * - Neutralizes formula injection.
 * - If value contains comma, double quote, newline, carriage return, or was neutralized with single quote:
 *   escapes internal quotes (" -> "") and wraps in double quotes.
 */
export function formatCsvField(value: unknown): string {
    const sanitized = sanitizeCsvCell(value);

    // RFC 4180 quoting rule: quote if field contains commas, quotes, newlines, or was neutralized
    const requiresQuotes = /[\n\r",]/.test(sanitized) || sanitized.startsWith("'");

    if (requiresQuotes) {
        return `"${sanitized.replace(/"/g, '""')}"`;
    }

    return sanitized;
}

export class CsvExporterService {
    public static readonly DEFAULT_MAX_ROWS = 500;
    public static readonly DEFAULT_MAX_BYTES = 1024 * 1024; // 1 MiB
    public static readonly UTF8_BOM = "\uFEFF";
    public static readonly CONTENT_TYPE = "text/csv; charset=utf-8";

    /**
     * Generates an RFC 4180 compliant, formula-injection neutralized CSV string and metadata report.
     */
    public serialize(options: CsvSerializationOptions): CsvSerializationResult {
        const includeHeader = options.includeHeader ?? true;
        const includeBom = options.includeBom ?? false;
        const maxRows = options.maxRows ?? CsvExporterService.DEFAULT_MAX_ROWS;
        const maxBytes = options.maxBytes ?? CsvExporterService.DEFAULT_MAX_BYTES;
        const executionId = options.executionId || "anon";
        const artifactId = options.artifactId || "anon";

        // 1. Column Headers
        const columnNames = options.columns.map((col) => (typeof col === "string" ? col : col.name));
        const lines: string[] = [];

        if (includeHeader && columnNames.length > 0) {
            const headerLine = columnNames.map((name) => formatCsvField(name)).join(",");
            lines.push(headerLine);
        }

        // 2. Row Clamping & Serialization
        let rows = options.rows;
        let truncated = false;

        if (rows.length > maxRows) {
            rows = rows.slice(0, maxRows);
            truncated = true;
        }

        for (const row of rows) {
            const line = columnNames
                .map((colName) => formatCsvField(row[colName]))
                .join(",");
            lines.push(line);
        }

        // RFC 4180 standard line termination CRLF
        let csvBody = lines.join("\r\n");

        // 3. UTF-8 Byte Cap Check
        let byteSize = Buffer.byteLength(csvBody, "utf8");
        if (byteSize > maxBytes) {
            truncated = true;
        }

        const finalCsv = includeBom ? CsvExporterService.UTF8_BOM + csvBody : csvBody;
        const buffer = Buffer.from(finalCsv, "utf8");
        const finalByteSize = buffer.length;

        // 4. Safe Filename & Headers
        const safeFileName = options.fileName || this.generateSafeFileName(executionId);
        const contentDisposition = `attachment; filename="${safeFileName}"`;

        const metadata: CsvExportMetadata = {
            executionId,
            artifactId,
            fileName: safeFileName,
            rowCount: rows.length,
            byteSize: finalByteSize,
            truncated,
            exportedAt: new Date().toISOString(),
            formulaInjectionNeutralized: true,
        };

        return {
            csv: finalCsv,
            metadata,
            buffer,
            contentType: CsvExporterService.CONTENT_TYPE,
            contentDisposition,
        };
    }

    /**
     * Generates a sanitized attachment filename free of directory traversal sequences and header injection chars.
     */
    public generateSafeFileName(executionId?: string): string {
        const raw = executionId?.trim() || `anon_${Date.now()}`;
        // Strip out any characters except alphanumerics, hyphens, and underscores
        const safe = raw.replace(/[^a-zA-Z0-9_-]/g, "_");
        return `query-results-${safe}.csv`;
    }
}

