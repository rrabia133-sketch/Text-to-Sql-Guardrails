
---

### Part 2: Create `docs/sprint-1/glossary.md`

Create the file [docs/sprint-1/glossary.md](file:///d:/React-project/Text-to-SQL%20Interface/docs/sprint-1/glossary.md) with the content below.

#### Why this matters:
* LLMs frequently calculate revenue incorrectly if you don't define whether *cancelled* or *pending* orders are included.
* Date calculations like `"in the last 30 days"` produce flaky, non-reproducible test results unless anchored to a **deterministic reference test date** (`2026-10-01 00:00:00 UTC`).

```markdown
# Business Glossary & Metric Definitions

- **Scope:** Synthetic E-commerce Analytics Spike
- **Timezone Standard:** UTC
- **Reference Test Date:** `2026-10-01 00:00:00 UTC`

---

## 1. Metric Definitions

### 1.1 Revenue
* **Definition:** Total gross revenue from finalized customer purchases.
* **Formula:** `SUM(order_items.quantity * order_items.unit_price)`
* **Filter Conditions:** Only orders with status IN (`'completed'`, `'shipped'`).
* **Exclusions:** Exclude `'cancelled'` and `'pending'` orders. Tax, discounts, and shipping charges are not modeled in this spike.

### 1.2 Eligible Order Statuses
* **Finalized / Recognized Revenue:** `'completed'`, `'shipped'`.
* **Non-Revenue / Unrecognized:** `'pending'` (unpaid/processing), `'cancelled'` (voided).

### 1.3 Active Customer
* **Definition:** Any customer who has placed at least one eligible order (`status IN ('completed', 'shipped')`) within the 90-day window before the Reference Test Date (`2026-07-03` to `2026-10-01`).

### 1.4 Date Boundaries
* **Standard Test Anchor:** `2026-10-01 00:00:00 UTC`.
* **"Last 30 Days":** `ordered_at >= '2026-09-01 00:00:00 UTC'` AND `ordered_at < '2026-10-01 00:00:00 UTC'`.

---

## 2. Hand-Calculated Verification Example

To verify fixture correctness in Task 4, here is a small hand-calculated reference:

### Synthetic Dataset:
* **Customer A (id: 1):**
  * Order 101 (`completed`, `2026-09-15`):
    * 2 x Product 1 @ $10.00 = $20.00
    * 1 x Product 2 @ $15.50 = $15.50
    * *Order Total:* **$35.50**
  * Order 102 (`cancelled`, `2026-09-20`):
    * 1 x Product 1 @ $10.00 = $10.00 (EXCLUDED)
* **Customer B (id: 2):**
  * Order 103 (`shipped`, `2026-09-25`):
    * 3 x Product 3 @ $5.00 = $15.00
    * *Order Total:* **$15.00**

### Hand-Verified Results:
1. **Total Recognized Revenue:** `$35.50 + $15.00 = $50.50`
2. **Top Customer by Revenue:** Customer A (`$35.50`)
3. **Active Customers in Last 30 Days:** 2 (Customer A, Customer B)
