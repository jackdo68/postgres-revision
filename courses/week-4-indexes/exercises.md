# Week 4 Exercises: Indexes

## Exercise 1: Audit Pagila's Existing Indexes

**Task:** List all indexes in Pagila and understand what they cover.

```sql
SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

**Questions:**
1. Which tables have the most indexes?
2. Are there any tables with FK columns that are NOT indexed? (These are potential bottleneck points)
3. Find a composite index — what column order does it use?

---

## Exercise 2: Catch a Sequential Scan

**Task:** Write a query that forces a Seq Scan, then fix it.

```sql
-- This should Seq Scan (no index on rental_rate range queries typically)
EXPLAIN ANALYZE
SELECT * FROM film WHERE rental_rate BETWEEN 2.99 AND 4.99;

-- Record: Seq Scan? How many rows? Execution time?
```

**Now add an index and re-run:**

```sql
CREATE INDEX idx_film_rental_rate ON film (rental_rate);

EXPLAIN ANALYZE
SELECT * FROM film WHERE rental_rate BETWEEN 2.99 AND 4.99;

-- Did the plan change? Is it faster? By how much?
-- IMPORTANT: Postgres may still choose Seq Scan if the selectivity is low
-- (i.e., most rows match). Check what percentage of rows match your filter.
```

**Questions:**
1. If Postgres still uses Seq Scan after adding the index, why?
2. Narrow the range to `rental_rate = 4.99` — does it use the index now?

---

## Exercise 3: Partial Index

**Task:** Create a partial index for "active rentals" (not yet returned).

```sql
-- First: how many rentals are unreturned?
SELECT count(*) FROM rental WHERE return_date IS NULL;
SELECT count(*) FROM rental;
-- What percentage is unreturned?

-- Create the partial index
CREATE INDEX idx_active_rentals ON rental (customer_id)
WHERE return_date IS NULL;

-- Compare these two queries:
EXPLAIN ANALYZE
SELECT * FROM rental WHERE customer_id = 5 AND return_date IS NULL;

-- Drop the partial index and run again
DROP INDEX idx_active_rentals;
EXPLAIN ANALYZE
SELECT * FROM rental WHERE customer_id = 5 AND return_date IS NULL;
```

**Questions:**
1. What was the size difference between a full index and the partial index?
2. How much faster was the query with the partial index?

Check index sizes:
```sql
-- Recreate to compare
CREATE INDEX idx_active_rentals ON rental (customer_id) WHERE return_date IS NULL;
CREATE INDEX idx_all_rentals ON rental (customer_id);

SELECT indexname, pg_size_pretty(pg_relation_size(indexname::regclass)) AS size
FROM pg_indexes WHERE indexname IN ('idx_active_rentals', 'idx_all_rentals');
```

---

## Exercise 4: Composite Index Column Order

**Task:** Prove that column order in a composite index matters.

```sql
-- Create two composite indexes with reversed column order
CREATE INDEX idx_rental_cust_date ON rental (customer_id, rental_date);
CREATE INDEX idx_rental_date_cust ON rental (rental_date, customer_id);

-- Query 1: filter by customer, then date
EXPLAIN ANALYZE
SELECT * FROM rental WHERE customer_id = 5 AND rental_date > '2022-06-01';

-- Query 2: filter by date only
EXPLAIN ANALYZE
SELECT * FROM rental WHERE rental_date > '2022-06-01';

-- Query 3: filter by customer only
EXPLAIN ANALYZE
SELECT * FROM rental WHERE customer_id = 5;
```

**For each query, note which index Postgres chose (if any). Questions:**
1. Which index does Query 1 use? Why?
2. Which index does Query 2 use? Can it use `idx_rental_cust_date`?
3. Which index does Query 3 use?
4. State the rule: which column should come first in a composite index?

---

## Exercise 5: GIN Index on Full-text

**Task:** Pagila already has a `fulltext` tsvector column on `film`. Explore it.

```sql
-- Check the column
SELECT title, fulltext FROM film LIMIT 3;

-- Search for films about "dinosaur"
EXPLAIN ANALYZE
SELECT title, description FROM film WHERE fulltext @@ to_tsquery('dinosaur');

-- Check if there's already a GIN index
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'film' AND indexdef LIKE '%gin%';

-- If no GIN index exists, create one and compare:
-- CREATE INDEX idx_film_fulltext ON film USING gin(fulltext);
```

**Bonus: add a JSONB column and index it:**

```sql
ALTER TABLE film ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Populate with sample data
UPDATE film SET metadata = jsonb_build_object(
    'tags', ARRAY['classic', 'drama'],
    'rating_source', 'imdb',
    'score', (random() * 10)::numeric(3,1)
) WHERE film_id <= 500;

-- Create GIN index
CREATE INDEX idx_film_metadata ON film USING gin(metadata);

-- Query with containment operator
EXPLAIN ANALYZE
SELECT title FROM film WHERE metadata @> '{"rating_source": "imdb"}';
```

---

## Exercise 6: Index Bloat and Write Cost

**Task:** Measure how indexes slow down writes.

```sql
-- Create a test table with no indexes (except PK)
CREATE TABLE write_test (
    id SERIAL PRIMARY KEY,
    val1 INT,
    val2 INT,
    val3 TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

\timing on

-- Insert 300k rows with no extra indexes
INSERT INTO write_test (val1, val2, val3)
SELECT random()*1000, random()*1000, md5(random()::text)
FROM generate_series(1, 300000);

-- Record time: ___

-- Now add 4 indexes
CREATE INDEX idx_wt_val1 ON write_test(val1);
CREATE INDEX idx_wt_val2 ON write_test(val2);
CREATE INDEX idx_wt_val3 ON write_test(val3);
CREATE INDEX idx_wt_created ON write_test(created_at);

-- Truncate and re-insert
TRUNCATE write_test;

INSERT INTO write_test (val1, val2, val3)
SELECT random()*1000, random()*1000, md5(random()::text)
FROM generate_series(1, 300000);

-- Record time: ___
```

**Questions:**
1. How much slower was the insert with 4 indexes?
2. Check total index size vs table size — what's the ratio?
3. At what point does "index everything" become counter-productive?

---

## Cleanup

```sql
DROP INDEX IF EXISTS idx_film_rental_rate, idx_active_rentals, idx_all_rentals;
DROP INDEX IF EXISTS idx_rental_cust_date, idx_rental_date_cust;
DROP INDEX IF EXISTS idx_film_metadata;
DROP TABLE IF EXISTS write_test;
ALTER TABLE film DROP COLUMN IF EXISTS metadata;
```

---

## Self-Check

- [ ] I can read an EXPLAIN ANALYZE plan and identify Seq Scan vs Index Scan
- [ ] I understand when Postgres ignores an index (low selectivity)
- [ ] I can explain composite index column order with a concrete example
- [ ] I know when to use partial, GIN, and BRIN indexes
- [ ] I measured write overhead from over-indexing
