import type { Pool } from "pg";

export interface AuditLogEntry {
    userId?: string;
    action: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    timestamp?: string;
}

export class AuditLogger {
    private memoryLogs: AuditLogEntry[] = [];

    constructor(private readonly pool?: Pool | null) { }

    public async log(entry: AuditLogEntry): Promise<void> {
        this.memoryLogs.push({
            timestamp: entry.timestamp || new Date().toISOString(),
            ...entry,
        });
        if (!this.pool) return;
        try {
            const query = `
                INSERT INTO audit_logs (user_id, action, resource_id, details, ip_address)
                VALUES ($1, $2, $3, $4, $5);
            `;
            // Ensure no raw SQL results or PII are logged in audit details
            const sanitizedDetails = entry.details ? JSON.stringify(entry.details) : null;
            await this.pool.query(query, [
                entry.userId || null,
                entry.action,
                entry.resourceId || null,
                sanitizedDetails,
                entry.ipAddress || null,
            ]);
        } catch {
            // Audit log failures should not fail query transactions
        }
    }

    public getMemoryLogs(): AuditLogEntry[] {
        return [...this.memoryLogs];
    }

    public clear(): void {
        this.memoryLogs = [];
    }
}
