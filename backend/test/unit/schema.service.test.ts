import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SchemaService } from "../../src/modules/schema/schema.service.js";
import { ALLOWED_TABLES, ALLOWED_COLUMNS } from "../../src/modules/schema/schema.types.js";
import type { Pool } from "pg";

describe("Task 1: Schema Introspection Allowlist & Sanitized Catalog Service (US-05)", () => {
    it("returns verified 4-table metadata dictionary with zero unapproved objects (canonical)", async () => {
        const schemaService = new SchemaService();
        const catalog = await schemaService.getSanitizedCatalog();

        assert.ok(catalog.schemaVersion.startsWith("v1-"), "Should have version hash");
        const tableNames = Object.keys(catalog.tables).sort();
        assert.deepEqual(tableNames, ["customers", "order_items", "orders", "products"]);

        // Verify no unapproved tables
        for (const tableName of Object.keys(catalog.tables)) {
            assert.ok(
                ALLOWED_TABLES.includes(tableName as any),
                `Table ${tableName} must be in allowlist`
            );
        }

        // Verify column allowlist
        for (const [table, meta] of Object.entries(catalog.tables)) {
            const allowedCols = ALLOWED_COLUMNS[table as keyof typeof ALLOWED_COLUMNS];
            for (const col of meta.columns) {
                assert.ok(
                    allowedCols.includes(col.name),
                    `Column ${col.name} on ${table} must be in column allowlist`
                );
            }
        }
    });

    it("filters out non-approved tables and sensitive columns when introspecting", async () => {
        // Mock Pool that includes forbidden tables and sensitive columns
        const mockPool = {
            query: async (queryText: string) => {
                if (queryText.includes("FROM information_schema.columns")) {
                    return {
                        rows: [
                            // Allowed columns
                            { table_name: "customers", column_name: "id", data_type: "integer", is_nullable: "NO" },
                            { table_name: "customers", column_name: "name", data_type: "text", is_nullable: "NO" },
                            { table_name: "customers", column_name: "region", data_type: "text", is_nullable: "NO" },
                            { table_name: "customers", column_name: "created_at", data_type: "timestamptz", is_nullable: "NO" },
                            // SENSITIVE / NON-APPROVED COLUMNS - MUST BE DROPPED
                            { table_name: "customers", column_name: "ssn", data_type: "text", is_nullable: "YES" },
                            { table_name: "customers", column_name: "credit_card", data_type: "text", is_nullable: "YES" },
                            // FORBIDDEN TABLE - MUST BE DROPPED
                            { table_name: "users", column_name: "password_hash", data_type: "text", is_nullable: "NO" },
                            { table_name: "orders", column_name: "id", data_type: "integer", is_nullable: "NO" },
                            { table_name: "orders", column_name: "customer_id", data_type: "integer", is_nullable: "NO" },
                            { table_name: "orders", column_name: "status", data_type: "text", is_nullable: "NO" },
                            { table_name: "orders", column_name: "ordered_at", data_type: "timestamptz", is_nullable: "NO" },
                            { table_name: "products", column_name: "id", data_type: "integer", is_nullable: "NO" },
                            { table_name: "products", column_name: "name", data_type: "text", is_nullable: "NO" },
                            { table_name: "products", column_name: "category", data_type: "text", is_nullable: "NO" },
                            { table_name: "products", column_name: "unit_price", data_type: "numeric", is_nullable: "NO" },
                            { table_name: "order_items", column_name: "id", data_type: "integer", is_nullable: "NO" },
                            { table_name: "order_items", column_name: "order_id", data_type: "integer", is_nullable: "NO" },
                            { table_name: "order_items", column_name: "product_id", data_type: "integer", is_nullable: "NO" },
                            { table_name: "order_items", column_name: "quantity", data_type: "integer", is_nullable: "NO" },
                            { table_name: "order_items", column_name: "unit_price", data_type: "numeric", is_nullable: "NO" },
                        ],
                    };
                }
                if (queryText.includes("tc.constraint_type = 'PRIMARY KEY'")) {
                    return {
                        rows: [
                            { table_name: "customers", column_name: "id" },
                            { table_name: "orders", column_name: "id" },
                            { table_name: "products", column_name: "id" },
                            { table_name: "order_items", column_name: "id" },
                            { table_name: "users", column_name: "id" },
                        ],
                    };
                }
                if (queryText.includes("tc.constraint_type = 'FOREIGN KEY'")) {
                    return {
                        rows: [
                            { table_name: "orders", column_name: "customer_id", foreign_table: "customers", foreignColumn: "id" },
                            { table_name: "order_items", column_name: "order_id", foreign_table: "orders", foreignColumn: "id" },
                            // Forbidden FK to unapproved table
                            { table_name: "orders", column_name: "secret_ref", foreign_table: "admin_secrets", foreignColumn: "id" },
                        ],
                    };
                }
                return { rows: [] };
            },
        } as unknown as Pool;

        const service = new SchemaService(mockPool);
        const catalog = await service.getSanitizedCatalog();

        assert.equal(Object.keys(catalog.tables).length, 4);
        assert.ok(!("users" in catalog.tables), "Unapproved table 'users' must be excluded");
        assert.ok(!("admin_secrets" in catalog.tables), "Unapproved table 'admin_secrets' must be excluded");

        const customerCols = catalog.tables.customers.columns.map((c) => c.name);
        assert.ok(!customerCols.includes("ssn"), "Sensitive column 'ssn' must be dropped");
        assert.ok(!customerCols.includes("credit_card"), "Sensitive column 'credit_card' must be dropped");

        const ordersFks = catalog.tables.orders.foreignKeys;
        assert.equal(ordersFks.length, 1);
        assert.equal(ordersFks[0].foreignTable, "customers");
    });

    it("caches catalog and reuses cached value until clearCache() is called", async () => {
        let queryCount = 0;
        const mockPool = {
            query: async () => {
                queryCount++;
                return { rows: [] };
            },
        } as unknown as Pool;

        const service = new SchemaService(mockPool);
        const first = await service.getSanitizedCatalog();
        const second = await service.getSanitizedCatalog();

        assert.equal(queryCount, 3); // 3 queries on first introspection (columns, pk, fk)
        assert.equal(first.schemaVersion, second.schemaVersion);

        // Clear cache and request again
        service.clearCache();
        await service.getSanitizedCatalog();
        assert.equal(queryCount, 6); // re-queried
    });

    it("formats sanitized catalog as clean Markdown for LLM prompt context injection", async () => {
        const schemaService = new SchemaService();
        const catalog = await schemaService.getSanitizedCatalog();
        const promptMd = schemaService.formatForPrompt(catalog);

        assert.ok(promptMd.includes("### Database Schema"));
        assert.ok(promptMd.includes("#### Table: `customers`"));
        assert.ok(promptMd.includes("#### Table: `orders`"));
        assert.ok(promptMd.includes("`customer_id` -> `customers.id`"));
    });
});
