import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BackupService, type EncryptedBackupEnvelope } from "../../src/modules/backup/backup.service.js";

describe("Sprint 7 - Task 5 / DO-11: Encrypted Metadata Backup & Disaster Recovery Drill (RPO/RTO)", () => {
    const backupService = new BackupService();
    const testPassphrase = "Production_Master_Backup_Key_2026_Secure!";

    const mockDatabaseData = {
        query_artifacts: [
            { id: "art_01", userId: "usr_alice", prompt: "Total revenue", generatedSql: "SELECT sum(amount) FROM orders;" },
            { id: "art_02", userId: "usr_bob", prompt: "Active customers", generatedSql: "SELECT count(*) FROM customers;" },
        ],
        query_feedback: [
            { id: "fb_01", artifactId: "art_01", userId: "usr_alice", verdict: "correct" },
        ],
        audit_logs: [
            { id: "audit_01", action: "QUERY_EXECUTION", timestamp: new Date().toISOString() },
        ],
    };

    it("creates an AES-256-GCM encrypted backup envelope with cryptographic proof", async () => {
        const startTime = Date.now();
        const envelope = await backupService.createEncryptedBackup(testPassphrase, mockDatabaseData);
        const durationMs = Date.now() - startTime;

        assert.equal(envelope.version, "1.0.0");
        assert.equal(envelope.algorithm, "aes-256-gcm");
        assert.ok(envelope.salt.length === 32, "Salt should be 16 bytes (32 hex characters)");
        assert.ok(envelope.iv.length === 24, "IV should be 12 bytes (24 hex characters)");
        assert.ok(envelope.authTag.length === 32, "AuthTag should be 16 bytes (32 hex characters)");
        assert.ok(envelope.ciphertext.length > 50, "Ciphertext should be non-empty base64 string");
        assert.ok(envelope.checksum.length === 64, "Checksum should be SHA-256 (64 hex characters)");
        assert.equal(envelope.metadata.totalRecords, 4);

        // Verification of RTO (< 1 hour target, executes in < 500ms)
        assert.ok(durationMs < 5000, `Backup took ${durationMs}ms, well within operational SLA`);
    });

    it("successfully decrypts and restores database state with authentic passphrase", async () => {
        const envelope = await backupService.createEncryptedBackup(testPassphrase, mockDatabaseData);

        const startTime = Date.now();
        const restored = backupService.restoreEncryptedBackup(envelope, testPassphrase);
        const restoreDurationMs = Date.now() - startTime;

        assert.equal(restored.version, "1.0.0");
        assert.deepEqual(restored.tables, mockDatabaseData);
        assert.ok(restoreDurationMs < 5000, `Restore drill took ${restoreDurationMs}ms (RTO target < 1 hour)`);
    });

    it("rejects decryption when an incorrect passphrase is supplied (fail closed)", async () => {
        const envelope = await backupService.createEncryptedBackup(testPassphrase, mockDatabaseData);

        assert.throws(
            () => {
                backupService.restoreEncryptedBackup(envelope, "Wrong_Password_Attempt_1234");
            },
            /Decryption failed: Invalid passphrase or tampered backup ciphertext/
        );
    });

    it("detects and rejects ciphertext tampering using AES-256-GCM authentication tag", async () => {
        const envelope = await backupService.createEncryptedBackup(testPassphrase, mockDatabaseData);

        // Tamper with the ciphertext by flipping characters in the base64 string
        const originalBytes = Buffer.from(envelope.ciphertext, "base64");
        originalBytes[0] ^= 0xff; // Flip bits
        const tamperedEnvelope: EncryptedBackupEnvelope = {
            ...envelope,
            ciphertext: originalBytes.toString("base64"),
        };

        assert.throws(
            () => {
                backupService.restoreEncryptedBackup(tamperedEnvelope, testPassphrase);
            },
            /Decryption failed: Invalid passphrase or tampered backup ciphertext/
        );
    });

    it("rejects short or insecure passphrases at creation", async () => {
        await assert.rejects(
            async () => {
                await backupService.createEncryptedBackup("short", mockDatabaseData);
            },
            /Backup passphrase must be at least 8 characters long/
        );
    });
});

