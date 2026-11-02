import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
    ConfidenceBand,
    ConfidenceScoreBreakdown,
    ConfidenceScoreResult,
    SemanticFinding,
    SemanticValidationResult,
    SemanticRepairAttempt,
    ReviewAcknowledgement,
} from "@text2sql/contracts";

export interface ArtifactSemanticMetadata {
    artifactId: string;
    confidenceScore: number;
    confidenceBand: ConfidenceBand;
    confidenceBreakdown: ConfidenceScoreBreakdown;
    confidenceResult?: ConfidenceScoreResult;
    semanticFindings: SemanticFinding[];
    semanticValidation?: SemanticValidationResult;
    repairAttempts: number;
    repairAttempt?: SemanticRepairAttempt;
    reviewAcknowledged: boolean;
    acknowledgedAt: string | null;
    reviewedWarnings?: string[];
    analystNote?: string;
    updatedAt: string;
}

export interface SaveArtifactSemanticMetadataParams {
    artifactId: string;
    confidenceScore: number;
    confidenceBand: ConfidenceBand;
    confidenceBreakdown: ConfidenceScoreBreakdown;
    confidenceResult?: ConfidenceScoreResult;
    semanticFindings: SemanticFinding[];
    semanticValidation?: SemanticValidationResult;
    repairAttempts?: number;
    repairAttempt?: SemanticRepairAttempt;
    reviewAcknowledged?: boolean;
    acknowledgedAt?: string | null;
}

export interface SemanticEvaluationRecord {
    id: string;
    datasetVersion: string;
    modelId: string;
    promptVersion: string;
    totalCases: number;
    accuracyScore: number;
    wrongAnswerCount: number;
    refusalRecall: number;
    metricsPayload: Record<string, unknown>;
    createdAt: string;
}

export interface CreateSemanticEvaluationParams {
    id?: string;
    datasetVersion: string;
    modelId: string;
    promptVersion: string;
    totalCases: number;
    accuracyScore: number;
    wrongAnswerCount: number;
    refusalRecall: number;
    metricsPayload?: Record<string, unknown>;
}

export class SemanticRepository {
    private pool?: Pool | null;
    private artifactMetadataStore: Map<string, ArtifactSemanticMetadata> = new Map();
    private evaluationsStore: Map<string, SemanticEvaluationRecord> = new Map();

    constructor(pool?: Pool | null) {
        this.pool = pool;
    }

    /**
     * Persists confidence scores, component breakdown, semantic findings, and repair attempts for a query artifact.
     */
    async saveArtifactSemanticMetadata(
        params: SaveArtifactSemanticMetadataParams
    ): Promise<ArtifactSemanticMetadata> {
        const now = new Date().toISOString();

        const record: ArtifactSemanticMetadata = {
            artifactId: params.artifactId,
            confidenceScore: params.confidenceScore,
            confidenceBand: params.confidenceBand,
            confidenceBreakdown: params.confidenceBreakdown,
            confidenceResult: params.confidenceResult,
            semanticFindings: params.semanticFindings,
            semanticValidation: params.semanticValidation,
            repairAttempts: params.repairAttempts ?? (params.repairAttempt ? params.repairAttempt.attemptNumber : 0),
            repairAttempt: params.repairAttempt,
            reviewAcknowledged: params.reviewAcknowledged ?? false,
            acknowledgedAt: params.acknowledgedAt ?? null,
            updatedAt: now,
        };

        if (this.pool) {
            try {
                const query = `
                    UPDATE query_artifacts
                    SET confidence_score = $1,
                        confidence_band = $2,
                        confidence_breakdown = $3,
                        semantic_findings = $4,
                        repair_attempts = $5,
                        review_acknowledged = $6,
                        acknowledged_at = $7,
                        updated_at = $8
                    WHERE id = $9
                    RETURNING *;
                `;
                await this.pool.query(query, [
                    record.confidenceScore,
                    record.confidenceBand,
                    JSON.stringify(record.confidenceBreakdown),
                    JSON.stringify(record.semanticFindings),
                    record.repairAttempts,
                    record.reviewAcknowledged,
                    record.acknowledgedAt,
                    record.updatedAt,
                    record.artifactId,
                ]);
            } catch {
                // Fallback to in-memory storage when DB is offline
            }
        }

        this.artifactMetadataStore.set(record.artifactId, record);
        return record;
    }

    /**
     * Retrieves semantic validation and confidence scoring metadata for a query artifact.
     */
    async getArtifactSemanticMetadata(artifactId: string): Promise<ArtifactSemanticMetadata | null> {
        if (this.pool) {
            try {
                const query = `
                    SELECT
                        id,
                        confidence_score,
                        confidence_band,
                        confidence_breakdown,
                        semantic_findings,
                        repair_attempts,
                        review_acknowledged,
                        acknowledged_at,
                        updated_at
                    FROM query_artifacts
                    WHERE id = $1;
                `;
                const res = await this.pool.query(query, [artifactId]);
                if (res.rows?.[0] && res.rows[0].confidence_score !== null) {
                    const row = res.rows[0];
                    const cached = this.artifactMetadataStore.get(artifactId);
                    return {
                        artifactId: row.id,
                        confidenceScore: Number(row.confidence_score),
                        confidenceBand: row.confidence_band as ConfidenceBand,
                        confidenceBreakdown:
                            typeof row.confidence_breakdown === "string"
                                ? JSON.parse(row.confidence_breakdown)
                                : row.confidence_breakdown,
                        confidenceResult: cached?.confidenceResult,
                        semanticFindings:
                            typeof row.semantic_findings === "string"
                                ? JSON.parse(row.semantic_findings)
                                : row.semantic_findings || [],
                        semanticValidation: cached?.semanticValidation,
                        repairAttempts: Number(row.repair_attempts ?? 0),
                        repairAttempt: cached?.repairAttempt,
                        reviewAcknowledged: Boolean(row.review_acknowledged),
                        acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at).toISOString() : null,
                        reviewedWarnings: cached?.reviewedWarnings,
                        analystNote: cached?.analystNote,
                        updatedAt: new Date(row.updated_at).toISOString(),
                    };
                }
            } catch {
                // Fallback to in-memory store
            }
        }

        return this.artifactMetadataStore.get(artifactId) || null;
    }

    /**
     * Records analyst review acknowledgement for a medium-confidence ('REVIEW' band) artifact.
     */
    async recordReviewAcknowledgement(
        artifactId: string,
        acknowledgement: ReviewAcknowledgement
    ): Promise<ArtifactSemanticMetadata | null> {
        const acknowledgedAt = acknowledgement.acknowledgedAt || new Date().toISOString();

        if (this.pool) {
            try {
                const query = `
                    UPDATE query_artifacts
                    SET review_acknowledged = $1,
                        acknowledged_at = $2,
                        updated_at = $2
                    WHERE id = $3
                    RETURNING *;
                `;
                await this.pool.query(query, [
                    acknowledgement.confirmed,
                    acknowledgedAt,
                    artifactId,
                ]);
            } catch {
                // Fallback to in-memory
            }
        }

        const existing = this.artifactMetadataStore.get(artifactId);
        if (!existing) {
            return null;
        }

        const updated: ArtifactSemanticMetadata = {
            ...existing,
            reviewAcknowledged: acknowledgement.confirmed,
            acknowledgedAt,
            reviewedWarnings: acknowledgement.reviewedWarnings,
            analystNote: acknowledgement.analystNote,
            updatedAt: acknowledgedAt,
        };

        this.artifactMetadataStore.set(artifactId, updated);
        return updated;
    }

    /**
     * Records a semantic evaluation benchmark run in the semantic_evaluations ledger.
     */
    async recordEvaluationRun(
        params: CreateSemanticEvaluationParams
    ): Promise<SemanticEvaluationRecord> {
        const id = params.id || `eval_${randomUUID()}`;
        const createdAt = new Date().toISOString();

        const record: SemanticEvaluationRecord = {
            id,
            datasetVersion: params.datasetVersion,
            modelId: params.modelId,
            promptVersion: params.promptVersion,
            totalCases: params.totalCases,
            accuracyScore: Math.round(params.accuracyScore * 10000) / 10000,
            wrongAnswerCount: params.wrongAnswerCount,
            refusalRecall: Math.round(params.refusalRecall * 10000) / 10000,
            metricsPayload: params.metricsPayload ?? {},
            createdAt,
        };

        if (this.pool) {
            try {
                const query = `
                    INSERT INTO semantic_evaluations (
                        id, dataset_version, model_id, prompt_version,
                        total_cases, accuracy_score, wrong_answer_count,
                        refusal_recall, metrics_payload, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    RETURNING *;
                `;
                await this.pool.query(query, [
                    record.id,
                    record.datasetVersion,
                    record.modelId,
                    record.promptVersion,
                    record.totalCases,
                    record.accuracyScore,
                    record.wrongAnswerCount,
                    record.refusalRecall,
                    JSON.stringify(record.metricsPayload),
                    record.createdAt,
                ]);
            } catch {
                // Fallback to in-memory
            }
        }

        this.evaluationsStore.set(record.id, record);
        return record;
    }

    /**
     * Retrieves a semantic evaluation run by ID.
     */
    async getEvaluationRunById(id: string): Promise<SemanticEvaluationRecord | null> {
        if (this.pool) {
            try {
                const query = `SELECT * FROM semantic_evaluations WHERE id = $1;`;
                const res = await this.pool.query(query, [id]);
                if (res.rows?.[0]) {
                    return this.mapEvaluationRow(res.rows[0]);
                }
            } catch {
                // Fallback to in-memory
            }
        }

        return this.evaluationsStore.get(id) || null;
    }

    /**
     * Lists semantic evaluation runs, optionally filtered by dataset version.
     */
    async listEvaluationRuns(datasetVersion?: string): Promise<SemanticEvaluationRecord[]> {
        if (this.pool) {
            try {
                const query = datasetVersion
                    ? `SELECT * FROM semantic_evaluations WHERE dataset_version = $1 ORDER BY created_at DESC;`
                    : `SELECT * FROM semantic_evaluations ORDER BY created_at DESC;`;
                const values = datasetVersion ? [datasetVersion] : [];
                const res = await this.pool.query(query, values);
                if (res.rows) {
                    return res.rows.map((r) => this.mapEvaluationRow(r));
                }
            } catch {
                // Fallback to in-memory
            }
        }

        const all = Array.from(this.evaluationsStore.values());
        const filtered = datasetVersion
            ? all.filter((e) => e.datasetVersion === datasetVersion)
            : all;

        return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    /**
     * Clears in-memory stores for testing.
     */
    clear(): void {
        this.artifactMetadataStore.clear();
        this.evaluationsStore.clear();
    }

    private mapEvaluationRow(row: any): SemanticEvaluationRecord {
        return {
            id: row.id,
            datasetVersion: row.dataset_version,
            modelId: row.model_id,
            promptVersion: row.prompt_version,
            totalCases: Number(row.total_cases),
            accuracyScore: Number(row.accuracy_score),
            wrongAnswerCount: Number(row.wrong_answer_count),
            refusalRecall: Number(row.refusal_recall),
            metricsPayload:
                typeof row.metrics_payload === "string"
                    ? JSON.parse(row.metrics_payload)
                    : row.metrics_payload || {},
            createdAt: new Date(row.created_at).toISOString(),
        };
    }
}

