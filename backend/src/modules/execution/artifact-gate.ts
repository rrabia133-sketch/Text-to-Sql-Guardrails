import { createHash } from "node:crypto";
import type { ExecutionErrorCode, ReviewAcknowledgement } from "@text2sql/contracts";
import type { QueryArtifactRepository, QueryArtifactRecord } from "../generation/query-artifact.repository.js";
import { ArtifactStateService } from "./artifact-state.service.js";


export const DEFAULT_ACTIVE_SCHEMA_VERSIONS = ["v1", "v1.0", "1.0.0"];
export const DEFAULT_ACTIVE_POLICY_VERSION = "1.0.0";

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
    acknowledgement?: ReviewAcknowledgement;
    activeSchemaVersion?: string;
    activePolicyVersion?: string;
}

export class ArtifactGate {
    private readonly stateService: ArtifactStateService;

    constructor(
        private readonly artifactRepo: QueryArtifactRepository,
        stateService?: ArtifactStateService
    ) {
        this.stateService = stateService || new ArtifactStateService();
    }

    /**
     * Computes the deterministic SHA-256 hash of a canonical SQL string.
     */
    public computeSqlHash(sql: string): string {
        return createHash("sha256").update(sql.trim()).digest("hex");
    }

    /**
     * Verifies that the requested artifact exists, belongs to the requesting user,
     * is in an executable status (preview, preview_ready, or preview_review with confirmed acknowledgement),
     * has not expired, and matches its cryptographic hash.
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

        // 3. Artifact lifecycle status & review acknowledgement gate
        const stateCheck = this.stateService.canExecute(artifact.status, options?.acknowledgement);
        if (!stateCheck.allowed) {
            return {
                ok: false,
                errorCode: stateCheck.errorCode || "TRANSACTION_VIOLATION",
                errorMessage: stateCheck.errorMessage || `Artifact '${artifactId}' is in '${artifact.status}' state and cannot be executed (only 'preview' artifacts may be executed).`,
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


        // 4b. Schema & Policy Version Freshness Check
        const activePolicyVersion = options?.activePolicyVersion || DEFAULT_ACTIVE_POLICY_VERSION;
        if (artifact.policyVersion && artifact.policyVersion !== activePolicyVersion) {
            return {
                ok: false,
                errorCode: "STALE_POLICY_VERSION",
                errorMessage: `Query artifact policy version '${artifact.policyVersion}' is stale (active policy version is '${activePolicyVersion}'). Please generate a fresh preview.`,
            };
        }

        const isSchemaFresh = options?.activeSchemaVersion
            ? artifact.schemaVersion === options.activeSchemaVersion
            : DEFAULT_ACTIVE_SCHEMA_VERSIONS.includes(artifact.schemaVersion) || artifact.schemaVersion.startsWith("v1");

        if (!isSchemaFresh) {
            return {
                ok: false,
                errorCode: "STALE_SCHEMA_VERSION",
                errorMessage: `Query artifact schema version '${artifact.schemaVersion}' is stale (active schema versions are 'v1' / '1.0.0'). Please generate a fresh preview.`,
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
