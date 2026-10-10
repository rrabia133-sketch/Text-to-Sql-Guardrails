# Relational Data Schema Design

- **Engine:** PostgreSQL 16
- **Schema:** `public`
- **Scope:** Synthetic E-commerce Analytics

---

## 1. Entity Relationship Overview

```text
customers (1) <--- (N) orders (1) <--- (N) order_items (N) ---> (1) products
```

- A **Customer** can have many **Orders** (`1:N`).
- An **Order** contains one or more **Order Items** (`1:N`).
- An **Order Item** references exactly one catalog **Product** (`N:1`).

---

## 2. Table Specifications

### 2.1 Table: `customers`
Stores customer profile and geographic region for market segmentation.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY GENERATED ALWAYS AS IDENTITY` | Unique customer identifier |
| `name` | `VARCHAR(100)` | `NOT NULL` | Full customer display name |
| `region` | `VARCHAR(50)` | `NOT NULL` | Geographic sales region (e.g., 'EMEA', 'Americas', 'APAC') |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT CURRENT_TIMESTAMP` | Account registration timestamp (UTC) |

### 2.2 Table: `products`
Stores product catalog, categories, and standard catalog unit prices.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY GENERATED ALWAYS AS IDENTITY` | Unique product identifier |
| `name` | `VARCHAR(150)` | `NOT NULL` | Product name |
| `category` | `VARCHAR(50)` | `NOT NULL` | Category hierarchy (e.g., 'Electronics', 'Footwear') |
| `unit_price` | `NUMERIC(10, 2)`| `NOT NULL CHECK (unit_price >= 0)` | Standard catalog unit price |

### 2.3 Table: `orders`
Stores order headers, fulfillment lifecycle status, and placement timestamps.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY GENERATED ALWAYS AS IDENTITY` | Unique order identifier |
| `customer_id` | `INTEGER` | `NOT NULL REFERENCES customers(id)` | Placing customer ID (FK) |
| `status` | `VARCHAR(20)` | `NOT NULL CHECK (status IN ('completed', 'shipped', 'cancelled', 'pending'))` | Lifecycle status |
| `ordered_at` | `TIMESTAMPTZ` | `NOT NULL` | Timestamp when order was placed (UTC) |

### 2.4 Table: `order_items`
Stores line items per order. Each item captures quantity and historical unit price at time of purchase.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `INTEGER` | `PRIMARY KEY GENERATED ALWAYS AS IDENTITY` | Unique line item identifier |
| `order_id` | `INTEGER` | `NOT NULL REFERENCES orders(id) ON DELETE CASCADE` | Parent order reference (FK) |
| `product_id` | `INTEGER` | `NOT NULL REFERENCES products(id)` | Purchased product reference (FK) |
| `quantity` | `INTEGER` | `NOT NULL CHECK (quantity > 0)` | Quantity purchased |
| `unit_price` | `NUMERIC(10, 2)`| `NOT NULL CHECK (unit_price >= 0)` | Actual unit price at purchase |

---

## 3. Allowed Joins & Guardrails Against Duplication

### 3.1 Allowed Join Paths
1. **`orders` -> `customers`**
   - Join condition: `orders.customer_id = customers.id`
   - Multiplicity: Many-to-One. Safe to aggregate without row inflation.

2. **`orders` -> `order_items`**
   - Join condition: `order_items.order_id = orders.id`
   - Multiplicity: One-to-Many.

3. **`order_items` -> `products`**
   - Join condition: `order_items.product_id = products.id`
   - Multiplicity: Many-to-One. Safe for category and product breakdowns.

### 3.2 Join Fanout Guardrail (Multi-Item Order Pitfall)
When joining `orders` with `order_items`, an order with 3 items generates 3 distinct rows:
* **Revenue Calculation Rule:** Always calculate revenue using line items:
  ```sql
  SUM(order_items.quantity * order_items.unit_price)
  ```
* **Order Count Rule:** Never count orders with `COUNT(*)` across a line-item join. Always use:
  ```sql
  COUNT(DISTINCT orders.id)
  ```

---

## 4. Indexing Strategy (For Spike Fixture)
- `CREATE INDEX idx_orders_customer_id ON orders(customer_id);`
- `CREATE INDEX idx_orders_ordered_at ON orders(ordered_at);`
- `CREATE INDEX idx_order_items_order_id ON order_items(order_id);`
- `CREATE INDEX idx_order_items_product_id ON order_items(product_id);`
