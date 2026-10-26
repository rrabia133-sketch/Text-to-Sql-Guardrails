# Reviewer Checklist & Findings Template

## 1. Review Summary
- **Story / Task Reviewed:** `US-XX / Task-YY`
- **Reviewer Role:** SQL Safety Reviewer / Backend Implementer
- **Outcome:** 🟢 APPROVED / 🔴 CHANGES REQUESTED
- **Date:** YYYY-MM-DD

---

## 2. Guardrail & Security Verification
- [ ] **Zero Raw SQL Injection:** Queries are parsed into AST and validated recursively before execution.
- [ ] **Strict Role Containment:** Analytics queries run under `analytics_user` with `read_only = on` and `statement_timeout = 5s`.
- [ ] **Ownership & IDOR Protection:** Endpoints verify requesting user matches resource owner.
- [ ] **Privacy & Airgap Mode:** In local mode, zero outbound requests to external hosts are made.
- [ ] **No Secrets Exposed:** Passwords, API tokens, and customer PII are not present in logs, responses, or client code.

---

## 3. Code Quality & Standards
- [ ] **Contract Compliance:** API shapes match `@text2sql/contracts` schemas.
- [ ] **Type Safety:** TypeScript strict mode passes without `any` casts.
- [ ] **Error Handling:** Fail closed with sanitized error messages.
- [ ] **Test Coverage:** Automated unit or integration tests cover the new logic.

---

## 4. Findings & Action Items
| Finding ID | Severity (CRITICAL / WARNING / INFO) | Description & Location | Resolution |
| :---: | :---: | :--- | :--- |
| **F-01** | CRITICAL | Example finding | Resolved |
