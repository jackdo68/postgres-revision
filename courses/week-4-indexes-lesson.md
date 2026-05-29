# Week 4: Indexes — The Other Half of Your Schema

## The Core Truth

A table without indexes is a table that does full sequential scans on every query. Indexes make reads fast — but every index slows down writes and consumes storage. The skill isn't knowing index types; it's knowing *which* index for *which* access pattern.

## B-tree — The Default (90% of Your Indexes)

Postgres creates a B-tree by default. It works for equality (`=`), range (`>`, `<`, `BETWEEN`), sorting (`ORDER BY`), and prefix matching (`LIKE 'abc%'`).

**When to use:** almost always your first choice. Covers most query patterns.

**The structure:** a balanced tree where leaf nodes contain pointers to heap rows. Sequential values cluster together, which is why SERIAL PKs have great B-tree performance and random UUIDs don't (Week 2 callback).

## Partial Index — Index Only What You Need

```sql
CREATE INDEX idx_active_rentals ON rental (customer_id)
WHERE return_date IS NULL;
```

This indexes only unreturned rentals — maybe 5% of the table. The index is tiny compared to indexing all rows, and queries with `WHERE return_date IS NULL` hit it directly.

**When to use:** when you frequently query a small subset of rows. Active orders, unprocessed jobs, recent records.

## Composite Index — Column Order Matters

```sql
CREATE INDEX idx_rental_lookup ON rental (customer_id, rental_date);
```

This index supports:
- `WHERE customer_id = 5` ✅ (leftmost column)
- `WHERE customer_id = 5 AND rental_date > '2023-01-01'` ✅ (both columns)
- `WHERE rental_date > '2023-01-01'` ❌ (skips leftmost column — can't use index)

**The rule:** put the most selective column first, or the column you always filter on. Think of it like a phone book — sorted by last name, then first name. You can look up "Smith" fast, but you can't look up all "Johns" without scanning everything.

## GIN Index — For JSONB, Arrays, and Full-text

```sql
CREATE INDEX idx_film_fulltext ON film USING gin(fulltext);
```

GIN (Generalized Inverted Index) is designed for values that contain multiple elements — arrays, JSONB documents, tsvector columns. It inverts the mapping: instead of "row → values", it stores "value → rows."

**When to use:** JSONB queries with `@>`, `?`, `?|`; array containment with `@>`; full-text search with `@@`.

**Trade-off:** GIN indexes are slower to build and update than B-tree, but dramatically faster for containment queries.

## BRIN Index — For Naturally Ordered Data

```sql
CREATE INDEX idx_payment_date ON payment USING brin(payment_date);
```

BRIN (Block Range Index) stores min/max values per block of pages. Tiny index, huge table. Works only if the data's physical order correlates with the column values — like timestamps in an append-only table.

**When to use:** time-series data, log tables, anything inserted in order and rarely updated.

## EXPLAIN ANALYZE — Your Most Important Tool

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT ...;
```

Read the output bottom-up. Look for:
- **Seq Scan** — no index hit, reading every row
- **Index Scan** — using an index, then fetching heap rows
- **Index Only Scan** — answering entirely from the index (best case)
- **Bitmap Index Scan** — combining multiple index results before heap access
- **Buffers: shared hit** vs **shared read** — cache hits vs disk reads

## What Interviewers Look For

They want you to connect index choice to query patterns, not just list index types. "I'd add a partial B-tree index on the FK column filtered by status because 95% of queries hit active records" is a great answer. "I'd add a GIN index" without explaining the access pattern is not.
