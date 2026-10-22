import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../../plugins/auth.js";
import { ProviderRouter } from "./provider.router.js";

export interface ProviderRoutesOptions {
    providerRouter?: ProviderRouter;
    prefix?: string;
}

export const providerRoutes: FastifyPluginAsync<ProviderRoutesOptions> = async (
    fastify,
    opts
) => {
    const providerRouter = opts.providerRouter || new ProviderRouter();

    fastify.get(
        "/",
        {
            preHandler: [requireAuth],
        },
        async (request, reply) => {
            const summary = await providerRouter.getAvailableProviders();
            return reply.status(200).send(summary);
        }
    );
};
