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
    PROVIDER_MODE: "local" | "hybrid" | "cloud";
    OLLAMA_HOST: string;
    OLLAMA_MODEL: string;
    GROQ_API_KEY: string;
    GROQ_MODEL: string;
    DAILY_CLOUD_BUDGET_USD: number;
    GENERATION_TIMEOUT_LOCAL_MS: number;
    GENERATION_TIMEOUT_CLOUD_MS: number;
    ANALYTICS_TIMEZONE: string;
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

    const providerMode = (raw.PROVIDER_MODE || "local") as AppConfig["PROVIDER_MODE"];
    if (!["local", "hybrid", "cloud"].includes(providerMode)) {
        errors.push(
            `Invalid PROVIDER_MODE: must be "local", "hybrid", or "cloud", got "${raw.PROVIDER_MODE}"`
        );
    }

    const ollamaHost = raw.OLLAMA_HOST || "http://127.0.0.1:11434";
    const ollamaModel = raw.OLLAMA_MODEL || "qwen2.5-coder:7b";
    const groqApiKey = raw.GROQ_API_KEY || "";
    const groqModel = raw.GROQ_MODEL || "llama-3.3-70b-versatile";

    const dailyBudget =
        typeof raw.DAILY_CLOUD_BUDGET_USD === "number"
            ? raw.DAILY_CLOUD_BUDGET_USD
            : Number.parseFloat(String(raw.DAILY_CLOUD_BUDGET_USD ?? "5.00"));
    if (Number.isNaN(dailyBudget) || dailyBudget < 0) {
        errors.push(`Invalid DAILY_CLOUD_BUDGET_USD: must be a positive number, got "${raw.DAILY_CLOUD_BUDGET_USD}"`);
    }

    const timeoutLocal =
        typeof raw.GENERATION_TIMEOUT_LOCAL_MS === "number"
            ? raw.GENERATION_TIMEOUT_LOCAL_MS
            : Number.parseInt(String(raw.GENERATION_TIMEOUT_LOCAL_MS ?? "30000"), 10);
    if (Number.isNaN(timeoutLocal) || timeoutLocal <= 0) {
        errors.push(`Invalid GENERATION_TIMEOUT_LOCAL_MS: must be a positive integer, got "${raw.GENERATION_TIMEOUT_LOCAL_MS}"`);
    }

    const timeoutCloud =
        typeof raw.GENERATION_TIMEOUT_CLOUD_MS === "number"
            ? raw.GENERATION_TIMEOUT_CLOUD_MS
            : Number.parseInt(String(raw.GENERATION_TIMEOUT_CLOUD_MS ?? "15000"), 10);
    if (Number.isNaN(timeoutCloud) || timeoutCloud <= 0) {
        errors.push(`Invalid GENERATION_TIMEOUT_CLOUD_MS: must be a positive integer, got "${raw.GENERATION_TIMEOUT_CLOUD_MS}"`);
    }

    const analyticsTimezone = raw.ANALYTICS_TIMEZONE || "UTC";

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
        PROVIDER_MODE: providerMode,
        OLLAMA_HOST: ollamaHost,
        OLLAMA_MODEL: ollamaModel,
        GROQ_API_KEY: groqApiKey,
        GROQ_MODEL: groqModel,
        DAILY_CLOUD_BUDGET_USD: dailyBudget,
        GENERATION_TIMEOUT_LOCAL_MS: timeoutLocal,
        GENERATION_TIMEOUT_CLOUD_MS: timeoutCloud,
        ANALYTICS_TIMEZONE: analyticsTimezone,
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
        PROVIDER_MODE: (process.env.PROVIDER_MODE as AppConfig["PROVIDER_MODE"]) || "local",
        OLLAMA_HOST: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
        OLLAMA_MODEL: process.env.OLLAMA_MODEL || "qwen2.5-coder:7b",
        GROQ_API_KEY: process.env.GROQ_API_KEY || "",
        GROQ_MODEL: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        DAILY_CLOUD_BUDGET_USD: process.env.DAILY_CLOUD_BUDGET_USD
            ? Number.parseFloat(process.env.DAILY_CLOUD_BUDGET_USD)
            : 5.0,
        GENERATION_TIMEOUT_LOCAL_MS: process.env.GENERATION_TIMEOUT_LOCAL_MS
            ? Number.parseInt(process.env.GENERATION_TIMEOUT_LOCAL_MS, 10)
            : 30000,
        GENERATION_TIMEOUT_CLOUD_MS: process.env.GENERATION_TIMEOUT_CLOUD_MS
            ? Number.parseInt(process.env.GENERATION_TIMEOUT_CLOUD_MS, 10)
            : 15000,
        ANALYTICS_TIMEZONE: process.env.ANALYTICS_TIMEZONE || "UTC",
    });
}

export const config = loadConfig();


