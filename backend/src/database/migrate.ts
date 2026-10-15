import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { config } from "../config/env.js";

export async function runMigrations() {
    console.log("🚀 Starting database migrations for app_db...");
    const pool = new Pool({
        connectionString: config.APP_DB_URL,
    });

    let client;
    try {
        client = await pool.connect();

        // Ensure migrations tracking table exists
        await client.query(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Look for migration files in database/app/migrations relative to repo root
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const repoRoot = path.resolve(__dirname, "../../..");
        const migrationsDir = path.resolve(repoRoot, "database", "app", "migrations");

        let files: string[] = [];
        try {
            files = await fs.readdir(migrationsDir);
        } catch {
            // Fallback for custom cwd if directory structure varies
            const fallbackDir = path.resolve(process.cwd(), "database", "app", "migrations");
            files = await fs.readdir(fallbackDir);
        }

        const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

        for (const file of sqlFiles) {
            const alreadyRun = await client.query(
                "SELECT 1 FROM _migrations WHERE name = $1",
                [file]
            );

            if (alreadyRun.rowCount && alreadyRun.rowCount > 0) {
                console.log(`⏭️  Skipping already applied migration: ${file}`);
                continue;
            }

            console.log(`⚡ Applying migration: ${file}...`);
            const filePath = path.join(migrationsDir, file);
            const sql = await fs.readFile(filePath, "utf-8");

            await client.query("BEGIN");
            await client.query(sql);
            await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
            await client.query("COMMIT");

            console.log(`✅ Applied migration: ${file}`);
        }

        console.log("🎉 All migrations applied successfully!");
    } catch (error) {
        if (client) {
            await client.query("ROLLBACK").catch(() => {});
        }
        console.error("❌ Migration failed:", error);
        throw error;
    } finally {
        if (client) {
            client.release();
        }
        await pool.end();
    }
}

// Allow direct execution: tsx src/database/migrate.ts
const isMain =
    process.argv[1] &&
    path.resolve(fileURLToPath(import.meta.url)).toLowerCase() ===
        path.resolve(process.argv[1]).toLowerCase();

if (isMain) {
    runMigrations()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error("❌ Migration runner error:", err);
            process.exit(1);
        });
}


