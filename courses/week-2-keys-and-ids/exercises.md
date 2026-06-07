# Week 2 Exercises: Keys & IDs

## Exercise 1: Measure Pagila's Current Keys

**Task:** Inspect the primary key types across Pagila tables.

```sql
-- List all primary keys and their data types
SELECT
    tc.table_name,
    kcu.column_name,
    c.data_type,
    c.udt_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.columns c
    ON c.table_name = kcu.table_name AND c.column_name = kcu.column_name
WHERE tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema = 'public'
ORDER BY tc.table_name;
```

**Questions:**
1. What data type does Pagila use for all its PKs?
2. What's the current max `customer_id`? What does that tell an attacker?
3. What's the max `payment_id`? Does it correlate with row count?

---

## Exercise 2: Create Three Versions of a Table

**Task:** Create the same table with three different PK strategies:

```sql
-- Version 1: SERIAL
CREATE TABLE orders_serial (
    id SERIAL PRIMARY KEY,
    customer_id INT,
    amount NUMERIC(10,2),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Version 2: UUID
CREATE TABLE orders_uuid (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id INT,
    amount NUMERIC(10,2),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Version 3: ULID-like (timestamp prefix + random)
-- Postgres doesn't have native ULID, so we simulate with uuid v7 pattern
CREATE TABLE orders_ulid (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- we'll fix this below
    customer_id INT,
    amount NUMERIC(10,2),
    created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Exercise 3: Bulk Insert Benchmark

**Task:** Insert 500,000 rows into each table and compare performance.

```sql
-- SERIAL version
INSERT INTO orders_serial (customer_id, amount)
SELECT
    (random() * 599 + 1)::int,
    (random() * 100)::numeric(10,2)
FROM generate_series(1, 500000);

-- UUID version
INSERT INTO orders_uuid (customer_id, amount)
SELECT
    (random() * 599 + 1)::int,
    (random() * 100)::numeric(10,2)
FROM generate_series(1, 500000);

-- Time each one. Record the results here:
-- SERIAL insert time: ___
-- UUID insert time: ___
```

**Questions:**
1. Which was faster? By how much?
2. Why? (Think about what the B-tree index is doing during each insert)

---

## Exercise 4: Compare Index Sizes

**Task:** After the bulk inserts, compare the physical sizes:

```sql
SELECT
    relname AS table_name,
    pg_size_pretty(pg_relation_size(oid)) AS table_size,
    pg_size_pretty(pg_indexes_size(oid)) AS index_size
FROM pg_class
WHERE relname IN ('orders_serial', 'orders_uuid', 'orders_ulid')
ORDER BY relname;
```

**Also check index page density:**

```sql
-- Install pgstattuple extension if available
CREATE EXTENSION IF NOT EXISTS pgstattuple;

-- Check index fragmentation (leaf page density)
SELECT * FROM pgstatindex('orders_serial_pkey');
SELECT * FROM pgstatindex('orders_uuid_pkey');
```

**Questions:**
1. Which index is larger? By how much?
2. What's the `avg_leaf_density` for each? (Higher = less fragmented)
3. What does this tell you about long-running production tables with UUID PKs?

---

## Exercise 5: Range Query Performance

**Task:** Compare a range scan on each table:

```sql
-- SERIAL: grab the last 100 orders
EXPLAIN ANALYZE
SELECT * FROM orders_serial WHERE id > 499900 ORDER BY id LIMIT 100;

-- UUID: grab 100 orders (can't do range easily — this is the point)
-- Try this instead:
EXPLAIN ANALYZE
SELECT * FROM orders_uuid ORDER BY id LIMIT 100;

-- Compare: sort by created_at (both have it)
EXPLAIN ANALYZE
SELECT * FROM orders_serial ORDER BY created_at DESC LIMIT 100;

EXPLAIN ANALYZE
SELECT * FROM orders_uuid ORDER BY created_at DESC LIMIT 100;
```

**Questions:**
1. Why is the SERIAL range query so much faster?
2. Can you use UUIDs for pagination? What's the workaround?
3. How would ULIDs solve this problem?

---

## Exercise 6: Security Implications

**Task:** Think through this scenario:

Your API returns `/api/orders/1042` for a customer's order. An attacker changes it to `/api/orders/1041`.

```sql
-- Simulate: can you enumerate orders?
SELECT * FROM orders_serial WHERE id IN (1, 2, 3, 4, 5);

-- Now try with UUIDs:
SELECT * FROM orders_uuid LIMIT 5;
-- Can you guess the next UUID? The previous one?
```

**Write your thoughts:** When does ID enumeration actually matter vs. when is it security theater? (Hint: authorization checks matter more than ID obscurity)

---

## Cleanup

```sql
DROP TABLE IF EXISTS orders_serial;
DROP TABLE IF EXISTS orders_uuid;
DROP TABLE IF EXISTS orders_ulid;
DROP EXTENSION IF EXISTS pgstattuple;
```

---

## Self-Check

- [ ] I can explain why UUID inserts are slower than SERIAL with B-tree specifics
- [ ] I measured and recorded actual index size differences
- [ ] I understand when SERIAL is fine vs when you need UUID/ULID
- [ ] I can articulate the security argument for non-sequential IDs
