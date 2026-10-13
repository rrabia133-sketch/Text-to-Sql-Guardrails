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

export function loadConfig(): AppConfig {
    return {
        PORT: Number.parseInt(process.env.PORT || "3001", 10),
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
    };
}

export const config = loadConfig();
