import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import sensible from "@fastify/sensible";
import { config, type AppConfig } from "./config/env.js";
import {
    PostgresDatabaseChecker,
    type IDatabaseChecker,
} from "./modules/health/health.service.js";
import { healthRoutes } from "./modules/health/health.routes.js";

export interface BuildAppOptions extends FastifyServerOptions {
    appConfig?: AppConfig;
    dbChecker?: IDatabaseChecker;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
    const currentConfig = opts.appConfig || config;
    const dbChecker =
        opts.dbChecker ||
        new PostgresDatabaseChecker(
            currentConfig.ANALYTICS_DB_URL,
            currentConfig.APP_DB_URL
        );

    const app = Fastify({
        logger: {
            level: currentConfig.NODE_ENV === "test" ? "silent" : "info",
            redact: ["req.headers.authorization", "req.headers.cookie"],
        },
        ...opts,
    });

    // Cleanup resources on app shutdown
    app.addHook("onClose", async () => {
        if (dbChecker.close) {
            await dbChecker.close();
        }
    });

    // Core security & utility plugins
    await app.register(sensible);

    await app.register(cors, {
        origin: currentConfig.CORS_ORIGIN,
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    });

    await app.register(cookie, {
        secret: currentConfig.SESSION_SECRET,
        hook: "onRequest",
    });

    // Health and readiness routes
    await app.register(healthRoutes, { dbChecker });

    // Initial root probe
    app.get("/", async () => {
        return { name: "Text-to-SQL API", status: "running", version: "0.1.0" };
    });

    return app;
}
