import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@text2sql/contracts";
import type { UserRecord } from "./auth.repository.js";

declare module "fastify" {
    interface FastifyRequest {
        user: UserRecord | null;
        loadedResource?: unknown;
    }
}

/**
 * Guard that restricts route access to users with specified role(s).
 * Supports both requireRole("admin") and requireRole(["admin", "analyst"]).
 */
export function requireRole(...allowedRoles: (UserRole | UserRole[])[]) {
    const roles = allowedRoles.flat();

    return async function roleGuard(request: FastifyRequest, reply: FastifyReply) {
        // 1. Check if user is logged in
        if (!request.user) {
            return reply.status(401).send({
                statusCode: 401,
                error: "Unauthorized",
                message: "Authentication required to access this resource",
                timestamp: new Date().toISOString(),
            });
        }

        // 2. Check if user's role is in the allowed list
        if (!roles.includes(request.user.role)) {
            return reply.status(403).send({
                statusCode: 403,
                error: "Forbidden",
                message: "Insufficient permissions to access this administrative resource",
                timestamp: new Date().toISOString(),
            });
        }
    };
}

export const requireAdmin = requireRole("admin");

export interface OwnershipGuardOptions<T> {
    /** The route parameter name containing the resource ID (default: "id") */
    paramName?: string;
    /** Human-readable name used in error messages (e.g., "Query artifact", "Resource") */
    resourceName?: string;
    /** Function to load the resource from the database */
    loader: (id: string, request: FastifyRequest) => Promise<T | null>;
    /** Function to extract owner's user ID from the resource */
    getOwnerId?: (resource: T) => string;
}

/**
 * Generic Fastify preHandler guard that prevents IDOR by ensuring
 * request.user.id matches the resource owner.
 * Returns 404 for unowned or missing resources to prevent enumeration.
 */
export function createOwnershipGuard<T>(options: OwnershipGuardOptions<T>) {
    const {
        paramName = "id",
        resourceName = "Resource",
        loader,
        getOwnerId = (resource: any) =>
            resource.userId ?? resource.user_id ?? resource.ownerId ?? resource.owner_id,
    } = options;

    return async function ownershipGuard(
        request: FastifyRequest,
        reply: FastifyReply
    ) {
        // 1. Require user to be authenticated first
        if (!request.user) {
            return reply.status(401).send({
                statusCode: 401,
                error: "Unauthorized",
                message: "Authentication required to access this resource",
                timestamp: new Date().toISOString(),
            });
        }

        // 2. Extract resource ID from route parameters
        const params = (request.params as Record<string, string>) || {};
        const resourceId = params[paramName];

        if (!resourceId) {
            return reply.status(400).send({
                statusCode: 400,
                error: "Bad Request",
                message: `Missing required route parameter '${paramName}'`,
                timestamp: new Date().toISOString(),
            });
        }

        // 3. Load resource from DB
        const resource = await loader(resourceId, request);

        // Helper 404 response (used for both missing AND unowned resources)
        const sendNotFound = () =>
            reply.status(404).send({
                statusCode: 404,
                error: "Not Found",
                message: `${resourceName} not found`,
                timestamp: new Date().toISOString(),
            });

        // 4. If resource doesn't exist -> 404
        if (!resource) {
            return sendNotFound();
        }

        // 5. Verify ownership: request.user.id === resource.owner_id
        const ownerId = getOwnerId(resource);
        if (ownerId !== request.user.id) {
            // Anti-enumeration: return 404 so caller cannot discover valid IDs
            return sendNotFound();
        }

        // 6. Attach loaded resource to request for downstream handler efficiency
        request.loadedResource = resource;
    };
}
