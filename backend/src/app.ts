import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import sensible from "@fastify/sensible";
import { Pool } from "pg";
import { config, type AppConfig } from "./config/env.js";
import {
    PostgresDatabaseChecker,
    type IDatabaseChecker,
} from "./modules/health/health.service.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { AuthRepository } from "./modules/auth/auth.repository.js";
import { authPlugin } from "./plugins/auth.js";
import { authRoutes } from "./modules/auth/auth.routes.js";

export interface BuildAppOptions extends FastifyServerOptions {
    appConfig?: AppConfig;
    dbChecker?: IDatabaseChecker;
    authRepo?: AuthRepository;
    appPool?: Pool;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
    const currentConfig = opts.appConfig || config;

    const dbChecker =
        opts.dbChecker ||
        new PostgresDatabaseChecker(
            currentConfig.ANALYTICS_DB_URL,
            currentConfig.APP_DB_URL
        );

    // Initialize application pool and auth repository
    const appPool =
        opts.appPool ||
        new Pool({
            connectionString: currentConfig.APP_DB_URL,
            max: 5,
        });

    const authRepo = opts.authRepo || new AuthRepository(appPool);

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
        if (!opts.appPool) {
            await appPool.end();
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

    // Register Auth session resolution plugin
    await app.register(authPlugin, { authRepo });

    // Health and readiness routes
    await app.register(healthRoutes, { dbChecker });

    // Auth endpoints (/api/auth/login, /api/auth/logout, /api/auth/me, /api/auth/users)
    await app.register(authRoutes, { authRepo, prefix: "/api/auth" });

    // Initial root & API health probe
    const rootProbe = async () => {
        return { name: "Text-to-SQL API", status: "running", version: "0.1.0" };
    };
    app.get("/", rootProbe);
    app.get("/api", rootProbe);
    app.get("/api/", rootProbe);

    return app;
}
