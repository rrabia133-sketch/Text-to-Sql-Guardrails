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
import { hashPassword } from "./modules/auth/password.util.js";
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
import { SemanticRepository } from "./modules/semantic/semantic.repository.js";
import { retentionRoutes } from "./modules/retention/retention.routes.js";
import { RetentionService } from "./modules/retention/retention.service.js";
import { historyRoutes } from "./modules/history/history.routes.js";
import { HistoryRepository } from "./modules/history/history.repository.js";
import { exportRoutes } from "./modules/export/export.routes.js";
import { CsvExporterService } from "./modules/export/csv-exporter.service.js";
import { ResultCacheService } from "./modules/execution/result-cache.service.js";
import { tracingAndRedactionPlugin, PINO_REDACT_PATHS } from "./plugins/redaction.js";
import { MetricsService } from "./modules/metrics/metrics.service.js";
import { metricsRoutes } from "./modules/metrics/metrics.routes.js";

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
    semanticRepo?: SemanticRepository;
    resultCacheService?: ResultCacheService;
    csvExporterService?: CsvExporterService;
    historyRepo?: HistoryRepository;
    retentionService?: RetentionService;
    metricsService?: MetricsService;
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
            max: currentConfig.APP_DB_POOL_MAX ?? 5,
            connectionTimeoutMillis: 2000,
        });

    const analyticsPool =
        opts.analyticsPool ||
        new Pool({
            connectionString: currentConfig.ANALYTICS_DB_URL,
            max: currentConfig.ANALYTICS_DB_POOL_MAX ?? 10,
            connectionTimeoutMillis: 2000,
        });

    const authRepo = opts.authRepo || new AuthRepository(appPool);

    if (currentConfig.BOOTSTRAP_ADMIN_PASSWORD && currentConfig.BOOTSTRAP_ADMIN_PASSWORD.length >= 8) {
        await authRepo.updateUserPasswordHash(
            "usr_admin_01",
            hashPassword(currentConfig.BOOTSTRAP_ADMIN_PASSWORD)
        );
    }

    const app = Fastify({
        trustProxy: currentConfig.TRUST_PROXY ?? currentConfig.NODE_ENV === "production",
        logger: {
            level: currentConfig.NODE_ENV === "test" ? "silent" : "info",
            redact: PINO_REDACT_PATHS,
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
    await app.register(tracingAndRedactionPlugin, { nodeEnv: currentConfig.NODE_ENV });
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
    await app.register(healthRoutes, { dbChecker, prefix: "/api" });

    // Auth endpoints (/api/auth/config, /api/auth/register, /api/auth/login, /api/auth/logout, /api/auth/me, /api/auth/users)
    await app.register(authRoutes, {
        authRepo,
        nodeEnv: currentConfig.NODE_ENV,
        rateLimitMax: currentConfig.AUTH_RATE_LIMIT_MAX,
        rateLimitWindowMs: currentConfig.AUTH_RATE_LIMIT_WINDOW_MS,
        cookieSecure: currentConfig.COOKIE_SECURE,
        allowRegistration: currentConfig.ALLOW_SELF_REGISTRATION,
        prefix: "/api/auth",
    });

    // Sprint 3 Grounded Generation, Provider, and Schema routes
    const isProduction = currentConfig.NODE_ENV === "production";
    const schemaService =
        opts.schemaService ||
        new SchemaService(opts.analyticsPool || (isProduction ? analyticsPool : undefined), 5 * 60 * 1000, {
            failClosed: isProduction,
        });
    const providerRouter = opts.providerRouter || new ProviderRouter({ mode: currentConfig.PROVIDER_MODE });
    const queryArtifactRepo = opts.queryArtifactRepo || new QueryArtifactRepository(appPool);
    const semanticRepo = opts.semanticRepo || new SemanticRepository(appPool);
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
        semanticRepo,
        prefix: "/api/v1/queries",
    });
    // Sprint 4 Restricted Database Execution routes
    const executionRepo = opts.executionRepo || new ExecutionRepository(appPool);
    const artifactGate = opts.artifactGate || new ArtifactGate(queryArtifactRepo);
    const concurrencyManager = opts.concurrencyManager || new ConcurrencyManager();
    const cancellationService = opts.cancellationService || new CancellationService(analyticsPool);
    const restrictedExecutor = opts.restrictedExecutor || new RestrictedExecutor(analyticsPool);
    const auditLogger = opts.auditLogger || new AuditLogger(appPool);
    const resultCacheService = opts.resultCacheService || new ResultCacheService();

    await app.register(executionRoutes, {
        executionRepo,
        artifactGate,
        concurrencyManager,
        cancellationService,
        restrictedExecutor,
        auditLogger,
        queryArtifactRepo,
        semanticRepo,
        resultCacheService,
        prefix: "/api/v1",
    });


    const csvExporterService = opts.csvExporterService || new CsvExporterService();

    await app.register(exportRoutes, {
        resultCacheService,
        csvExporterService,
        executionRepo,
        auditLogger,
        prefix: "/api/v1",
    });


    const historyRepo = opts.historyRepo || new HistoryRepository(appPool);

    await app.register(historyRoutes, {
        historyRepo,
        queryArtifactRepo,
        auditLogger,
        prefix: "/api/v1",
    });


    const retentionService =
        opts.retentionService ||
        new RetentionService({
            pool: appPool,
            resultCacheService,
            auditLogger,
        });

    await app.register(retentionRoutes, {
        retentionService,
        auditLogger,
        prefix: "/api/v1",
    });

    // Observability Prometheus Metrics (Sprint 7 / DO-10)
    const metricsService = opts.metricsService || new MetricsService(appPool, analyticsPool);
    await app.register(metricsRoutes, {
        metricsService,
        metricsBearerToken: currentConfig.METRICS_BEARER_TOKEN,
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
