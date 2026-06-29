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

### Unique vs non-unique — uniqueness is optional

An index does **not** require unique values per row. By default an index happily stores duplicates (`CREATE INDEX idx_film_language ON film (language_id)` — hundreds of films share each `language_id`). Uniqueness is an *extra* property you opt into with `CREATE UNIQUE INDEX` or a `UNIQUE` constraint. A **primary key** is the strict case: unique **and** not-null, used as row identity. So unlike a primary key, a plain index can have repeated values — indexing is about *speed*, uniqueness is about *correctness*.

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

Pagila's `film.fulltext` is a `tsvector` (search document). GIN (Generalized **In**verted Index) is built for columns that hold **many values per row** — arrays, JSONB, full-text.

**The mental model is the index at the back of a book.** A B-tree is *forward* (row → its value), which is perfect when each row has one value. But how do you index a film whose `fulltext` holds many words? GIN **inverts** it to *value → list of rows*:

```
forward (how the row stores it):     inverted index (what GIN stores):
film 1 → {academy, dinosaur, epic}   academy  → [film 1, film 3]
film 2 → {drama, dinosaur}           dinosaur → [film 1, film 2]
film 3 → {academy, love}             drama    → [film 2]   ...
```

Now *"which films contain `dinosaur`?"* is a single lookup → `[film 1, film 2]` — just like flipping to a book's index instead of reading every page. GIN **explodes** each row's collection into one entry per element (a film with 8 words makes up to 8 entries, all pointing back to that film); a B-tree can't, because it treats the whole `tsvector`/array as one opaque value.

**Use when:** the question is "does this row's collection *contain* X?" — full-text search (`@@`), JSONB containment (`@>`), key existence (`?`), array containment (`@>`). (This powers Week 6's JSONB queries.)

**Trade-off:** slower writes (one row can add many entries to maintain — softened by the `fastupdate` pending list), and it only does "contains"-style lookups (no `ORDER BY` or `> ` ranges — that's B-tree). In return it's dramatically faster for containment searches.

#### What `fulltext` actually holds — the `tsvector`

`fulltext` isn't the raw text; it's a `tsvector` — the document reduced to a sorted list of **lexemes** (normalised word-roots), each with its **positions**. Here's the real value for film 1:

```
TITLE:    ACADEMY DINOSAUR
DESC:     A Epic Drama of a Feminist And a Mad Scientist who must Battle a Teacher in The Canadian Rockies
FULLTEXT: 'academi':1 'battl':15 'canadian':20 'dinosaur':2 'drama':5 'epic':4
          'feminist':8 'mad':11 'must':14 'rocki':21 'scientist':12 'teacher':17
```

`to_tsvector('english', …)` does three things, all visible above:

1. **Lowercase + tokenise** — `ACADEMY` becomes part of `academi`.
2. **Drop stop-words** — noise like `a`, `of`, `and`, `the` is removed (that's why positions skip 3, 6, 7… — those were stop-words).
3. **Stem to a root lexeme** so word forms match — `Rockies → rocki`, `Battle → battl`.

You search it with a `tsquery` via the `@@` ("matches") operator. The query is normalised the **same** way, so forms don't need to match exactly:

```sql
-- 'rockies' stems to 'rocki', which is in film 1 → match
SELECT title FROM film WHERE fulltext @@ to_tsquery('english', 'rockies');

-- boolean ops: & and · | or · ! not · <-> followed-by (phrase)
WHERE fulltext @@ to_tsquery('english', 'mad & scientist')
WHERE fulltext @@ phraseto_tsquery('english', 'canadian rockies')  -- positions 20→21
```

Pagila **precomputes** this into `fulltext` and keeps it fresh with a trigger on `title` + `description`, so you index/search the stored column instead of re-parsing text each query. The positions also power relevance ranking via `ts_rank(fulltext, query)`. GIN then inverts these lexemes (`dinosaur → [film 1, film 2]`) to make `@@` an instant lookup.

### GiST index — for geospatial, ranges, and "is X near/overlapping Y?"

```sql
-- needs the PostGIS extension for spatial types
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE store_location (
    store_id int PRIMARY KEY,
    geom     geometry(Point, 4326)   -- a lon/lat point
);

CREATE INDEX idx_store_geom ON store_location USING gist (geom);
```

A B-tree only understands a single sorted line ("less than / greater than"), which works for numbers and text but **not** for 2-D data like map coordinates — there's no single way to sort points on a map. **GiST** (Generalized Search Tree) is the answer: instead of one sorted order, it groups values by *bounding boxes* in a tree, so it can answer "what's **near** here?" or "what **overlaps** this area?".

This is the index behind **PostGIS**, PostgreSQL's geospatial extension — easily one of the most popular reasons teams choose Postgres. It adds spatial types (`geometry`/`geography` — points, lines, polygons) and functions, and GiST makes their queries fast:

```sql
-- stores within 5 km of a point — uses the GiST index
SELECT store_id
FROM store_location
WHERE ST_DWithin(geom, ST_MakePoint(-73.99, 40.73)::geography, 5000);

-- nearest 5 stores (KNN) — GiST also accelerates "ORDER BY distance"
SELECT store_id
FROM store_location
ORDER BY geom <-> ST_MakePoint(-73.99, 40.73)::geometry
LIMIT 5;
```

**Use when:** geospatial / location data (the big one), plus range-type overlap (`tsrange`, `int4range` with `&&`) and "does this contain/overlap that?" queries that a B-tree can't express.

**Trade-off:** slower to build than B-tree and not for plain equality/sorting — but it's the *only* practical way to index 2-D spatial and overlap queries. (`geometry` = fast, flat-plane math; `geography` = slower but accurate on the curved earth, e.g. distances in metres.)

> Spatial types need `CREATE EXTENSION postgis` first (not installed in this repo's `devdb` by default). The concept is what matters here: **GiST is the index type for "near / overlapping / contains," with PostGIS as its headline use case.**

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
