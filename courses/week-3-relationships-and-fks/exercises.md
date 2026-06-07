# Week 3 Exercises: Relationships & Foreign Keys

## Exercise 1: Map Pagila's FK Chain

**Task:** Find all foreign keys in Pagila and understand the dependency chain.

```sql
SELECT
    tc.table_name AS child_table,
    kcu.column_name AS fk_column,
    ccu.table_name AS parent_table,
    ccu.column_name AS parent_column,
    rc.delete_rule,
    rc.update_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
ORDER BY tc.table_name;
```

**Questions:**
1. How many FKs does Pagila have in total?
2. Which table has the most FKs pointing to it? (Most depended-on table)
3. What delete rules are used? Are any CASCADE?
4. Draw the dependency chain: if you delete a `customer`, what breaks?

---

## Exercise 2: Test CASCADE vs RESTRICT

**Task:** Create a test schema to see CASCADE in action:

```sql
CREATE TABLE test_store (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE test_staff (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    store_id INT REFERENCES test_store(id) ON DELETE CASCADE
);

CREATE TABLE test_rental (
    id SERIAL PRIMARY KEY,
    staff_id INT REFERENCES test_staff(id) ON DELETE CASCADE,
    rental_date TIMESTAMPTZ DEFAULT now()
);

-- Insert test data
INSERT INTO test_store (name) VALUES ('Downtown'), ('Airport');
INSERT INTO test_staff (name, store_id) VALUES ('Alice', 1), ('Bob', 1), ('Carol', 2);
INSERT INTO test_rental (staff_id) VALUES (1), (1), (2), (3), (3), (3);

-- Check counts
SELECT 'stores' AS entity, count(*) FROM test_store
UNION ALL SELECT 'staff', count(*) FROM test_staff
UNION ALL SELECT 'rentals', count(*) FROM test_rental;
```

**Now delete the Downtown store:**

```sql
DELETE FROM test_store WHERE id = 1;
```

**Re-check counts. Questions:**
1. How many staff remain?
2. How many rentals remain?
3. Did you expect this? Is this behaviour safe for a production rental system?

**Now recreate with RESTRICT and try the same delete — what happens?**

---

## Exercise 3: Measure FK Overhead on Writes

**Task:** Compare insert performance with and without FKs.

```sql
-- Table WITH foreign key
CREATE TABLE orders_with_fk (
    id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customer(customer_id),
    amount NUMERIC(10,2)
);

-- Table WITHOUT foreign key
CREATE TABLE orders_without_fk (
    id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL,
    amount NUMERIC(10,2)
);

-- Bulk insert 200k rows into each (using valid customer_ids)
\timing on

INSERT INTO orders_with_fk (customer_id, amount)
SELECT
    (random() * 598 + 1)::int,
    (random() * 100)::numeric(10,2)
FROM generate_series(1, 200000);

INSERT INTO orders_without_fk (customer_id, amount)
SELECT
    (random() * 598 + 1)::int,
    (random() * 100)::numeric(10,2)
FROM generate_series(1, 200000);
```

**Record the times. Questions:**
1. How much slower was the FK version?
2. At what scale would this difference become a bottleneck?
3. What's the risk of dropping the FK? (Hint: insert a row with `customer_id = 99999`)

---

## Exercise 4: Orphaned Data

**Task:** Prove that without FKs, orphaned data happens silently.

```sql
-- Insert an order pointing to a customer that doesn't exist
INSERT INTO orders_without_fk (customer_id, amount) VALUES (99999, 50.00);

-- This succeeds silently. Now try to find the customer:
SELECT o.id, o.customer_id, c.first_name
FROM orders_without_fk o
LEFT JOIN customer c ON o.customer_id = c.customer_id
WHERE c.customer_id IS NULL;
```

**Questions:**
1. How would you detect orphaned rows in production?
2. Write a query that finds ALL orphaned `customer_id` values in `orders_without_fk`
3. How would you prevent this without FKs? (Think: application-level checks, scheduled jobs)

---

## Exercise 5: The N+1 Problem in Pagila

**Task:** Simulate an N+1 query pattern.

```sql
-- Step 1: Get all films (the "1" query)
SELECT film_id, title FROM film LIMIT 10;

-- Step 2: For EACH film, get its actors (the "N" queries)
-- Run each one separately and time it:
SELECT a.first_name, a.last_name FROM actor a
JOIN film_actor fa ON a.actor_id = fa.actor_id
WHERE fa.film_id = 1;
-- repeat for film_id = 2, 3, 4...
```

**Now compare with a single JOIN:**

```sql
EXPLAIN ANALYZE
SELECT f.title, a.first_name, a.last_name
FROM film f
JOIN film_actor fa ON f.film_id = fa.film_id
JOIN actor a ON fa.actor_id = a.actor_id
WHERE f.film_id IN (1,2,3,4,5,6,7,8,9,10);
```

**Questions:**
1. How many total queries does the N+1 approach fire?
2. How much faster is the single JOIN approach?
3. Check the indexes on `film_actor` — what indexes exist? Would adding a composite index help?

---

## Exercise 6: Design a FK Strategy

**Scenario:** You're building a new `orders` table for Pagila. It references `customer`, `film`, and `staff`.

**Write the CREATE TABLE with your FK strategy. Decide for each FK:**
- ON DELETE CASCADE, RESTRICT, or SET NULL?
- Why?

```sql
-- Write your CREATE TABLE here with FK decisions and comments explaining each choice
```

---

## Cleanup

```sql
DROP TABLE IF EXISTS test_rental, test_staff, test_store;
DROP TABLE IF EXISTS orders_with_fk, orders_without_fk;
```

---

## Self-Check

- [ ] I can explain the CASCADE chain and why it's dangerous
- [ ] I measured FK write overhead and can quote a rough percentage
- [ ] I understand when skipping FKs is a valid architectural choice
- [ ] I can detect and fix orphaned data
- [ ] I can articulate the N+1 problem and connect it to missing indexes
