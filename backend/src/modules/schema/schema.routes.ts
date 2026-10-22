import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { SchemaService } from "./schema.service.js";
import { BUSINESS_GLOSSARY, GLOSSARY_VERSION } from "@text2sql/contracts";

export interface SchemaRoutesOptions {
    schemaService?: SchemaService;
    prefix?: string;
}

export const schemaRoutes: FastifyPluginAsync<SchemaRoutesOptions> = async (
    fastify,
    opts
) => {
    const schemaService = opts.schemaService || new SchemaService();

    fastify.get(
        "/",
        {
            preHandler: [requireAuth],
        },
        async (request, reply) => {
            const catalog = await schemaService.getSanitizedCatalog();
            return reply.status(200).send({
                catalog,
                glossary: BUSINESS_GLOSSARY,
                glossaryVersion: GLOSSARY_VERSION,
                timestamp: new Date().toISOString(),
            });
        }
    );
};
