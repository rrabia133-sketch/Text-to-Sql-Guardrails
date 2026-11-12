import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LINT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const IGNORED_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage"]);

const CONSOLE_LOG_ALLOWED_FILES = new Set([
    path.normalize("src/database/migrate.ts"),
]);

export function collectLintableFiles(targetPaths, baseDir = process.cwd()) {
    const collected = [];

    function walk(currentPath) {
        if (!fs.existsSync(currentPath)) {
            return;
        }
        const stat = fs.statSync(currentPath);
        if (stat.isDirectory()) {
            const name = path.basename(currentPath);
            if (IGNORED_DIRS.has(name)) {
                return;
            }
            for (const entry of fs.readdirSync(currentPath)) {
                walk(path.join(currentPath, entry));
            }
            return;
        }
        if (stat.isFile() && LINT_EXTENSIONS.has(path.extname(currentPath))) {
            collected.push(currentPath);
        }
    }

    for (const rel of targetPaths) {
        walk(path.resolve(baseDir, rel));
    }
    return collected.sort();
}

export function lintFileContent(content, relPath) {
    const normalizedRel = path.normalize(relPath);
    const isTestFile =
        normalizedRel.includes(`${path.sep}test${path.sep}`) ||
        normalizedRel.startsWith(`test${path.sep}`) ||
        normalizedRel.endsWith(".test.ts") ||
        normalizedRel.endsWith(".test.tsx");

    const violations = [];
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const lineNumber = i + 1;
        const trimmed = line.trim();

        if (/^\s*debugger\b/.test(line)) {
            violations.push({
                file: relPath,
                line: lineNumber,
                rule: "no-debugger",
                message: "Unexpected 'debugger' statement.",
            });
        }

        if (/@ts-ignore\b|@ts-expect-error\b/.test(line)) {
            violations.push({
                file: relPath,
                line: lineNumber,
                rule: "no-ts-suppression",
                message: "TypeScript suppression comments (@ts-ignore / @ts-expect-error) are disallowed.",
            });
        }

        if (/\beval\s*\(|new\s+Function\s*\(/.test(line) && !trimmed.startsWith("//") && !trimmed.startsWith("*")) {
            violations.push({
                file: relPath,
                line: lineNumber,
                rule: "no-dynamic-eval",
                message: "Dynamic code evaluation (eval / new Function) is prohibited.",
            });
        }

        if (
            !isTestFile &&
            !CONSOLE_LOG_ALLOWED_FILES.has(normalizedRel) &&
            /\bconsole\.log\s*\(/.test(line) &&
            !trimmed.startsWith("//") &&
            !trimmed.startsWith("*")
        ) {
            violations.push({
                file: relPath,
                line: lineNumber,
                rule: "no-console-log",
                message: "Use structured logger instead of console.log in application source.",
            });
        }

        if (!isTestFile && /(?:AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----)/.test(line)) {
            violations.push({
                file: relPath,
                line: lineNumber,
                rule: "no-embedded-secrets",
                message: "Potential private key or cloud credential detected in source code.",
            });
        }
    }

    return violations;
}

export function lintDirectories(targetPaths, baseDir = process.cwd()) {
    const files = collectLintableFiles(targetPaths, baseDir);
    const allViolations = [];

    for (const filePath of files) {
        const content = fs.readFileSync(filePath, "utf8");
        const relPath = path.relative(baseDir, filePath);
        allViolations.push(...lintFileContent(content, relPath));
    }

    return {
        filesChecked: files.length,
        violations: allViolations,
    };
}

function main() {
    const targets = process.argv.slice(2);
    const pathsToScan = targets.length > 0 ? targets : ["src"];
    const result = lintDirectories(pathsToScan, process.cwd());

    if (result.violations.length > 0) {
        console.error(`[lint] Failed with ${result.violations.length} violation(s):`);
        for (const v of result.violations) {
            console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.message}`);
        }
        process.exit(1);
    }

    console.log(`[lint] Passed (${result.filesChecked} file(s) checked).`);
}

const isMain =
    process.argv[1] &&
    path.resolve(fileURLToPath(import.meta.url)).toLowerCase() ===
        path.resolve(process.argv[1]).toLowerCase();

if (isMain) {
    main();
}
