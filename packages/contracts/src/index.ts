export const CONTRACTS_VERSION = "0.1.0";

// ==========================================
// 1. Service Health & Readiness Contracts
// ==========================================

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "ok";

export interface HealthResponse {
    status: HealthStatus;
    version?: string;
    uptimeSeconds?: number;
    uptime?: number;
    timestamp: string;
}

export type DatabaseCheckStatus = "connected" | "disconnected" | "read_only";

export interface ReadinessResponse {
    status: "ready" | "not_ready";
    timestamp: string;
    checks: {
        analyticsDb: {
            status: DatabaseCheckStatus;
            isReadOnly: boolean;
            latencyMs?: number;
        };
        appDb: {
            status: DatabaseCheckStatus;
            latencyMs?: number;
        };
    };
}

// ==========================================
// 2. Identity, Role & Session Contracts (US-03)
// ==========================================

export type UserRole = "analyst" | "admin";

export interface UserSummary {
    id: string;
    username: string;
    role: UserRole;
    displayName: string;
}

export interface SessionInfo {
    sessionId: string;
    user: UserSummary;
    expiresAt: string;
}

export interface LoginRequest {
    username: string;
    password?: string;
}

export interface LoginResponse {
    user: UserSummary;
    sessionId: string;
    expiresAt: string;
}

// ==========================================
// 3. Query Submission & Lifecycle Contracts
// ==========================================

export type QueryExecutionStatus =
    | "pending"
    | "validating"
    | "generating"
    | "executing"
    | "completed"
    | "failed"
    | "rejected";

export interface QuerySubmissionRequest {
    prompt: string;
    sessionId?: string;
}

export interface QuerySubmissionResponse {
    queryId: string;
    prompt: string;
    status: QueryExecutionStatus;
    createdAt: string;
    generatedSql?: string;
}

export interface QueryResultResponse {
    queryId: string;
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    executionTimeMs: number;
    truncated: boolean;
}

// ==========================================
// 4. Standard Error Response Contract
// ==========================================

export interface ApiErrorResponse {
    statusCode: number;
    error: string;
    message: string;
    timestamp: string;
    details?: unknown;
}

// ==========================================
// 5. Domain Specific Contracts
// ==========================================

export * from "./glossary.js";
export * from "./provider.js";
export * from "./generation.js";
export * from "./guardrails.js";
export * from "./execution.js";

