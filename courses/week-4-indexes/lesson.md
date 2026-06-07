# Week 4: Indexes — The Other Half of Your Schema

## Introduction

A well-designed schema (Weeks 1–3) still runs slowly if Postgres has to read every row to answer a query. An **index** is a separate, sorted lookup structure that lets Postgres jump straight to the rows it needs — like the index at the back of a book instead of reading every page.

The catch: every index speeds up reads but **slows down writes** (each insert/update must also update the index) and **uses storage.**

The one idea to walk away with: **the skill isn't memorising index types — it's matching the right index to a real query (access pattern), and proving it helped with `EXPLAIN ANALYZE`.**

---

## Key Concepts

### Sequential scan vs index scan

- **Sequential scan (Seq Scan):** Postgres reads the whole table. Fine for tiny tables; deadly for big ones.
- **Index scan:** Postgres uses the index to find matching rows directly, then fetches them.

A table with no useful index does a Seq Scan on every query that filters it.

### Selectivity

How much a condition narrows the results. `WHERE return_date IS NULL` (a few percent of rentals) is **highly selective** — perfect for an index. `WHERE active = true` when 99% of rows are active is **not** selective — Postgres may ignore the index and scan anyway.

### The cost model

Indexes trade write cost for read speed. Five indexes on a table means every insert does six writes (the row + five indexes). Add indexes your queries actually use — not "just in case."

---

## Deep Dive: The Index Types That Matter

### B-tree — the default (90% of your indexes)

Postgres builds a B-tree unless you ask otherwise. It handles equality (`=`), ranges (`>`, `<`, `BETWEEN`), sorting (`ORDER BY`), and prefix matches (`LIKE 'abc%'`).

```sql
CREATE INDEX idx_rental_customer ON rental (customer_id);
```

It's a balanced sorted tree whose leaves point to the table rows. Sequential values cluster together — which is exactly why `SERIAL` keys index beautifully and random UUIDs don't (Week 2 callback). **Almost always your first choice.**

### Partial index — index only the rows you query

```sql
CREATE INDEX idx_active_rentals ON rental (customer_id)
WHERE return_date IS NULL;
```

In Pagila, unreturned rentals (`return_date IS NULL`) are a small slice of the table. This index covers only those rows, so it's tiny, and queries with `WHERE return_date IS NULL` hit it directly.

**Use when:** you frequently query a small, well-defined subset — active orders, unprocessed jobs, recent records.

### Composite index — column order is everything

```sql
CREATE INDEX idx_rental_lookup ON rental (customer_id, rental_date);
```

This one index supports:
- `WHERE customer_id = 5` ✅ (leftmost column)
- `WHERE customer_id = 5 AND rental_date > '2022-01-01'` ✅ (both)
- `WHERE rental_date > '2022-01-01'` ❌ (skips the leftmost column → can't use it)

**The phone-book rule:** a book sorted by last name, then first name lets you find "Smith, John" fast — but is useless for finding every "John." Put the column you always filter on (usually the most selective) first.

### GIN index — for JSONB, arrays, and full-text

```sql
CREATE INDEX idx_film_fulltext ON film USING gin (fulltext);
```

Pagila's `film.fulltext` is a `tsvector` (search document). GIN (Generalized **In**verted Index) is built for values that contain *many* elements — arrays, JSONB, full-text. It stores "value → rows" instead of "row → values."

**Use when:** full-text search (`@@`), JSONB containment (`@>`), key existence (`?`), array containment (`@>`). (This powers Week 6's JSONB queries.)

**Trade-off:** slower to build and update than B-tree, but dramatically faster for these containment searches.

### BRIN index — tiny index for naturally-ordered data

```sql
CREATE INDEX idx_payment_date ON payment USING brin (payment_date);
```

BRIN (Block Range Index) stores just the min/max value per *block* of pages. Microscopic index, enormous table. It only works when the data's **physical order matches the column** — e.g. `payment_date` in an append-only table where rows are inserted in time order.

**Use when:** time-series, logs, append-only tables that are rarely updated.

### EXPLAIN ANALYZE — your most important tool

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM rental WHERE customer_id = 5;
```

Read it bottom-up and look for:
- **Seq Scan** — no index used, reading every row (red flag on big tables)
- **Index Scan** — used an index, then fetched rows
- **Index Only Scan** — answered entirely from the index (best case)
- **Bitmap Index Scan** — combined multiple indexes before touching the table
- **Buffers: shared hit vs read** — cache hits vs disk reads

Run it *before and after* adding an index to prove the change actually helped.

---

## Interview Tips

Connect index choice to a **query pattern**, never just list types.

- Strong: *"95% of queries hit active records, so I'd add a partial B-tree on the FK column filtered by status — small index, exact match for the access pattern."*
- Weak: *"I'd add a GIN index"* with no mention of what's being queried.
- Show the workflow: **look at the slow query → `EXPLAIN ANALYZE` → pick an index that matches the filter/sort → re-run to confirm.**
- Bonus links: composite column order (this week) and the FK-column index that fixes N+1 (Week 3), B-tree locality and key choice (Week 2).
