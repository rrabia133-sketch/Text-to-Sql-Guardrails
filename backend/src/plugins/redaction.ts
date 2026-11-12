import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { randomUUID } from "node:crypto";

/**
 * Standard list of sensitive field patterns to redact from logs and serialization
 */
export const SENSITIVE_KEY_PATTERNS = [
    /password/i,
    /secret/i,
    /token/i,
    /api[-_]?key/i,
    /authorization/i,
    /cookie/i,
    /session/i,
    /credit[-_]?card/i,
    /ssn/i,
];

export const PINO_REDACT_PATHS = [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.headers['set-cookie']",
    "res.headers['set-cookie']",
    "*.password",
    "*.secret",
    "*.apiKey",
    "*.token",
    "*.sessionSecret",
    "*.cookie",
    "rows",
    "*.rows",
    "rows[*]",
    "payload.rows",
    "payload.rows[*]",
    "result.rows",
    "result.rows[*]",
];

/**
 * Recursively redacts sensitive keys and database rows from objects before logging
 */
export function redactSensitiveData<T>(obj: T, depth = 0): T {
    if (depth > 6 || obj === null || obj === undefined) return obj;

    if (Array.isArray(obj)) {
        // Redact individual array elements
        return obj.map((item) => redactSensitiveData(item, depth + 1)) as unknown as T;
    }

    if (typeof obj === "object") {
        const copy: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            // 1. Redact database row arrays directly
            if (key.toLowerCase() === "rows" && Array.isArray(value)) {
                copy[key] = `[REDACTED_ROWS count=${value.length}]`;
                continue;
            }

            // 2. Redact sensitive field names matching security patterns
            if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
                copy[key] = "[REDACTED]";
                continue;
            }

            // 3. Redact string values containing authorization bearer tokens or SQL injection secrets
            if (typeof value === "string") {
                if (/^Bearer\s+[a-zA-Z0-9._-]+/i.test(value)) {
                    copy[key] = "Bearer [REDACTED]";
                    continue;
                }
                if (/connect-session=[a-zA-Z0-9._-]+/i.test(value)) {
                    copy[key] = "[REDACTED_COOKIE]";
                    continue;
                }
            }

            copy[key] = redactSensitiveData(value, depth + 1);
        }
        return copy as T;
    }

    return obj;
}

const tracingAndRedactionPluginAsync: FastifyPluginAsync = async (app) => {
    // 1. Correlate Request ID across entire lifecycle
    app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
        const incomingId = request.headers["x-request-id"];
        const requestId = typeof incomingId === "string" && incomingId.trim().length > 0
            ? incomingId.trim()
            : `req_${randomUUID()}`;

        (request as any).id = requestId;
        reply.header("x-request-id", requestId);
    });

    // 2. Ensure security headers are always applied to all replies
    app.addHook("onSend", async (request: FastifyRequest, reply: FastifyReply) => {
        reply.header("x-request-id", request.id);
        reply.header("x-content-type-options", "nosniff");
        reply.header("x-frame-options", "DENY");
    });
};

export const tracingAndRedactionPlugin = fp(tracingAndRedactionPluginAsync, {
    name: "tracing-and-redaction-plugin",
});

