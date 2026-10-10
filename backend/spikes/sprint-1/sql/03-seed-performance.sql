-- Performance Fixture Generator (100,000 Orders)
-- Run on-demand when testing query throughput and latency

DO $$
BEGIN
    RAISE NOTICE 'Starting performance dataset generation...';

    -- Generate 5,000 customers
    INSERT INTO customers (name, region, created_at)
    SELECT 
        'Customer ' || g,
        (ARRAY['EMEA', 'Americas', 'APAC'])[floor(random() * 3 + 1)],
        TIMESTAMPTZ '2026-01-01 00:00:00 UTC' + (random() * (interval '270 days'))
    FROM generate_series(5, 5000) AS g;

    -- Generate 100,000 orders across the customers
    INSERT INTO orders (customer_id, status, ordered_at)
    SELECT 
        floor(random() * 5000 + 1)::int,
        (ARRAY['completed', 'shipped', 'cancelled', 'pending'])[floor(random() * 4 + 1)],
        TIMESTAMPTZ '2026-06-01 00:00:00 UTC' + (random() * (interval '120 days'))
    FROM generate_series(1, 100000) AS g;

    -- Generate order items (approx 1-3 items per order)
    INSERT INTO order_items (order_id, product_id, quantity, unit_price)
    SELECT 
        o.id,
        floor(random() * 4 + 1)::int,
        floor(random() * 5 + 1)::int,
        p.unit_price
    FROM orders o
    JOIN products p ON p.id = floor(random() * 4 + 1)::int
    WHERE o.id > 104;

    RAISE NOTICE 'Performance dataset generation completed.';
END $$;
