import {
    randomBytes,
    createCipheriv,
    createDecipheriv,
    scryptSync,
    createHash,
} from "node:crypto";
import type { Pool } from "pg";

export interface EncryptedBackupEnvelope {
    version: string;
    algorithm: "aes-256-gcm";
    salt: string;
    iv: string;
    authTag: string;
    ciphertext: string;
    checksum: string;
    createdAt: string;
    metadata: {
        recordCounts: Record<string, number>;
        totalRecords: number;
    };
}

export interface DecryptedBackupPayload {
    exportedAt: string;
    version: string;
    tables: Record<string, unknown[]>;
}

export class BackupService {
    private pool?: Pool | null;

    constructor(pool?: Pool | null) {
        this.pool = pool;
    }

    /**
     * Dumps metadata tables and encrypts with AES-256-GCM.
     */
    public async createEncryptedBackup(
        passphrase: string,
        mockTablesData?: Record<string, unknown[]>
    ): Promise<EncryptedBackupEnvelope> {
        if (!passphrase || passphrase.length < 8) {
            throw new Error("Backup passphrase must be at least 8 characters long.");
        }

        const tables: Record<string, unknown[]> = mockTablesData || {};

        if (this.pool && !mockTablesData) {
            const tableNames = ["query_artifacts", "query_feedback", "audit_logs", "budget_ledger"];
            for (const table of tableNames) {
                try {
                    const res = await this.pool.query(`SELECT * FROM ${table} ORDER BY created_at ASC;`);
                    tables[table] = res.rows;
                } catch {
                    tables[table] = [];
                }
            }
        }

        const payload: DecryptedBackupPayload = {
            version: "1.0.0",
            exportedAt: new Date().toISOString(),
            tables,
        };

        const plaintext = JSON.stringify(payload);
        const checksum = createHash("sha256").update(plaintext).digest("hex");

        // Derive 32-byte key using scrypt
        const salt = randomBytes(16);
        const key = scryptSync(passphrase, salt, 32);

        // AES-256-GCM encryption with 12-byte IV
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, iv);

        const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
        const authTag = cipher.getAuthTag();

        const recordCounts: Record<string, number> = {};
        let totalRecords = 0;
        for (const [tbl, rows] of Object.entries(tables)) {
            recordCounts[tbl] = rows.length;
            totalRecords += rows.length;
        }

        return {
            version: "1.0.0",
            algorithm: "aes-256-gcm",
            salt: salt.toString("hex"),
            iv: iv.toString("hex"),
            authTag: authTag.toString("hex"),
            ciphertext: encrypted.toString("base64"),
            checksum,
            createdAt: payload.exportedAt,
            metadata: {
                recordCounts,
                totalRecords,
            },
        };
    }

    /**
     * Decrypts, verifies authentication tag, and validates checksum of encrypted backup envelope.
     */
    public restoreEncryptedBackup(
        envelope: EncryptedBackupEnvelope,
        passphrase: string
    ): DecryptedBackupPayload {
        if (!passphrase) {
            throw new Error("Passphrase is required to restore backup.");
        }

        if (envelope.algorithm !== "aes-256-gcm") {
            throw new Error(`Unsupported encryption algorithm: ${envelope.algorithm}`);
        }

        const salt = Buffer.from(envelope.salt, "hex");
        const iv = Buffer.from(envelope.iv, "hex");
        const authTag = Buffer.from(envelope.authTag, "hex");
        const ciphertext = Buffer.from(envelope.ciphertext, "base64");

        const key = scryptSync(passphrase, salt, 32);

        try {
            const decipher = createDecipheriv("aes-256-gcm", key, iv);
            decipher.setAuthTag(authTag);

            const decryptedBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
            const plaintext = decryptedBuffer.toString("utf8");

            // Verify integrity checksum
            const calculatedChecksum = createHash("sha256").update(plaintext).digest("hex");
            if (calculatedChecksum !== envelope.checksum) {
                throw new Error("Integrity check failed: Checksum does not match unencrypted payload.");
            }

            return JSON.parse(plaintext) as DecryptedBackupPayload;
        } catch (err: any) {
            if (err?.message?.includes("Integrity check")) {
                throw err;
            }
            throw new Error("Decryption failed: Invalid passphrase or tampered backup ciphertext.");
        }
    }
}

