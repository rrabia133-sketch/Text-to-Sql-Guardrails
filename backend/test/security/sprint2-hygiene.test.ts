import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

interface LintViolation {
    file: string;
    line: number;
    rule: string;
    message: string;
}

interface SecretViolation {
    file: string;
    line: number;
    rule: string;
    message: string;
}

describe("DO-04: CI Pipeline, Lint & Secret Scanning Fail-Closed Verification", () => {
    it("verifies CI workflow, gitleaks config, gitignore, and root lifecycle scripts exist", () => {
        const ciPath = path.join(repoRoot, ".github", "workflows", "ci.yml");
        const gitleaksPath = path.join(repoRoot, ".gitleaks.toml");
        const gitignorePath = path.join(repoRoot, ".gitignore");
        const rootPkgPath = path.join(repoRoot, "package.json");

        assert.ok(fs.existsSync(ciPath), ".github/workflows/ci.yml must exist");
        assert.ok(fs.existsSync(gitleaksPath), ".gitleaks.toml must exist");
        assert.ok(fs.existsSync(gitignorePath), ".gitignore must exist");

        const ciYaml = fs.readFileSync(ciPath, "utf8");
        assert.match(ciYaml, /node-version:\s*"?22"?/);
        assert.match(ciYaml, /npm ci/);
        assert.match(ciYaml, /npm run lint/);
        assert.match(ciYaml, /npm run typecheck/);
        assert.match(ciYaml, /npm run test/);
        assert.match(ciYaml, /npm run build/);
        assert.match(ciYaml, /5434:5432/);
        assert.match(ciYaml, /secret-scan\.mjs/);

        const gitignore = fs.readFileSync(gitignorePath, "utf8");
        assert.match(gitignore, /^\.env$/m);
        assert.match(gitignore, /^!\.env\.example$/m);

        const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8")) as {
            scripts: Record<string, string>;
        };
        for (const script of ["setup", "dev", "build", "lint", "typecheck", "test", "secret-scan"]) {
            assert.ok(rootPkg.scripts[script], `Root package.json must define '${script}' script`);
        }
    });

    it("passes secret scan on current tracked repository files", async () => {
        const mod = (await import(
            pathToFileURL(path.join(repoRoot, "scripts", "secret-scan.mjs")).href
        )) as {
            scanRepositorySecrets: (dir: string) => {
                filesScanned: number;
                violations: SecretViolation[];
            };
        };

        const result = mod.scanRepositorySecrets(repoRoot);
        assert.ok(result.filesScanned > 0, "Should scan tracked files");
        assert.deepEqual(
            result.violations,
            [],
            `Expected 0 secret violations, got: ${JSON.stringify(result.violations)}`
        );
    });

    it("fails closed when a .env file is tracked or a real secret token is introduced", async () => {
        const mod = (await import(
            pathToFileURL(path.join(repoRoot, "scripts", "secret-scan.mjs")).href
        )) as {
            isTrackedEnvViolation: (files: string[]) => SecretViolation[];
            scanContentForSecrets: (content: string, relPath: string) => SecretViolation[];
        };

        const envViolations = mod.isTrackedEnvViolation([".env", "backend/.env.local", ".env.example"]);
        assert.equal(envViolations.length, 2, ".env and .env.local must fail while .env.example passes");

        const keyViolations = mod.scanContentForSecrets(
            `const GROQ_KEY = "${"gsk_"}RealLeakedTokenABCDEF1234567890";\n`,
            "backend/src/leaked.ts"
        );
        assert.equal(keyViolations.length, 1);
        assert.equal(keyViolations[0].rule, "groq-api-key");

        const privKeyViolations = mod.scanContentForSecrets(
            `${"-----BEGIN RSA"} ${"PRIVATE KEY-----"}\nMIIE...\n`,
            "backend/src/key.pem"
        );
        assert.equal(privKeyViolations.length, 1);
        assert.equal(privKeyViolations[0].rule, "private-key-block");
    });

    it("linter passes across workspace source directories and fails closed on intentional violations", async () => {
        const mod = (await import(
            pathToFileURL(path.join(repoRoot, "scripts", "lint.mjs")).href
        )) as {
            lintDirectories: (targets: string[], baseDir: string) => {
                filesChecked: number;
                violations: LintViolation[];
            };
            lintFileContent: (content: string, relPath: string) => LintViolation[];
        };

        for (const ws of ["packages/contracts", "backend", "frontend"]) {
            const res = mod.lintDirectories(["src"], path.join(repoRoot, ws));
            assert.ok(res.filesChecked > 0, `${ws}/src must contain files`);
            assert.deepEqual(
                res.violations,
                [],
                `Expected 0 lint violations in ${ws}/src, got: ${JSON.stringify(res.violations)}`
            );
        }

        const intentionalViolations = mod.lintFileContent(
            [
                "debugger;",
                `// ${"@ts-"}ignore`,
                `${"ev"}al('1 + 1');`,
                "console.log('debug leak');",
            ].join("\n"),
            "src/bad-example.ts"
        );
        assert.equal(intentionalViolations.length, 4);
    });
});
