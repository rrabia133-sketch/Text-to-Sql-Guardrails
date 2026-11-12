import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "../../src/config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

function parseDotEnv(content: string): Record<string, string> {
    const vars: Record<string, string> = {};
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) {
            continue;
        }
        const eqIdx = line.indexOf("=");
        if (eqIdx === -1) {
            continue;
        }
        const key = line.slice(0, eqIdx).trim();
        const val = line.slice(eqIdx + 1).trim();
        vars[key] = val;
    }
    return vars;
}

describe("DO-02 Task 2: Environment Contract & Fail-Closed Config Validation", () => {
    it(".env.example defines all required configuration keys with placeholder values", () => {
        const envExamplePath = path.join(repoRoot, ".env.example");
        assert.ok(fs.existsSync(envExamplePath), ".env.example must exist at repository root");

        const raw = fs.readFileSync(envExamplePath, "utf8");
        const parsed = parseDotEnv(raw);

        const requiredKeys = [
            "PORT",
            "HOST",
            "NODE_ENV",
            "CORS_ORIGIN",
            "SESSION_SECRET",
            "ANALYTICS_DB_URL",
            "APP_DB_URL",
            "MIGRATION_DB_URL",
            "PROVIDER_MODE",
            "OLLAMA_HOST",
            "OLLAMA_MODEL",
            "GROQ_API_KEY",
            "GROQ_MODEL",
            "DAILY_CLOUD_BUDGET_USD",
            "GENERATION_TIMEOUT_LOCAL_MS",
            "GENERATION_TIMEOUT_CLOUD_MS",
            "ANALYTICS_TIMEZONE",
        ];

        for (const key of requiredKeys) {
            assert.ok(
                Object.prototype.hasOwnProperty.call(parsed, key) && parsed[key].length > 0,
                `.env.example must define non-empty placeholder for ${key}`
            );
        }

        // Verify .env.example validates cleanly via validateConfig
        const validated = validateConfig({
            PORT: Number.parseInt(parsed.PORT, 10),
            HOST: parsed.HOST,
            NODE_ENV: parsed.NODE_ENV as "development" | "production" | "test",
            CORS_ORIGIN: parsed.CORS_ORIGIN,
            SESSION_SECRET: parsed.SESSION_SECRET,
            ANALYTICS_DB_URL: parsed.ANALYTICS_DB_URL,
            APP_DB_URL: parsed.APP_DB_URL,
            PROVIDER_MODE: parsed.PROVIDER_MODE as "local" | "hybrid" | "cloud",
            OLLAMA_HOST: parsed.OLLAMA_HOST,
            OLLAMA_MODEL: parsed.OLLAMA_MODEL,
            GROQ_API_KEY: parsed.GROQ_API_KEY,
            GROQ_MODEL: parsed.GROQ_MODEL,
            DAILY_CLOUD_BUDGET_USD: Number.parseFloat(parsed.DAILY_CLOUD_BUDGET_USD),
            GENERATION_TIMEOUT_LOCAL_MS: Number.parseInt(parsed.GENERATION_TIMEOUT_LOCAL_MS, 10),
            GENERATION_TIMEOUT_CLOUD_MS: Number.parseInt(parsed.GENERATION_TIMEOUT_CLOUD_MS, 10),
            ANALYTICS_TIMEZONE: parsed.ANALYTICS_TIMEZONE,
        });

        assert.equal(validated.PORT, 3001);
        assert.equal(validated.PROVIDER_MODE, "local");
    });

    it("fails closed when SESSION_SECRET is shorter than 32 characters", () => {
        assert.throws(
            () => validateConfig({ SESSION_SECRET: "too-short" }),
            /Invalid SESSION_SECRET/
        );
    });

    it("fails closed when PORT is invalid or out of range", () => {
        assert.throws(() => validateConfig({ PORT: Number.NaN }), /Invalid PORT/);
        assert.throws(() => validateConfig({ PORT: 0 }), /Invalid PORT/);
        assert.throws(() => validateConfig({ PORT: 70000 }), /Invalid PORT/);
    });

    it("fails closed when database URLs do not use postgresql:// or postgres://", () => {
        assert.throws(
            () => validateConfig({ ANALYTICS_DB_URL: "mysql://user:pass@localhost/db" }),
            /Invalid ANALYTICS_DB_URL/
        );
        assert.throws(
            () => validateConfig({ APP_DB_URL: "sqlite://app.db" }),
            /Invalid APP_DB_URL/
        );
    });

    it("fails closed when NODE_ENV or PROVIDER_MODE is unsupported", () => {
        assert.throws(
            () => validateConfig({ NODE_ENV: "staging_invalid" as "development" }),
            /Invalid NODE_ENV/
        );
        assert.throws(
            () => validateConfig({ PROVIDER_MODE: "openai" as "local" }),
            /Invalid PROVIDER_MODE/
        );
    });

    it("fails closed when budget or timeouts are invalid", () => {
        assert.throws(
            () => validateConfig({ DAILY_CLOUD_BUDGET_USD: -1 }),
            /Invalid DAILY_CLOUD_BUDGET_USD/
        );
        assert.throws(
            () => validateConfig({ GENERATION_TIMEOUT_LOCAL_MS: 0 }),
            /Invalid GENERATION_TIMEOUT_LOCAL_MS/
        );
        assert.throws(
            () => validateConfig({ GENERATION_TIMEOUT_CLOUD_MS: -500 }),
            /Invalid GENERATION_TIMEOUT_CLOUD_MS/
        );
    });
});

