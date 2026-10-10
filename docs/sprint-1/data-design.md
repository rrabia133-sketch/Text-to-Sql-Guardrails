# Relational Data Schema Design

- **Engine:** PostgreSQL 16
- **Schema:** `public`
- **Scope:** Synthetic E-commerce Analytics

---

## 1. Entity Relationship Overview

```text
customers (1) <--- (N) orders (1) <--- (N) order_items (N) ---> (1) products
