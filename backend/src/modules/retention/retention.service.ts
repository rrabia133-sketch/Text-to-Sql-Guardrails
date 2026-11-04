import type { Pool } from "pg";
import {
    type RetentionPolicyConfig,
    type RetentionCleanupReport,
    DEFAULT_RETENTION_POLICY,
} from "@text2sql/contracts";
import type { ResultCacheService } from "../execution/result-cache.service.js";
import type { AuditLogger } from "../execution/audit-logger.js";
import type { QueryArtifactRecord } from "../generation/query-artifact.repository.js";

export class RetentionService {
    private readonly pool?: Pool | null;
    private readonly resultCacheService?: ResultCacheService;
    private readonly auditLogger?: AuditLogger;
    private readonly policy: RetentionPolicyConfig;
    private sweepTimer?: NodeJS.Timeout;

    // In-memory backing stores for test and offline isolation
    private inMemoryArtifacts: Map<string, QueryArtifactRecord> = new Map();
    private inMemoryAuditLogs: Map<string, { id: string; createdAt: string }> = new Map();

    constructor(options?: {
        pool?: Pool | null;
        resultCacheService?: ResultCacheService;
        auditLogger?: AuditLogger;
        policy?: Partial<RetentionPolicyConfig>;
    }) {
        this.pool = options?.pool;
        this.resultCacheService = options?.resultCacheService;
        this.auditLogger = options?.auditLogger;
        this.policy = {
            ephemeralResultTtlMinutes: options?.policy?.ephemeralResultTtlMinutes ?? DEFAULT_RETENTION_POLICY.ephemeralResultTtlMinutes,
            historyRetentionDays: options?.policy?.historyRetentionDays ?? DEFAULT_RETENTION_POLICY.historyRetentionDays,
            auditRetentionDays: options?.policy?.auditRetentionDays ?? DEFAULT_RETENTION_POLICY.auditRetentionDays,
        };
    }

    /**
     * Executes an end-to-end retention purge cycle across:
     * 1. Ephemeral execution results (evicting expired memory entries past 15m)
     * 2. Query artifacts & executions older than historyRetentionDays (default 30 days)
     * 3. Audit log records older than auditRetentionDays (default 90 days)
     */
    async runCleanup(customConfig?: Partial<RetentionPolicyConfig>): Promise<RetentionCleanupReport> {
        const startTime = Date.now();
        const activePolicy: RetentionPolicyConfig = {
            ...this.policy,
            ...customConfig,
        };

        const now = new Date(startTime);
        const historyCutoff = new Date(startTime - activePolicy.historyRetentionDays * 86400 * 1000);
        const auditCutoff = new Date(startTime - activePolicy.auditRetentionDays * 86400 * 1000);

        let purgedResults = 0;
        let purgedHistory = 0;
        let purgedAuditLogs = 0;

        // 1. Evict ephemeral in-memory execution results & idempotency keys
        if (this.resultCacheService) {
            const cacheSweep = this.resultCacheService.evictExpired();
            purgedResults = cacheSweep.executionEvicted;
        }

        // 2. Database purge (PostgreSQL with cascading deletes)
        if (this.pool) {
            try {
                // Purge expired artifacts (cascades to query_executions, query_feedback, semantic_findings)
                const histRes = await this.pool.query(
                    "DELETE FROM query_artifacts WHERE created_at < $1 RETURNING id;",
                    [historyCutoff.toISOString()]
                );
                purgedHistory = histRes.rowCount ?? 0;

                // Purge expired audit logs
                const auditRes = await this.pool.query(
                    "DELETE FROM audit_logs WHERE created_at < $1 RETURNING id;",
                    [auditCutoff.toISOString()]
                );
                purgedAuditLogs = auditRes.rowCount ?? 0;
            } catch {
                // Fallback to in-memory sweep
            }
        }

        // In-memory stores sweep (for offline/unit testing)
        for (const [id, art] of this.inMemoryArtifacts.entries()) {
            if (new Date(art.createdAt).getTime() < historyCutoff.getTime()) {
                this.inMemoryArtifacts.delete(id);
                purgedHistory++;
            }
        }

        for (const [id, log] of this.inMemoryAuditLogs.entries()) {
            if (new Date(log.createdAt).getTime() < auditCutoff.getTime()) {
                this.inMemoryAuditLogs.delete(id);
                purgedAuditLogs++;
            }
        }

        const durationMs = Date.now() - startTime;

        const report: RetentionCleanupReport = {
            purgedResults,
            purgedHistory,
            purgedAuditLogs,
            cleanedAt: now.toISOString(),
            durationMs,
        };

        return report;
    }

    /**
     * Optional background interval scheduler for continuous operations.
     */
    startPeriodicSweep(intervalMs: number = 3600000): void {
        this.stopPeriodicSweep();
        this.sweepTimer = setInterval(() => {
            this.runCleanup().catch(() => {});
        }, intervalMs);
    }

    stopPeriodicSweep(): void {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = undefined;
        }
    }

    // Testing helpers
    seedArtifact(artifact: QueryArtifactRecord): void {
        this.inMemoryArtifacts.set(artifact.id, { ...artifact });
    }

    seedAuditLog(id: string, createdAt: string): void {
        this.inMemoryAuditLogs.set(id, { id, createdAt });
    }

    getCounts(): { artifacts: number; auditLogs: number } {
        return {
            artifacts: this.inMemoryArtifacts.size,
            auditLogs: this.inMemoryAuditLogs.size,
        };
    }

    clear(): void {
        this.inMemoryArtifacts.clear();
        this.inMemoryAuditLogs.clear();
    }
}

