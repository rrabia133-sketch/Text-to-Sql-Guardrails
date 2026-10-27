import { createHash } from "node:crypto";
import type { ExecutionErrorCode } from "@text2sql/contracts";
import type { QueryArtifactRepository, QueryArtifactRecord } from "../generation/query-artifact.repository.js";

export interface ArtifactGateResult {
    ok: boolean;
    errorCode?: ExecutionErrorCode;
    errorMessage?: string;
    artifact?: QueryArtifactRecord;
    sqlHash?: string;
}

export interface VerifyArtifactOptions {
    clientProvidedSql?: string;
    clientProvidedHash?: string;
}

export class ArtifactGate {
    constructor(private readonly artifactRepo: QueryArtifactRepository) { }

    /**
     * Computes the deterministic SHA-256 hash of a canonical SQL string.
     */
    public computeSqlHash(sql: string): string {
        return createHash("sha256").update(sql.trim()).digest("hex");
    }

    /**
     * Verifies that the requested artifact exists, belongs to the requesting user,
     * is in 'preview' status, has not expired, and matches its cryptographic hash.
     */
    public async verify(
        artifactId: string,
        requestingUserId: string,
        options?: VerifyArtifactOptions
    ): Promise<ArtifactGateResult> {
        // 1. Artifact existence check
        const artifact = await this.artifactRepo.findById(artifactId);
        if (!artifact) {
            return {
                ok: false,
                errorCode: "ARTIFACT_NOT_FOUND",
                errorMessage: `Query artifact '${artifactId}' was not found.`,
            };
        }

        // 2. Strict tenant / user ownership containment
        if (artifact.userId !== requestingUserId) {
            return {
                ok: false,
                errorCode: "ARTIFACT_NOT_OWNED",
                errorMessage: `Access denied. Query artifact '${artifactId}' belongs to another user.`,
            };
        }

        // 3. Artifact lifecycle status validation (only 'preview' is executable)
        if (artifact.status !== "preview") {
            return {
                ok: false,
                errorCode: "TRANSACTION_VIOLATION",
                errorMessage: `Artifact '${artifactId}' is in '${artifact.status}' state and cannot be executed (only 'preview' artifacts may be executed).`,
            };
        }

        // 4. Expiration check (15-minute preview TTL)
        const expiresAt = new Date(artifact.expiresAt).getTime();
        if (Date.now() > expiresAt) {
            return {
                ok: false,
                errorCode: "ARTIFACT_EXPIRED",
                errorMessage: `Query artifact '${artifactId}' expired at ${artifact.expiresAt}. Please generate a fresh preview.`,
            };
        }

        // 5. Cryptographic SQL hash verification
        const serverSqlHash = this.computeSqlHash(artifact.generatedSql);

        // Fail-closed against any client raw SQL substitution or tampering
        if (options?.clientProvidedSql !== undefined) {
            const clientSqlHash = this.computeSqlHash(options.clientProvidedSql);
            if (clientSqlHash !== serverSqlHash) {
                return {
                    ok: false,
                    errorCode: "HASH_MISMATCH",
                    errorMessage: "Client SQL does not match the server-stored preview artifact (SQL substitution rejected).",
                };
            }
        }

        if (options?.clientProvidedHash !== undefined && options.clientProvidedHash !== serverSqlHash) {
            return {
                ok: false,
                errorCode: "HASH_MISMATCH",
                errorMessage: "Client SQL hash verification failed against stored preview artifact.",
            };
        }

        return {
            ok: true,
            artifact,
            sqlHash: serverSqlHash,
        };
    }
}
