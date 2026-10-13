import dotenv from "dotenv";
import path from "node:path";

// Load .env from project root or backend folder
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config();

export interface AppConfig {
    PORT: number;
    HOST: string;
    NODE_ENV: "development" | "production" | "test";
    CORS_ORIGIN: string;
    SESSION_SECRET: string;
    ANALYTICS_DB_URL: string;
    APP_DB_URL: string;
}

export function validateConfig(raw: Partial<AppConfig>): AppConfig {
    const errors: string[] = [];

    const port =
        typeof raw.PORT === "number"
            ? raw.PORT
            : Number.parseInt(String(raw.PORT || "3001"), 10);
    if (Number.isNaN(port) || port <= 0 || port > 65535) {
        errors.push(`Invalid PORT: must be a number between 1 and 65535, got "${raw.PORT}"`);
    }

    const host = raw.HOST || "127.0.0.1";

    const nodeEnv = (raw.NODE_ENV || "development") as AppConfig["NODE_ENV"];
    if (!["development", "production", "test"].includes(nodeEnv)) {
        errors.push(
            `Invalid NODE_ENV: must be "development", "production", or "test", got "${raw.NODE_ENV}"`
        );
    }

    const corsOrigin = raw.CORS_ORIGIN || "http://localhost:5173";

    const sessionSecret =
        raw.SESSION_SECRET || "dev-session-secret-change-in-production-min-32-chars";
    if (!sessionSecret || sessionSecret.length < 32) {
        errors.push("Invalid SESSION_SECRET: must be at least 32 characters long");
    }

    const analyticsDbUrl =
        raw.ANALYTICS_DB_URL ||
        "postgresql://analytics_user:analytics_password@127.0.0.1:5434/analytics_db";
    if (!analyticsDbUrl.startsWith("postgresql://") && !analyticsDbUrl.startsWith("postgres://")) {
        errors.push("Invalid ANALYTICS_DB_URL: must start with postgresql:// or postgres://");
    }

    const appDbUrl =
        raw.APP_DB_URL ||
        "postgresql://app_user:app_password@127.0.0.1:5434/app_db";
    if (!appDbUrl.startsWith("postgresql://") && !appDbUrl.startsWith("postgres://")) {
        errors.push("Invalid APP_DB_URL: must start with postgresql:// or postgres://");
    }

    if (errors.length > 0) {
        throw new Error(
            `[Configuration Error] Invalid environment configuration:\n - ${errors.join("\n - ")}`
        );
    }

    return {
        PORT: port,
        HOST: host,
        NODE_ENV: nodeEnv,
        CORS_ORIGIN: corsOrigin,
        SESSION_SECRET: sessionSecret,
        ANALYTICS_DB_URL: analyticsDbUrl,
        APP_DB_URL: appDbUrl,
    };
}

export function loadConfig(): AppConfig {
    return validateConfig({
        PORT: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3001,
        HOST: process.env.HOST || "127.0.0.1",
        NODE_ENV: (process.env.NODE_ENV as AppConfig["NODE_ENV"]) || "development",
        CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:5173",
        SESSION_SECRET:
            process.env.SESSION_SECRET || "dev-session-secret-change-in-production-min-32-chars",
        ANALYTICS_DB_URL:
            process.env.ANALYTICS_DB_URL ||
            "postgresql://analytics_user:analytics_password@127.0.0.1:5434/analytics_db",
        APP_DB_URL:
            process.env.APP_DB_URL ||
            "postgresql://app_user:app_password@127.0.0.1:5434/app_db",
    });
}

export const config = loadConfig();

