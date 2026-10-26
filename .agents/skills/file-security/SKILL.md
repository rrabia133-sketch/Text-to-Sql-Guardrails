---
name: file-security
description: >-
  Use this skill whenever creating, modifying, or reviewing file operations, export endpoints, database migrations, configuration files, or secret management. Enforces zero credential leakage, path traversal prevention, CSV formula injection neutralization, and blocks PostgreSQL filesystem access attacks (pg_read_file, COPY TO/FROM PROGRAM).
---

# File Security & Data Protection Skill

This skill defines mandatory security guardrails for file handling, configuration management, export generation, and host filesystem containment across the Text-to-SQL monorepo.

---

## 1. Zero Credential & Secret Leakage Policy

> [!CAUTION]
> **NEVER** hardcode or commit database passwords, API tokens (`GROQ_API_KEY`), session secrets (`SESSION_SECRET`), or private keys into repository files, test scripts, or git commits.

### Mandatory Rules
1. **Environment Separation**:
   - All runtime secrets must reside exclusively in backend environment variables (`process.env`).
   - `.env.example` must contain placeholder values only (e.g., `GROQ_API_KEY=your_groq_api_key_here`).
   - `.env` must remain strictly ignored in `.gitignore`.
2. **Client-Side Isolation**:
   - Frontend Vite applications (`frontend/`) must never import or receive backend configuration, database URLs, or cloud provider API keys.
   - Any `VITE_*` environment variable is compiled into the public client bundle and is treated as public data.
3. **Log & Telemetry Redaction**:
   - Error messages, audit logs, and stack traces must never output database connection strings, authorization tokens, or raw customer PII.

---

## 2. Path Traversal & File Access Containment

When implementing server-side file reading, writing, or static serving:

1. **Strict Path Normalization**:
   - Never pass user-supplied file paths directly to `fs.readFile`, `fs.writeFile`, or child processes.
   - Always resolve paths against a trusted base directory using `path.resolve` and verify containment:
     ```typescript
     const safePath = path.resolve(ALLOWED_BASE_DIR, sanitizedFileName);
     if (!safePath.startsWith(ALLOWED_BASE_DIR)) {
         throw new SecurityViolationError("Path traversal attempt detected");
     }
     ```
2. **Extension & Filename Whitelisting**:
   - Only allow permitted extensions (e.g. `.sql`, `.csv`, `.json`).
   - Strip null bytes (`\0`), directory traversal sequences (`../`, `..\`), and shell metacharacters (`|`, `&`, `;`, `$`, `>`, `<`).

---

## 3. CSV & Export Formula Injection Neutralization (`FR-15`)

When generating CSV or tabular exports from query results:

1. **Formula Character Sanitization**:
   - Spreadsheet applications (Excel, LibreOffice, Google Sheets) execute cells beginning with `=`, `+`, `-`, `@`, `\t`, or `\r` as formulas (CSV Injection / DDE attack).
2. **Neutralization Rule**:
   - Prefix any string cell starting with an active formula character with a single quote (`'`):
     ```typescript
     export function sanitizeCsvCell(value: unknown): string {
         if (value === null || value === undefined) return "";
         const str = String(value);
         if (/^[=+\-@\t\r]/.test(str)) {
             return `'${str}`;
         }
         return str;
     }
     ```
3. **Bounded Export Caps**:
   - CSV exports must enforce the same row limit (500 rows max) and byte limit (1 MiB max) as live query execution.

---

## 4. PostgreSQL Filesystem Attack Prevention

PostgreSQL contains built-in functions and commands capable of reading or writing host files. These are strictly prohibited:

| Forbidden Construct | Attack Vector | Guardrail Enforcement |
| :--- | :--- | :--- |
| `pg_read_file()` | Arbitrary host file read (e.g., `/etc/passwd`) | Blocked by AST function whitelist & `analytics_user` lacks superuser rights |
| `pg_read_binary_file()` | Binary file exfiltration | Blocked by AST function whitelist |
| `pg_ls_dir()` | Directory enumeration on host server | Blocked by AST function whitelist |
| `COPY ... TO/FROM PROGRAM` | Remote Code Execution via OS shell | Blocked: `COPY` statement unconditionally rejected by AST parser |
| `COPY ... TO/FROM 'file'` | Local file read/write via database daemon | Blocked: `COPY` statement rejected by AST parser & role permissions |

---

## 5. Pre-Commit & Review Verification Checklist

Before finalizing any task involving file operations or configuration:

- [ ] Run `git status` to ensure no `.env`, credential, or artifact dump is staged.
- [ ] Verify CSV export utilities apply single-quote sanitization to formula characters.
- [ ] Verify file read/write operations strictly check path boundaries against directory traversal.
- [ ] Verify test fixtures use synthetic data and mock credentials only.
- [ ] Run `npm run test` and `npm run typecheck` to confirm all security gates pass.
