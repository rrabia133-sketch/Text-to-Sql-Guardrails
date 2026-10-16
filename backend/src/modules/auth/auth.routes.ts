import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { LoginRequest, LoginResponse } from "@text2sql/contracts";
import type { AuthRepository } from "./auth.repository.js";
import { requireAuth } from "../../plugins/auth.js";

export interface AuthRoutesOptions {
    authRepo: AuthRepository;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
    fastify,
    opts
) => {
    const { authRepo } = opts;

    // -------------------------------------------------------------
    // POST /login: Sign in as user & create session
    // -------------------------------------------------------------
    fastify.post<{ Body: LoginRequest }>("/login", async (request, reply) => {
        const { username } = request.body || {};

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

        // Create a 24-hour session
        const sessionId = randomUUID();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await authRepo.createSession({
            id: sessionId,
            userId: user.id,
            expiresAt,
        });

        // Set signed, httpOnly session cookie
        reply.setCookie("session_id", sessionId, {
            path: "/",
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
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
    // GET /users: List available seed accounts (for switcher/demo)
    // -------------------------------------------------------------
    fastify.get("/users", async (_request, reply) => {
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
