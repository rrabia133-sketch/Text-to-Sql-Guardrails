-- Deterministic Small Synthetic Dataset for Testing

-- 1. Customers (including boundary case: Charlie has no orders)
INSERT INTO customers (id, name, region, created_at) OVERRIDING SYSTEM VALUE VALUES
(1, 'Alice Smith', 'EMEA', '2026-08-01 09:00:00+00'),
(2, 'Bob Jones', 'Americas', '2026-08-15 11:30:00+00'),
(3, 'Charlie Brown', 'APAC', '2026-08-20 14:00:00+00'),
(4, 'Diana Prince', 'EMEA', '2026-09-01 16:45:00+00');

-- 2. Products (including boundary case: Product 4 is never ordered)
INSERT INTO products (id, name, category, unit_price) OVERRIDING SYSTEM VALUE VALUES
(1, 'Laptop Pro 15', 'Electronics', 10.00),
(2, 'Wireless Mouse', 'Electronics', 15.50),
(3, 'USB-C Cable', 'Accessories', 5.00),
(4, 'Mechanical Keyboard', 'Electronics', 45.00);

-- 3. Orders (including completed, shipped, cancelled, and pending statuses)
INSERT INTO orders (id, customer_id, status, ordered_at) OVERRIDING SYSTEM VALUE VALUES
(101, 1, 'completed', '2026-09-15 10:00:00+00'),
(102, 1, 'cancelled', '2026-09-20 12:00:00+00'),
(103, 2, 'shipped',   '2026-09-25 14:00:00+00'),
(104, 4, 'pending',   '2026-09-28 09:00:00+00');

-- 4. Order Items
INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
-- Order 101 items (Total = (2 * $10.00) + (1 * $15.50) = $35.50)
(101, 1, 2, 10.00),
(101, 2, 1, 15.50),
-- Order 102 items (Cancelled order: $10.00 - should be excluded from revenue)
(102, 1, 1, 10.00),
-- Order 103 items (Total = 3 * $5.00 = $15.00)
(103, 3, 3, 5.00),
-- Order 104 items (Pending order: $45.00 - should be excluded from revenue)
(104, 4, 1, 45.00);
