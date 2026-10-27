export interface ResourceLimiterOptions {
    maxRows?: number;   // default: 500
    maxBytes?: number;  // default: 1048576 (1 MiB)
    timeoutMs?: number; // default: 5000
}

export interface LimitedResourceResult {
    rows: Record<string, unknown>[];
    rowCount: number;
    byteSize: number;
    truncated: boolean;
}

export class ResourceLimiter {
    public static readonly DEFAULT_MAX_ROWS = 500;
    public static readonly DEFAULT_MAX_BYTES = 1024 * 1024; // 1 MiB
    public static readonly DEFAULT_TIMEOUT_MS = 5000;

    /**
     * Formats row cells deterministically (Dates -> ISO strings, BigInts -> numbers).
     */
    public formatRow(row: Record<string, unknown>): Record<string, unknown> {
        const formatted: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(row)) {
            if (value instanceof Date) {
                formatted[key] = value.toISOString();
            } else if (typeof value === "bigint") {
                formatted[key] = Number(value);
            } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
                formatted[key] = value;
            } else {
                formatted[key] = value;
            }
        }

        return formatted;
    }

    /**
     * Enforces row count and byte limits with automatic graceful truncation.
     */
    public enforce(
        rawRows: Record<string, unknown>[],
        options?: ResourceLimiterOptions
    ): LimitedResourceResult {
        const maxRows = options?.maxRows ?? ResourceLimiter.DEFAULT_MAX_ROWS;
        const maxBytes = options?.maxBytes ?? ResourceLimiter.DEFAULT_MAX_BYTES;

        let truncated = false;

        // 1. Format row values deterministically
        let formattedRows = rawRows.map(row => this.formatRow(row));

        // 2. Enforce Row Cap
        if (formattedRows.length > maxRows) {
            formattedRows = formattedRows.slice(0, maxRows);
            truncated = true;
        }

        // 3. Enforce Byte Cap
        let byteSize = Buffer.byteLength(JSON.stringify(formattedRows), "utf8");

        if (byteSize > maxBytes) {
            while (formattedRows.length > 1 && byteSize > maxBytes) {
                formattedRows.pop();
                byteSize = Buffer.byteLength(JSON.stringify(formattedRows), "utf8");
            }
            truncated = true;
        }

        return {
            rows: formattedRows,
            rowCount: formattedRows.length,
            byteSize,
            truncated,
        };
    }
}
