import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
    HistoryItemSummary,
    PaginatedHistoryResponse,
    FeedbackVerdict,
    FeedbackReasonCode,
    FeedbackRecord,
} from "@text2sql/contracts";
import type { QueryArtifactRecord } from "../generation/query-artifact.repository.js";

export interface PaginationOptions {
    limit?: number;
    offset?: number;
}

export interface SaveFeedbackParams {
    id?: string;
    artifactId: string;
    userId: string;
    verdict: FeedbackVerdict;
    reasonCode?: FeedbackReasonCode;
    notes?: string;
}

export class HistoryRepository {
    private pool?: Pool | null;

    // In-memory fallback backing stores for offline execution and isolated testing
    private inMemoryArtifacts: Map<string, QueryArtifactRecord> = new Map();
    private inMemoryFeedback: Map<string, FeedbackRecord> = new Map();
    private inMemoryConfidence: Map<string, { score?: number; band?: any }> = new Map();
    private inMemoryExecutions: Map<string, { executedAt?: string; status?: string }> = new Map();

    constructor(pool?: Pool | null) {
        this.pool = pool;
    }

    /**
     * Retrieves paginated query history for a specific user, filtering out soft-deleted queries.
     * Ordered by createdAt descending.
     */
    async listUserHistory(
        userId: string,
        options?: PaginationOptions
    ): Promise<PaginatedHistoryResponse> {
        const limit = Math.max(1, options?.limit ?? 20);
        const offset = Math.max(0, options?.offset ?? 0);

        if (this.pool) {
            try {
                const countQuery = `
                    SELECT COUNT(*)::int as count
                    FROM query_artifacts
                    WHERE user_id = $1 AND deleted_at IS NULL;
                `;
                const countRes = await this.pool.query(countQuery, [userId]);
                const total = countRes.rows[0]?.count ?? 0;

                const itemsQuery = `
                    SELECT 
                        a.id as artifact_id,
                        a.prompt as question,
                        a.generated_sql as sql,
                        a.status,
                        a.provider,
                        a.model,
                        a.created_at,
                        sf.confidence_score,
                        sf.confidence_band,
                        e.created_at as executed_at,
                        e.status as last_execution_status
                    FROM query_artifacts a
                    LEFT JOIN semantic_findings sf ON a.id = sf.artifact_id
                    LEFT JOIN LATERAL (
                        SELECT created_at, status FROM query_executions
                        WHERE artifact_id = a.id
                        ORDER BY created_at DESC LIMIT 1
                    ) e ON true
                    WHERE a.user_id = $1 AND a.deleted_at IS NULL
                    ORDER BY a.created_at DESC
                    LIMIT $2 OFFSET $3;
                `;
                const itemsRes = await this.pool.query(itemsQuery, [userId, limit, offset]);

                const items: HistoryItemSummary[] = itemsRes.rows.map((r) => ({
                    artifactId: r.artifact_id,
                    question: r.question,
                    sql: r.sql,
                    status: r.status,
                    confidenceScore: r.confidence_score !== null && r.confidence_score !== undefined
                        ? Number(r.confidence_score)
                        : undefined,
                    confidenceBand: r.confidence_band || undefined,
                    provider: r.provider,
                    model: r.model,
                    createdAt: new Date(r.created_at).toISOString(),
                    executedAt: r.executed_at ? new Date(r.executed_at).toISOString() : undefined,
                    lastExecutionStatus: r.last_execution_status || undefined,
                }));

                return {
                    items,
                    total,
                    limit,
                    offset,
                    hasMore: offset + items.length < total,
                };
            } catch {
                // Fallback to in-memory store
            }
        }

        // In-memory fallback
        const matching = Array.from(this.inMemoryArtifacts.values())
            .filter((a) => a.userId === userId && !a.deletedAt)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        const total = matching.length;
        const page = matching.slice(offset, offset + limit);

        const items: HistoryItemSummary[] = page.map((a) => {
            const conf = this.inMemoryConfidence.get(a.id);
            const exec = this.inMemoryExecutions.get(a.id);
            return {
                artifactId: a.id,
                question: a.prompt,
                sql: a.generatedSql,
                status: a.status as any,
                confidenceScore: conf?.score,
                confidenceBand: conf?.band,
                provider: a.provider,
                model: a.model,
                createdAt: a.createdAt,
                executedAt: exec?.executedAt,
                lastExecutionStatus: exec?.status,
            };
        });

        return {
            items,
            total,
            limit,
            offset,
            hasMore: offset + items.length < total,
        };
    }

    /**
     * Soft deletes a user's query artifact, enforcing strict owner check.
     */
    async deleteUserArtifact(
        userId: string,
        artifactId: string
    ): Promise<{ ok: boolean; status: "DELETED" | "NOT_FOUND" | "FORBIDDEN" }> {
        if (this.pool) {
            try {
                // Check existence and ownership
                const checkRes = await this.pool.query(
                    "SELECT user_id, deleted_at FROM query_artifacts WHERE id = $1;",
                    [artifactId]
                );

                if (checkRes.rows.length === 0 || checkRes.rows[0].deleted_at !== null) {
                    return { ok: false, status: "NOT_FOUND" };
                }

                if (checkRes.rows[0].user_id !== userId) {
                    return { ok: false, status: "FORBIDDEN" };
                }

                await this.pool.query(
                    "UPDATE query_artifacts SET deleted_at = NOW() WHERE id = $1 AND user_id = $2;",
                    [artifactId, userId]
                );

                return { ok: true, status: "DELETED" };
            } catch {
                // Fallback
            }
        }

        const artifact = this.inMemoryArtifacts.get(artifactId);
        if (!artifact || artifact.deletedAt) {
            return { ok: false, status: "NOT_FOUND" };
        }

        if (artifact.userId !== userId) {
            return { ok: false, status: "FORBIDDEN" };
        }

        artifact.deletedAt = new Date().toISOString();
        return { ok: true, status: "DELETED" };
    }

    /**
     * Persists analyst feedback for a query artifact.
     */
    async saveFeedback(params: SaveFeedbackParams): Promise<FeedbackRecord> {
        const id = params.id || `fb_${randomUUID()}`;
        const now = new Date().toISOString();

        const record: FeedbackRecord = {
            id,
            artifactId: params.artifactId,
            userId: params.userId,
            verdict: params.verdict,
            reasonCode: params.reasonCode,
            notes: params.notes,
            createdAt: now,
        };

        if (this.pool) {
            try {
                const query = `
                    INSERT INTO query_feedback (id, artifact_id, user_id, verdict, reason_code, notes, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    RETURNING *;
                `;
                const res = await this.pool.query(query, [
                    record.id,
                    record.artifactId,
                    record.userId,
                    record.verdict,
                    record.reasonCode || null,
                    record.notes || null,
                    record.createdAt,
                ]);
                const row = res.rows[0];
                return {
                    id: row.id,
                    artifactId: row.artifact_id,
                    userId: row.user_id,
                    verdict: row.verdict,
                    reasonCode: row.reason_code || undefined,
                    notes: row.notes || undefined,
                    createdAt: new Date(row.created_at).toISOString(),
                };
            } catch {
                // Fallback
            }
        }

        this.inMemoryFeedback.set(record.id, record);
        return record;
    }

    /**
     * Retrieves the latest feedback submitted for an artifact.
     */
    async getFeedbackForArtifact(artifactId: string, userId?: string): Promise<FeedbackRecord | null> {
        if (this.pool) {
            try {
                const query = userId
                    ? "SELECT * FROM query_feedback WHERE artifact_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1;"
                    : "SELECT * FROM query_feedback WHERE artifact_id = $1 ORDER BY created_at DESC LIMIT 1;";
                const params = userId ? [artifactId, userId] : [artifactId];
                const res = await this.pool.query(query, params);
                if (res.rows.length > 0) {
                    const row = res.rows[0];
                    return {
                        id: row.id,
                        artifactId: row.artifact_id,
                        userId: row.user_id,
                        verdict: row.verdict,
                        reasonCode: row.reason_code || undefined,
                        notes: row.notes || undefined,
                        createdAt: new Date(row.created_at).toISOString(),
                    };
                }
                return null;
            } catch {
                // Fallback
            }
        }

        const match = Array.from(this.inMemoryFeedback.values())
            .filter((f) => f.artifactId === artifactId && (!userId || f.userId === userId))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

        return match || null;
    }

    /**
     * Seeds in-memory query artifact record (useful for testing and offline execution).
     */
    seedArtifact(artifact: QueryArtifactRecord, confidence?: { score?: number; band?: any }, execution?: { executedAt?: string; status?: string }): void {
        this.inMemoryArtifacts.set(artifact.id, { ...artifact });
        if (confidence) {
            this.inMemoryConfidence.set(artifact.id, confidence);
        }
        if (execution) {
            this.inMemoryExecutions.set(artifact.id, execution);
        }
    }

    clear(): void {
        this.inMemoryArtifacts.clear();
        this.inMemoryFeedback.clear();
        this.inMemoryConfidence.clear();
        this.inMemoryExecutions.clear();
    }
}

