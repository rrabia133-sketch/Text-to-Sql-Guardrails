# Task Contract Template

## 1. Identity & Traceability
- **Task ID:** `TASK-XX`
- **Linked Story:** `US-XX`
- **Linked DevOps:** `DO-XX`
- **Target Functional Requirements:** `FR-XX`
- **Target Non-Functional Requirements:** `NFR-XX`

---

## 2. Objective & Scope
- **Objective:** Brief description of the exact behavioral or architectural change.
- **Allowed File Scope:**
  - `packages/contracts/src/...`
  - `backend/src/modules/...`
  - `backend/test/...`
  - `frontend/src/...`
- **Explicit Exclusions:** Files or modules outside the boundary of this task.

---

## 3. Pre-Conditions & Dependencies
- Preceding tasks or contracts that must be completed first.
- Required environment settings, database tables, or seed fixtures.

---

## 4. Implementation Checklist
- [ ] Subtask 1
- [ ] Subtask 2
- [ ] Subtask 3

---

## 5. Verification Commands & Acceptance Check
- Command: `npm run typecheck`
- Command: `npx tsx --test test/unit/<file>.test.ts`
- **Done When:** Concrete, observable behavior and exit condition.
