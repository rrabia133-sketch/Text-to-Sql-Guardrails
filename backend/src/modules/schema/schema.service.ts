// backend/src/modules/schema/schema.service.ts

import { Pool } from "pg";
import { createHash } from "crypto";
import {
    ALLOWED_TABLES,
    ALLOWED_COLUMNS,
    type AllowedTableName,
    type ColumnMetadata,
    type ForeignKeyRelationship,
    type TableMetadata,
    type SanitizedCatalog,
} from "./schema.types.js";

export class SchemaService {
    private analyticsPool?: Pool | null;
    private cachedCatalog: SanitizedCatalog | null = null;
    private cacheExpiresAt: number = 0;
    private cacheTtlMs: number;

    constructor(analyticsPool?: Pool | null, cacheTtlMs: number = 5 * 60 * 1000) {
        this.analyticsPool = analyticsPool;
        this.cacheTtlMs = cacheTtlMs;
    }

    /**
     * Returns the sanitized, allowlisted schema catalog.
     * Uses in-memory cache unless expired or forceRefresh is true.
     */
    async getSanitizedCatalog(forceRefresh = false): Promise<SanitizedCatalog> {
        const now = Date.now();
        if (!forceRefresh && this.cachedCatalog && now < this.cacheExpiresAt) {
            return this.cachedCatalog;
        }

        try {
            if (this.analyticsPool) {
                const freshCatalog = await this.introspectAndSanitize();
                this.cachedCatalog = freshCatalog;
                this.cacheExpiresAt = now + this.cacheTtlMs;
                return freshCatalog;
            }
        } catch (error) {
            // If database is not reachable, fallback to canonical fixture
        }

        const canonicalCatalog = this.getCanonicalCatalog();
        this.cachedCatalog = canonicalCatalog;
        this.cacheExpiresAt = now + this.cacheTtlMs;
        return canonicalCatalog;
    }

    /**
     * Formats the sanitized catalog as a Markdown string for LLM prompt context injection.
     */
    formatForPrompt(catalog: SanitizedCatalog): string {
        const lines: string[] = [
            `### Database Schema (Version: ${catalog.schemaVersion})`,
            "Only the following approved tables and columns exist in analytics_db:",
            "",
        ];

        for (const tableName of ALLOWED_TABLES) {
            const table = catalog.tables[tableName];
            if (!table) continue;

            lines.push(`#### Table: \`${tableName}\``);
            lines.push("| Column | Type | Nullable | Primary Key |");
            lines.push("| :--- | :--- | :--- | :--- |");
            for (const col of table.columns) {
                lines.push(
                    `| \`${col.name}\` | \`${col.dataType}\` | ${col.isNullable ? "YES" : "NO"} | ${col.isPrimaryKey ? "YES (PK)" : "NO"} |`
                );
            }
            if (table.foreignKeys.length > 0) {
                lines.push("**Foreign Key Relationships:**");
                for (const fk of table.foreignKeys) {
                    lines.push(`- \`${fk.columnName}\` -> \`${fk.foreignTable}.${fk.foreignColumn}\``);
                }
            }
            lines.push("");
        }

        return lines.join("\n");
    }

    /**
     * Clears cached schema catalog (helpful in tests or schema migrations).
     */
    clearCache(): void {
        this.cachedCatalog = null;
        this.cacheExpiresAt = 0;
    }

    /**
     * Canonical schema definition matching analytics_db DDL.
     */
    getCanonicalCatalog(): SanitizedCatalog {
        const tables: Record<string, TableMetadata> = {
            customers: {
                tableName: "customers",
                columns: [
                    { name: "id", dataType: "integer", isNullable: false, isPrimaryKey: true },
                    { name: "name", dataType: "character varying", isNullable: false, isPrimaryKey: false },
                    { name: "region", dataType: "character varying", isNullable: false, isPrimaryKey: false },
                    { name: "created_at", dataType: "timestamp with time zone", isNullable: false, isPrimaryKey: false },
                ],
                primaryKeys: ["id"],
                foreignKeys: [],
            },
            products: {
                tableName: "products",
                columns: [
                    { name: "id", dataType: "integer", isNullable: false, isPrimaryKey: true },
                    { name: "name", dataType: "character varying", isNullable: false, isPrimaryKey: false },
                    { name: "category", dataType: "character varying", isNullable: false, isPrimaryKey: false },
                    { name: "unit_price", dataType: "numeric", isNullable: false, isPrimaryKey: false },
                ],
                primaryKeys: ["id"],
                foreignKeys: [],
            },
            orders: {
                tableName: "orders",
                columns: [
                    { name: "id", dataType: "integer", isNullable: false, isPrimaryKey: true },
                    { name: "customer_id", dataType: "integer", isNullable: false, isPrimaryKey: false },
                    { name: "status", dataType: "character varying", isNullable: false, isPrimaryKey: false },
                    { name: "ordered_at", dataType: "timestamp with time zone", isNullable: false, isPrimaryKey: false },
                ],
                primaryKeys: ["id"],
                foreignKeys: [
                    { columnName: "customer_id", foreignTable: "customers", foreignColumn: "id" },
                ],
            },
            order_items: {
                tableName: "order_items",
                columns: [
                    { name: "id", dataType: "integer", isNullable: false, isPrimaryKey: true },
                    { name: "order_id", dataType: "integer", isNullable: false, isPrimaryKey: false },
                    { name: "product_id", dataType: "integer", isNullable: false, isPrimaryKey: false },
                    { name: "quantity", dataType: "integer", isNullable: false, isPrimaryKey: false },
                    { name: "unit_price", dataType: "numeric", isNullable: false, isPrimaryKey: false },
                ],
                primaryKeys: ["id"],
                foreignKeys: [
                    { columnName: "order_id", foreignTable: "orders", foreignColumn: "id" },
                    { columnName: "product_id", foreignTable: "products", foreignColumn: "id" },
                ],
            },
        };

        const versionHash = createHash("sha256")
            .update(JSON.stringify(tables))
            .digest("hex")
            .substring(0, 12);

        return {
            schemaVersion: `v1-${versionHash}`,
            tables,
            retrievedAt: new Date().toISOString(),
        };
    }


    private async introspectAndSanitize(): Promise<SanitizedCatalog> {
        if (!this.analyticsPool) {
            return this.getCanonicalCatalog();
        }

        const tableList = [...ALLOWED_TABLES];

        // 1. Fetch Column Details
        const columnsQuery = `
            SELECT 
                table_name, 
                column_name, 
                data_type, 
                is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ANY($1)
            ORDER BY table_name, ordinal_position;
        `;

        // 2. Fetch Primary Key Constraints
        const pkQuery = `
            SELECT 
                tc.table_name, 
                kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema = 'public'
              AND tc.table_name = ANY($1);
        `;

        // 3. Fetch Foreign Key Relationships
        const fkQuery = `
            SELECT
                kcu.table_name AS table_name,
                kcu.column_name AS column_name,
                ccu.table_name AS foreign_table,
                ccu.column_name AS foreign_column
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
             AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'public'
              AND kcu.table_name = ANY($1);
        `;

        const [columnsRes, pkRes, fkRes] = await Promise.all([
            this.analyticsPool.query(columnsQuery, [tableList]),
            this.analyticsPool.query(pkQuery, [tableList]),
            this.analyticsPool.query(fkQuery, [tableList]),
        ]);

        // Group Primary Keys by Table
        const primaryKeysByTable: Record<string, Set<string>> = {};
        for (const row of pkRes.rows) {
            if (!primaryKeysByTable[row.table_name]) {
                primaryKeysByTable[row.table_name] = new Set();
            }
            primaryKeysByTable[row.table_name].add(row.column_name);
        }

        // Group Foreign Keys by Table
        const foreignKeysByTable: Record<string, ForeignKeyRelationship[]> = {};
        for (const row of fkRes.rows) {
            // Only keep foreign keys pointing to allowed tables
            if (ALLOWED_TABLES.includes(row.foreign_table as AllowedTableName)) {
                if (!foreignKeysByTable[row.table_name]) {
                    foreignKeysByTable[row.table_name] = [];
                }
                foreignKeysByTable[row.table_name].push({
                    columnName: row.column_name,
                    foreignTable: row.foreign_table,
                    foreignColumn: row.foreign_column,
                });
            }
        }

        // Assemble Sanitized Tables
        const tables: Record<string, TableMetadata> = {};

        for (const tableName of ALLOWED_TABLES) {
            tables[tableName] = {
                tableName,
                columns: [],
                primaryKeys: Array.from(primaryKeysByTable[tableName] || []),
                foreignKeys: foreignKeysByTable[tableName] || [],
            };
        }

        // Populate and Sanitize Columns
        for (const row of columnsRes.rows) {
            const tbl = row.table_name as AllowedTableName;
            if (!ALLOWED_TABLES.includes(tbl)) continue;

            const allowedColsForTable = ALLOWED_COLUMNS[tbl];
            // Filter out non-allowed / sensitive columns
            if (allowedColsForTable && !allowedColsForTable.includes(row.column_name)) {
                continue;
            }

            const isPk = primaryKeysByTable[tbl]?.has(row.column_name) ?? false;

            const colMeta: ColumnMetadata = {
                name: row.column_name,
                dataType: row.data_type,
                isNullable: row.is_nullable === "YES",
                isPrimaryKey: isPk,
            };

            tables[tbl].columns.push(colMeta);
        }

        // Deterministic Schema Version Hash
        const versionHash = createHash("sha256")
            .update(JSON.stringify(tables))
            .digest("hex")
            .substring(0, 12);

        return {
            schemaVersion: `v1-${versionHash}`,
            tables,
            retrievedAt: new Date().toISOString(),
        };
    }
}
