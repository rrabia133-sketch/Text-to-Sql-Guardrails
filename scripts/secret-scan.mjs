import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PLACEHOLDER_INDICATORS = [
    "your_dev_session_secret_min_32_characters_here",
    "your_groq_api_key_here",
    "your_analytics_password",
    "your_app_password",
    "your_migrator_password",
    "your_session_secret",
    "change-in-production",
    "placeholder",
    "<repo-url>",
];

// Synthetic test fixture tokens used exclusively in automated unit/security tests
const ALLOWED_TEST_FIXTURE_TOKENS = new Set([
    "gsk_test_secret_key_1234567890abcdef",
    "gsk_live_secret_key_9999",
    "gsk_test_key",
    "gsk_valid_key",
    "gsk_secret",
    "gsk_test",
    "gsk_spy",
]);

const TEXT_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".cjs",
    ".json",
    ".yml",
    ".yaml",
    ".md",
    ".sql",
    ".env",
    ".example",
    ".toml",
    ".conf",
    ".css",
    ".html",
    ".sh",
]);

const SECRET_PATTERNS = [
    {
        id: "private-key-block",
        regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
        description: "Private key material detected",
    },
    {
        id: "aws-access-key",
        regex: /\bAKIA[0-9A-Z]{16}\b/g,
        description: "AWS access key ID detected",
    },
    {
        id: "github-pat",
        regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g,
        description: "GitHub personal access token detected",
    },
    {
        id: "groq-api-key",
        regex: /\bgsk_[A-Za-z0-9_]{16,}\b/g,
        description: "Potential Groq API key detected",
    },
    {
        id: "openai-project-key",
        regex: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g,
        description: "Potential OpenAI API key detected",
    },
];

export function isTrackedEnvViolation(trackedFiles) {
    const violations = [];
    for (const file of trackedFiles) {
        const base = path.basename(file);
        if (base === ".env" || (base.startsWith(".env.") && base !== ".env.example")) {
            violations.push({
                file,
                line: 1,
                rule: "tracked-env-file",
                message: `Forbidden environment file tracked in git: ${file}`,
            });
        }
    }
    return violations;
}

export function scanContentForSecrets(content, relPath) {
    const violations = [];
    const normalized = relPath.replace(/\\/g, "/");

    // Do not self-flag regex definitions inside scanner/gitleaks config
    if (normalized === ".gitleaks.toml" || normalized === "scripts/secret-scan.mjs") {
        return violations;
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const lineNumber = i + 1;

        for (const pattern of SECRET_PATTERNS) {
            pattern.regex.lastIndex = 0;
            let match;
            while ((match = pattern.regex.exec(line)) !== null) {
                const matchedToken = match[0];
                if (ALLOWED_TEST_FIXTURE_TOKENS.has(matchedToken)) {
                    continue;
                }
                if (PLACEHOLDER_INDICATORS.some((p) => line.includes(p))) {
                    continue;
                }
                violations.push({
                    file: normalized,
                    line: lineNumber,
                    rule: pattern.id,
                    message: pattern.description,
                });
            }
        }
    }

    // Validate .env.example contains placeholders only
    if (normalized === ".env.example") {
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i].trim();
            if (!line || line.startsWith("#")) {
                continue;
            }
            const eqIdx = line.indexOf("=");
            if (eqIdx === -1) {
                continue;
            }
            const key = line.slice(0, eqIdx).trim();
            const val = line.slice(eqIdx + 1).trim();
            if (key === "GROQ_API_KEY" && val && !val.includes("your_groq_api_key")) {
                violations.push({
                    file: normalized,
                    line: i + 1,
                    rule: "env-example-non-placeholder",
                    message: "GROQ_API_KEY in .env.example must be a placeholder value.",
                });
            }
        }
    }

    return violations;
}

export function getGitTrackedFiles(repoDir) {
    const output = execFileSync("git", ["ls-files", "-z"], {
        cwd: repoDir,
        encoding: "utf8",
    });
    return output.split("\0").filter(Boolean);
}

export function getGitScannableFiles(repoDir) {
    const output = execFileSync(
        "git",
        ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        {
            cwd: repoDir,
            encoding: "utf8",
        }
    );
    return Array.from(new Set(output.split("\0").filter(Boolean)));
}

export function scanRepositorySecrets(repoDir = process.cwd(), explicitFiles = null) {
    const trackedFiles = explicitFiles ?? getGitTrackedFiles(repoDir);
    const filesToScan = explicitFiles ?? getGitScannableFiles(repoDir);
    const violations = [...isTrackedEnvViolation(trackedFiles)];

    for (const relPath of filesToScan) {
        const absPath = path.join(repoDir, relPath);
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
            continue;
        }
        const ext = path.extname(relPath);
        const base = path.basename(relPath);
        if (!TEXT_EXTENSIONS.has(ext) && base !== ".env.example" && !base.startsWith("Dockerfile")) {
            continue;
        }
        const content = fs.readFileSync(absPath, "utf8");
        violations.push(...scanContentForSecrets(content, relPath));
    }

    return {
        filesScanned: filesToScan.length,
        violations,
    };
}

function main() {
    const result = scanRepositorySecrets(process.cwd());
    if (result.violations.length > 0) {
        console.error(`[secret-scan] FAILED with ${result.violations.length} finding(s):`);
        for (const v of result.violations) {
            console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.message}`);
        }
        process.exit(1);
    }
    console.log(
        `[secret-scan] Passed (${result.filesScanned} tracked file(s) scanned; 0 secrets or tracked .env files).`
    );
}

const isMain =
    process.argv[1] &&
    path.resolve(fileURLToPath(import.meta.url)).toLowerCase() ===
    path.resolve(process.argv[1]).toLowerCase();

if (isMain) {
    main();
}
