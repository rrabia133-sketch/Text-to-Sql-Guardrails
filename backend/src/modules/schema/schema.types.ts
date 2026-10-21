// backend/src/modules/schema/schema.types.ts

export interface ColumnMetadata {
    name: string;
    dataType: string;
    isNullable: boolean;
    isPrimaryKey: boolean;
    description?: string;
}

export interface ForeignKeyRelationship {
    columnName: string;
    foreignTable: string;
    foreignColumn: string;
}

export interface TableMetadata {
    tableName: string;
    columns: ColumnMetadata[];
    primaryKeys: string[];
    foreignKeys: ForeignKeyRelationship[];
}

export interface SanitizedCatalog {
    schemaVersion: string;
    tables: Record<string, TableMetadata>;
    retrievedAt: string;
}

/**
 * Strict allowlist configuration:
 * Only approved tables and their approved columns can ever be returned.
 */
export const ALLOWED_TABLES = [
    "customers",
    "products",
    "orders",
    "order_items",
] as const;

export type AllowedTableName = typeof ALLOWED_TABLES[number];

/**
 * Optional: Map of allowed columns per table.
 * If a column is added to the database that is not on this list, it is dropped.
 */
export const ALLOWED_COLUMNS: Record<AllowedTableName, string[]> = {
    customers: ["id", "name", "region", "created_at"],
    products: ["id", "name", "category", "unit_price"],
    orders: ["id", "customer_id", "status", "ordered_at"],
    order_items: ["id", "order_id", "product_id", "quantity", "unit_price"],
};
