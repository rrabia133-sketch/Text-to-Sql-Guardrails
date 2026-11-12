import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function checkNodeVersion() {
    const [major] = process.versions.node.split(".").map((n) => Number.parseInt(n, 10));
    if (Number.isNaN(major) || major < 22) {
        console.error(
            `[setup] Node.js >= 22.0.0 is required, found ${process.versions.node}.`
        );
        process.exit(1);
    }
    console.log(`[setup] Node.js ${process.versions.node} detected.`);
}

function ensureEnvFile() {
    const envExamplePath = path.join(rootDir, ".env.example");
    const envPath = path.join(rootDir, ".env");

    if (!fs.existsSync(envExamplePath)) {
        console.error("[setup] Missing .env.example at repository root.");
        process.exit(1);
    }

    if (fs.existsSync(envPath)) {
        console.log("[setup] Existing .env preserved (not overwritten).");
        return;
    }

    fs.copyFileSync(envExamplePath, envPath);
    console.log("[setup] Created .env from .env.example (placeholder dev defaults).");
}

function buildContracts() {
    const tscBin = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");
    const contractsTsconfig = path.join(rootDir, "packages", "contracts", "tsconfig.json");

    if (!fs.existsSync(tscBin)) {
        console.error(
            "[setup] TypeScript compiler not found in node_modules. Run `npm ci` first."
        );
        process.exit(1);
    }

    console.log("[setup] Building @text2sql/contracts...");
    execFileSync(process.execPath, [tscBin, "-p", contractsTsconfig], {
        cwd: rootDir,
        stdio: "inherit",
    });
    console.log("[setup] @text2sql/contracts built successfully.");
}

function checkDockerAvailability() {
    try {
        execFileSync("docker", ["compose", "version"], {
            cwd: rootDir,
            stdio: "ignore",
        });
        console.log("[setup] Docker Compose CLI is available.");
    } catch {
        console.warn(
            "[setup] Warning: Docker Compose CLI was not detected or is unavailable in PATH."
        );
    }
}

function main() {
    console.log("=== Text-to-SQL Workspace Setup ===");
    checkNodeVersion();
    ensureEnvFile();
    buildContracts();
    checkDockerAvailability();

    console.log("\nSetup complete. Next steps:");
    console.log("  1. Start PostgreSQL:      npm run db:up");
    console.log("  2. Apply app migrations:  npm run migrate");
    console.log("  3. Start dev servers:     npm run dev");
    console.log("  4. Run quality gates:     npm run lint && npm run typecheck && npm run test");
}

main();

