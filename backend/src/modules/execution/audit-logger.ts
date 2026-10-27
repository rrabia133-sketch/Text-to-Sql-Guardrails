import type { Pool } from "pg";

export interface AuditLogEntry {
    userId?: string;
    action: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
}

export class AuditLogger {
    constructor(private readonly pool?: Pool | null) { }

    public async log(entry: AuditLogEntry): Promise<void> {
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
}
