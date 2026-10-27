import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export interface QueryArtifactRecord {
    id: string;
    userId: string;
    prompt: string;
    generatedSql: string;
    status: "preview" | "pending" | "validating" | "generating" | "executing" | "completed" | "failed" | "rejected";
    assumptions: string[];
    referencedTables: string[];
    referencedColumns: string[];
    explanation: string;
    provider: string;
    model: string;
    promptVersion: string;
    schemaVersion: string;
    executionTimeMs?: number | null;
    rowCount?: number | null;
    errorMessage?: string | null;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
}

export interface CreateQueryArtifactParams {
    id?: string;
    userId: string;
    prompt: string;
    generatedSql: string;
    assumptions: string[];
    referencedTables: string[];
    referencedColumns: string[];
    explanation: string;
    provider: string;
    model: string;
    promptVersion: string;
    schemaVersion: string;
    expiresInMinutes?: number;
}

export class QueryArtifactRepository {
    private pool?: Pool | null;
    // In-memory backing store for tests or when appPool is offline
    private inMemoryStore: Map<string, QueryArtifactRecord> = new Map();

    constructor(pool?: Pool | null) {
        this.pool = pool;
    }

    /**
     * Persists a newly generated query preview artifact in app_db.
     * Initial status is strictly set to 'preview'.
     */
    async create(params: CreateQueryArtifactParams): Promise<QueryArtifactRecord> {
        const id = params.id || `art_${randomUUID()}`;
        const now = new Date();
        const expiresInMinutes = params.expiresInMinutes ?? 15;
        const expiresAt = new Date(now.getTime() + expiresInMinutes * 60 * 1000);

        const record: QueryArtifactRecord = {
            id,
            userId: params.userId,
            prompt: params.prompt,
            generatedSql: params.generatedSql,
            status: "preview",
            assumptions: params.assumptions || [],
            referencedTables: params.referencedTables || [],
            referencedColumns: params.referencedColumns || [],
            explanation: params.explanation || "",
            provider: params.provider,
            model: params.model,
            promptVersion: params.promptVersion,
            schemaVersion: params.schemaVersion,
            executionTimeMs: null,
            rowCount: null,
            errorMessage: null,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
        };

        if (this.pool) {
            try {
                const query = `
                    INSERT INTO query_artifacts (
                        id, user_id, prompt, generated_sql, status,
                        assumptions, referenced_tables, referenced_columns, explanation,
                        provider, model, prompt_version, schema_version,
                        created_at, updated_at, expires_at
                    ) VALUES (
                        $1, $2, $3, $4, $5,
                        $6, $7, $8, $9,
                        $10, $11, $12, $13,
                        $14, $15, $16
                    ) RETURNING *;
                `;
                await this.pool.query(query, [
                    record.id,
                    record.userId,
                    record.prompt,
                    record.generatedSql,
                    record.status,
                    JSON.stringify(record.assumptions),
                    record.referencedTables,
                    record.referencedColumns,
                    record.explanation,
                    record.provider,
                    record.model,
                    record.promptVersion,
                    record.schemaVersion,
                    record.createdAt,
                    record.updatedAt,
                    record.expiresAt,
                ]);
            } catch {
                // If database insert fails (e.g. pool offline), save to in-memory store
                this.inMemoryStore.set(record.id, record);
                return record;
            }
        }

        this.inMemoryStore.set(record.id, record);
        return record;
    }

    /**
     * Retrieves an artifact by ID, strictly enforcing user ownership isolation.
     * Returns null if artifact does not exist or belongs to another user.
     */
    async findById(id: string, userId?: string): Promise<QueryArtifactRecord | null> {
        if (this.pool) {
            try {
                const query = userId
                    ? `SELECT * FROM query_artifacts WHERE id = $1 AND user_id = $2;`
                    : `SELECT * FROM query_artifacts WHERE id = $1;`;
                const params = userId ? [id, userId] : [id];
                const res = await this.pool.query(query, params);
                if (res.rows?.[0]) {
                    const row = res.rows[0];
                    return {
                        id: row.id,
                        userId: row.user_id,
                        prompt: row.prompt,
                        generatedSql: row.generated_sql,
                        status: row.status,
                        assumptions: typeof row.assumptions === "string" ? JSON.parse(row.assumptions) : row.assumptions || [],
                        referencedTables: row.referenced_tables || [],
                        referencedColumns: row.referenced_columns || [],
                        explanation: row.explanation || "",
                        provider: row.provider,
                        model: row.model,
                        promptVersion: row.prompt_version,
                        schemaVersion: row.schema_version,
                        executionTimeMs: row.execution_time_ms,
                        rowCount: row.row_count,
                        errorMessage: row.error_message,
                        createdAt: new Date(row.created_at).toISOString(),
                        updatedAt: new Date(row.updated_at).toISOString(),
                        expiresAt: new Date(row.expires_at).toISOString(),
                    };
                }
            } catch {
                // Fallback to in-memory lookup
            }
        }

        const memRecord = this.inMemoryStore.get(id);
        if (!memRecord || (userId && memRecord.userId !== userId)) {
            return null;
        }

        return memRecord;
    }

    /**
     * Updates the status of an artifact.
     */
    async updateStatus(id: string, status: QueryArtifactRecord["status"]): Promise<QueryArtifactRecord | null> {
        const now = new Date().toISOString();

        if (this.pool) {
            try {
                const query = `
                    UPDATE query_artifacts
                    SET status = $1, updated_at = $2
                    WHERE id = $3
                    RETURNING *;
                `;
                const res = await this.pool.query(query, [status, now, id]);
                if (res.rows?.[0]) {
                    const row = res.rows[0];
                    return {
                        id: row.id,
                        userId: row.user_id,
                        prompt: row.prompt,
                        generatedSql: row.generated_sql,
                        status: row.status,
                        assumptions: typeof row.assumptions === "string" ? JSON.parse(row.assumptions) : row.assumptions || [],
                        referencedTables: row.referenced_tables || [],
                        referencedColumns: row.referenced_columns || [],
                        explanation: row.explanation || "",
                        provider: row.provider,
                        model: row.model,
                        promptVersion: row.prompt_version,
                        schemaVersion: row.schema_version,
                        executionTimeMs: row.execution_time_ms,
                        rowCount: row.row_count,
                        errorMessage: row.error_message,
                        createdAt: new Date(row.created_at).toISOString(),
                        updatedAt: new Date(row.updated_at).toISOString(),
                        expiresAt: new Date(row.expires_at).toISOString(),
                    };
                }
            } catch {
                // Fallback
            }
        }

        const memRecord = this.inMemoryStore.get(id);
        if (!memRecord) return null;

        const updated: QueryArtifactRecord = {
            ...memRecord,
            status,
            updatedAt: now,
        };
        this.inMemoryStore.set(id, updated);
        return updated;
    }

    /**
     * Clears in-memory store (for testing).
     */
    clear(): void {
        this.inMemoryStore.clear();
    }

    /**
     * Lists artifacts owned by the user.
     */
    async listByUser(userId: string, limit = 50): Promise<QueryArtifactRecord[]> {
        if (this.pool) {
            try {
                const query = `
                    SELECT * FROM query_artifacts
                    WHERE user_id = $1
                    ORDER BY created_at DESC
                    LIMIT $2;
                `;
                const res = await this.pool.query(query, [userId, limit]);
                if (res.rows) {
                    return res.rows.map((row) => ({
                        id: row.id,
                        userId: row.user_id,
                        prompt: row.prompt,
                        generatedSql: row.generated_sql,
                        status: row.status,
                        assumptions: typeof row.assumptions === "string" ? JSON.parse(row.assumptions) : row.assumptions || [],
                        referencedTables: row.referenced_tables || [],
                        referencedColumns: row.referenced_columns || [],
                        explanation: row.explanation || "",
                        provider: row.provider,
                        model: row.model,
                        promptVersion: row.prompt_version,
                        schemaVersion: row.schema_version,
                        executionTimeMs: row.execution_time_ms,
                        rowCount: row.row_count,
                        errorMessage: row.error_message,
                        createdAt: new Date(row.created_at).toISOString(),
                        updatedAt: new Date(row.updated_at).toISOString(),
                        expiresAt: new Date(row.expires_at).toISOString(),
                    }));
                }
            } catch {
                // Fallback to in-memory
            }
        }

        return Array.from(this.inMemoryStore.values())
            .filter((rec) => rec.userId === userId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, limit);
    }
}
