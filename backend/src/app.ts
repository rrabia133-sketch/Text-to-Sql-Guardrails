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
import { schemaRoutes } from "./modules/schema/schema.routes.js";
import { SchemaService } from "./modules/schema/schema.service.js";
import { providerRoutes } from "./modules/providers/provider.routes.js";
import { ProviderRouter } from "./modules/providers/provider.router.js";
import { generationRoutes } from "./modules/generation/generation.routes.js";
import { QueryArtifactRepository } from "./modules/generation/query-artifact.repository.js";
import { ClarificationService } from "./modules/intent/clarification.service.js";
import { GenerationRetryHandler } from "./modules/generation/retry.handler.js";
import { executionRoutes } from "./modules/execution/execution.routes.js";
import { ExecutionRepository } from "./modules/execution/execution.repository.js";
import { ArtifactGate } from "./modules/execution/artifact-gate.js";
import { ConcurrencyManager } from "./modules/execution/concurrency-manager.js";
import { CancellationService } from "./modules/execution/cancellation.service.js";
import { RestrictedExecutor } from "./modules/execution/restricted-executor.js";
import { AuditLogger } from "./modules/execution/audit-logger.js";

export interface BuildAppOptions extends FastifyServerOptions {
    appConfig?: AppConfig;
    dbChecker?: IDatabaseChecker;
    authRepo?: AuthRepository;
    appPool?: Pool;
    analyticsPool?: Pool;
    schemaService?: SchemaService;
    providerRouter?: ProviderRouter;
    queryArtifactRepo?: QueryArtifactRepository;
    clarificationService?: ClarificationService;
    retryHandler?: GenerationRetryHandler;
    executionRepo?: ExecutionRepository;
    artifactGate?: ArtifactGate;
    concurrencyManager?: ConcurrencyManager;
    cancellationService?: CancellationService;
    restrictedExecutor?: RestrictedExecutor;
    auditLogger?: AuditLogger;
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

    const analyticsPool =
        opts.analyticsPool ||
        new Pool({
            connectionString: currentConfig.ANALYTICS_DB_URL,
            max: 10,
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
            await appPool.end().catch(() => {});
        }
        if (!opts.analyticsPool) {
            await analyticsPool.end().catch(() => {});
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

    // Sprint 3 Grounded Generation, Provider, and Schema routes
    const schemaService = opts.schemaService || new SchemaService();
    const providerRouter = opts.providerRouter || new ProviderRouter({ mode: currentConfig.PROVIDER_MODE });
    const queryArtifactRepo = opts.queryArtifactRepo || new QueryArtifactRepository(appPool);
    const clarificationService = opts.clarificationService || new ClarificationService();
    const retryHandler =
        opts.retryHandler ||
        new GenerationRetryHandler({
            totalDeadlineMs: Math.max(currentConfig.GENERATION_TIMEOUT_LOCAL_MS * 2, 90000),
        });

    await app.register(schemaRoutes, { schemaService, prefix: "/api/v1/schema" });
    await app.register(providerRoutes, { providerRouter, prefix: "/api/v1/providers" });
    await app.register(generationRoutes, {
        queryArtifactRepo,
        providerRouter,
        clarificationService,
        retryHandler,
        prefix: "/api/v1/queries",
    });
    // Sprint 4 Restricted Database Execution routes
    const executionRepo = opts.executionRepo || new ExecutionRepository(appPool);
    const artifactGate = opts.artifactGate || new ArtifactGate(queryArtifactRepo);
    const concurrencyManager = opts.concurrencyManager || new ConcurrencyManager();
    const cancellationService = opts.cancellationService || new CancellationService(analyticsPool);
    const restrictedExecutor = opts.restrictedExecutor || new RestrictedExecutor(analyticsPool);
    const auditLogger = opts.auditLogger || new AuditLogger(appPool);

    await app.register(executionRoutes, {
        executionRepo,
        artifactGate,
        concurrencyManager,
        cancellationService,
        restrictedExecutor,
        auditLogger,
        queryArtifactRepo,
        prefix: "/api/v1",
    });

    // Initial root & API health probe
    const rootProbe = async () => {
        return { name: "Text-to-SQL API", status: "running", version: "0.1.0" };
    };
    app.get("/", rootProbe);
    app.get("/api", rootProbe);
    app.get("/api/", rootProbe);
    app.get("/api/v1", rootProbe);
    app.get("/api/v1/", rootProbe);

    return app;
}
