import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import type { AuthRepository, UserRecord } from "../modules/auth/auth.repository.js";

// 1. Augment FastifyRequest so request.user is type-safe everywhere
declare module "fastify" {
    interface FastifyRequest {
        user: UserRecord | null;
        sessionId: string | null;
    }
}

export interface AuthPluginOptions {
    authRepo: AuthRepository;
}

// 2. PreHandler guard to protect authenticated endpoints
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
        return reply.status(401).send({
            statusCode: 401,
            error: "Unauthorized",
            message: "Authentication required to access this resource",
            timestamp: new Date().toISOString(),
        });
    }
}

// 3. Fastify plugin that resolves the signed session cookie on incoming requests
const authPluginCallback: FastifyPluginAsync<AuthPluginOptions> = async (
    fastify,
    opts
) => {
    const { authRepo } = opts;

    fastify.decorateRequest("user", null);
    fastify.decorateRequest("sessionId", null);

    fastify.addHook("preHandler", async (request: FastifyRequest) => {
        // Read the signed cookie "session_id"
        const rawCookie = request.cookies.session_id;
        if (!rawCookie) {
            request.user = null;
            request.sessionId = null;
            return;
        }

        // Unsign the cookie using @fastify/cookie secret
        const unsigned = request.unsignCookie(rawCookie);
        if (!unsigned.valid || !unsigned.value) {
            request.user = null;
            request.sessionId = null;
            return;
        }

        // Validate session against app_db
        const sessionWithUser = await authRepo.findSessionById(unsigned.value);
        if (sessionWithUser) {
            request.user = sessionWithUser.user;
            request.sessionId = sessionWithUser.session.id;
        } else {
            request.user = null;
            request.sessionId = null;
        }
    });
};

export const authPlugin = fp(authPluginCallback, {
    name: "auth-plugin",
    dependencies: ["@fastify/cookie"],
});
