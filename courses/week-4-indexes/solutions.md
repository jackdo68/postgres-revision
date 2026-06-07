# Week 4 Solutions

## Exercise 1: Pagila Index Audit

Key findings:
- `film_actor` has indexes on both `actor_id` and `film_id` — well-designed for joins from either direction
- `rental` has indexes on `inventory_id`, `customer_id`, and a unique index on `(rental_date, inventory_id, customer_id)`
- `payment` partitions each have their own indexes (FK indexes on `customer_id` and `staff_id`)

FK columns that might benefit from additional indexes: check if `address.city_id`, `city.country_id` are indexed — these are used in location lookups.

---

## Exercise 2: Sequential Scan

The `rental_rate` query on `film` (1,000 rows) will likely Seq Scan even with an index because:
- The table is small (~1,000 rows)
- The filter `BETWEEN 2.99 AND 4.99` matches a large percentage of rows
- Postgres's cost estimator decides Seq Scan is cheaper than the overhead of index lookups + heap fetches

**The lesson:** Postgres only uses an index when it estimates the index path is cheaper. For small tables or low-selectivity filters, Seq Scan wins. This is correct behaviour, not a problem.

When you narrow to `rental_rate = 4.99`, selectivity improves and Postgres is more likely to use the index — but may still choose Seq Scan on a 1,000-row table.

---

## Exercise 3: Partial Index

**Typical findings:**
- Unreturned rentals: ~183 out of ~16,044 total (~1.1%)
- Partial index size: ~16 KB
- Full index size: ~360 KB
- Partial index is ~20x smaller

The partial index is dramatically smaller because it only indexes the 1% of rows that match the WHERE clause. For workloads where you're mostly querying active/pending records, this is a massive win.

**Interview talking point:** "Partial indexes are underused. If 95% of your queries hit 5% of your data, index only that 5%. The index is smaller, faster to scan, and cheaper to maintain on writes."

---

## Exercise 4: Composite Index Column Order

**Query 1** (`customer_id = 5 AND rental_date > ...`):
- Uses `idx_rental_cust_date` — leftmost column matches the equality filter, second column handles the range
- Could also use `idx_rental_date_cust` but less efficiently

**Query 2** (`rental_date > ...` only):
- Uses `idx_rental_date_cust` — rental_date is the leftmost column
- CANNOT efficiently use `idx_rental_cust_date` — would need to scan all customer_id values

**Query 3** (`customer_id = 5` only):
- Uses `idx_rental_cust_date` — leftmost column matches
- CANNOT use `idx_rental_date_cust`

**The rule:**
1. Equality columns first, range columns second
2. The most frequently filtered column should be leftmost
3. If you always filter by customer_id (sometimes with date, sometimes without), put customer_id first

---

## Exercise 5: GIN and JSONB

Pagila should have a GIN index on `film.fulltext`. The `to_tsquery('dinosaur')` query should show an Index Scan using GIN.

For the JSONB exercise:
- Without GIN: Seq Scan on the metadata column, checking every row
- With GIN: Bitmap Index Scan, only touching rows where metadata contains the key
- Speed difference on 500 rows is small, but at 1M+ rows with complex JSONB, GIN is essential

**Interview talking point:** "GIN indexes are the answer to 'JSONB is slow.' Without a GIN index, every JSONB query is a sequential scan. With one, containment queries (`@>`) become index lookups. The trade-off is write speed — GIN indexes are expensive to maintain, so don't create them on high-write JSONB columns unless you're querying them frequently."

---

## Exercise 6: Write Cost of Over-indexing

**Typical results (300k rows):**

| Scenario | Insert Time |
|----------|------------|
| PK only | ~1.5s |
| PK + 4 indexes | ~4–6s |

That's roughly **2–4x slower** with 4 extra indexes. Each index must be updated on every insert.

**Index size vs table size:**
```sql
SELECT
    pg_size_pretty(pg_relation_size('write_test')) AS table_size,
    pg_size_pretty(pg_indexes_size('write_test'::regclass)) AS total_index_size;
```

Index size often exceeds table size when you have 4+ indexes — you're storing the data multiple times in different orders.

**When over-indexing hurts:**
- High-write tables (queues, event logs, audit tables)
- Tables where most indexes serve rare queries
- OLTP systems where write latency matters

---

## Week 4 Interview Flash Card

**Q: How do you decide which indexes to add?**

"I start with EXPLAIN ANALYZE on the actual slow queries — not guessing. I look for Seq Scans on large tables with selective filters. For the index type: B-tree covers 90% of cases. Partial indexes for frequently queried subsets. Composite indexes with equality columns first, range columns second. GIN for JSONB or full-text. I also track the write cost — every index slows inserts, so I remove indexes that serve queries running less than once per minute. The goal is the minimum set of indexes that covers your hot query paths."
