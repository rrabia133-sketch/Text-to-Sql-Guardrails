import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { LoginRequest, LoginResponse } from "@text2sql/contracts";
import type { AuthRepository } from "./auth.repository.js";
import { requireAuth } from "../../plugins/auth.js";
import { verifyPassword } from "./password.util.js";

export interface AuthRoutesOptions {
    authRepo: AuthRepository;
    nodeEnv?: "development" | "production" | "test";
    rateLimitMax?: number;
    rateLimitWindowMs?: number;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
    fastify,
    opts
) => {
    const {
        authRepo,
        nodeEnv = (process.env.NODE_ENV as "development" | "production" | "test") || "development",
        rateLimitMax = 20,
        rateLimitWindowMs = 60_000,
    } = opts;
    const isProduction = nodeEnv === "production";

    // Sliding-window brute-force rate limiter per client IP
    const loginAttemptsByIp = new Map<string, number[]>();

    function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
        const now = Date.now();
        const windowStart = now - rateLimitWindowMs;
        const recent = (loginAttemptsByIp.get(ip) || []).filter((ts) => ts > windowStart);

        if (recent.length >= rateLimitMax) {
            const oldestInWindow = recent[0] ?? now;
            const retryAfterSec = Math.max(1, Math.ceil((oldestInWindow + rateLimitWindowMs - now) / 1000));
            loginAttemptsByIp.set(ip, recent);
            return { allowed: false, retryAfterSec };
        }

        recent.push(now);
        loginAttemptsByIp.set(ip, recent);
        return { allowed: true, retryAfterSec: 0 };
    }

    // -------------------------------------------------------------
    // POST /login: Sign in as user & create session
    // -------------------------------------------------------------
    fastify.post<{ Body: LoginRequest }>("/login", async (request, reply) => {
        const clientIp = request.ip || "127.0.0.1";
        const rateCheck = checkLoginRateLimit(clientIp);
        if (!rateCheck.allowed) {
            return reply
                .header("Retry-After", String(rateCheck.retryAfterSec))
                .status(429)
                .send({
                    statusCode: 429,
                    error: "Too Many Requests",
                    message: "Too many login attempts. Please try again later.",
                });
        }

        const { username, password } = request.body || {};

        if (!username) {
            return reply.status(400).send({
                statusCode: 400,
                error: "Bad Request",
                message: "Username is required",
            });
        }

        // Lookup by username or email
        let user = await authRepo.findUserByUsername(username);
        if (!user) {
            user = await authRepo.findUserByEmail(username);
        }

        if (!user) {
            return reply.status(401).send({
                statusCode: 401,
                error: "Unauthorized",
                message: "Invalid credentials",
            });
        }

        // Enforce password verification in production or whenever user has a passwordHash
        if (isProduction || user.passwordHash) {
            if (!password || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
                return reply.status(401).send({
                    statusCode: 401,
                    error: "Unauthorized",
                    message: "Invalid credentials",
                });
            }
        }

        // Create a 24-hour session
        const sessionId = randomUUID();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await authRepo.createSession({
            id: sessionId,
            userId: user.id,
            expiresAt,
        });

        // Set signed, httpOnly session cookie (Strict + Secure in production)
        reply.setCookie("session_id", sessionId, {
            path: "/",
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? "strict" : "lax",
            signed: true,
            expires: expiresAt,
        });

        const response: LoginResponse = {
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                displayName: user.displayName,
            },
            sessionId,
            expiresAt: expiresAt.toISOString(),
        };

        return reply.status(200).send(response);
    });

    // -------------------------------------------------------------
    // POST /logout: Revoke session & clear cookie
    // -------------------------------------------------------------
    fastify.post("/logout", async (request, reply) => {
        if (request.sessionId) {
            await authRepo.deleteSession(request.sessionId);
        } else {
            // Also attempt to read cookie directly if unsigned
            const rawCookie = request.cookies.session_id;
            if (rawCookie) {
                const unsigned = request.unsignCookie(rawCookie);
                if (unsigned.valid && unsigned.value) {
                    await authRepo.deleteSession(unsigned.value);
                }
            }
        }

        reply.clearCookie("session_id", { path: "/" });

        return reply.status(200).send({
            success: true,
            message: "Logged out successfully",
        });
    });

    // -------------------------------------------------------------
    // GET /me: Current session identity (protected)
    // -------------------------------------------------------------
    fastify.get(
        "/me",
        { preHandler: [requireAuth] },
        async (request, reply) => {
            const user = request.user!;
            return reply.status(200).send({
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    displayName: user.displayName,
                },
                sessionId: request.sessionId,
            });
        }
    );

    // -------------------------------------------------------------
    // GET /users: List available accounts
    // Restricted to authenticated admins in production to prevent user enumeration
    // -------------------------------------------------------------
    fastify.get("/users", async (request, reply) => {
        if (isProduction) {
            if (!request.user) {
                return reply.status(401).send({
                    statusCode: 401,
                    error: "Unauthorized",
                    message: "Authentication required to list users in production",
                });
            }
            if (request.user.role !== "admin") {
                return reply.status(403).send({
                    statusCode: 403,
                    error: "Forbidden",
                    message: "Admin privileges required to list users in production",
                });
            }
        }

        const users = await authRepo.listUsers();
        return reply.status(200).send(
            users.map((u) => ({
                id: u.id,
                username: u.username,
                role: u.role,
                displayName: u.displayName,
            }))
        );
    });
};
