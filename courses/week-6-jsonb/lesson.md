# Week 6: JSONB & When Postgres Isn't Enough

## Introduction

Everything so far assumed **structured** data: fixed columns with fixed types. But sometimes the shape of your data varies row to row, or you don't know it yet. PostgreSQL's **JSONB** column lets you store flexible, semi-structured documents *inside* a relational table — a bit of NoSQL living in your SQL database.

The one idea to walk away with: **JSONB is the right tool when the shape genuinely varies or is unknown; it's a trap when you're using it to dodge proper schema design for data that has a stable shape.**

> **Heads-up on the examples:** Pagila's `film` table has **no** `metadata` column by default. You add one in **Exercise 1** with `ALTER TABLE film ADD COLUMN metadata JSONB`. The examples below assume you've run that. (Pagila *does* ship two semi-structured columns natively: `special_features text[]`, an array, and `fulltext tsvector`, a search document — but no JSONB.)

---

## Key Concepts

### Semi-structured data

Data without one fixed set of columns — every row might carry different keys. A film sourced from Netflix might record streaming metadata; a DVD might record disc features. Forcing both into the same rigid columns is awkward.

### TEXT vs JSON vs JSONB

- **TEXT** — raw JSON as a string. No validation, no operators, no indexing. Useless for querying.
- **JSON** — validates on insert but stores as text; can't be indexed efficiently. Rarely the right pick.
- **JSONB** — **b**inary format: validates, stores compactly, supports operators, and is **indexable with GIN**. This is the one you want.

### GIN index (recall from Week 4)

The index type that makes JSONB containment queries fast. Without it, a JSONB filter scans every row.

---

## Deep Dive: Using JSONB Well

### The operators you need

After Exercise 1, each `film.metadata` looks like `{"source": "netflix", "tags": [...], "scores": {"imdb": 8.1}, "available_regions": ["US","CA"]}`. The operators:

```sql
-- ->   get a key as JSONB        |  ->>  get a key as text
SELECT metadata -> 'scores'  FROM film;     -- {"imdb": 8.1}
SELECT metadata ->> 'source' FROM film;     -- netflix  (text)

-- nested access
SELECT metadata -> 'scores' ->> 'imdb' FROM film;   -- 8.1

-- @>  containment: does the JSONB contain this sub-object?
SELECT * FROM film WHERE metadata @> '{"source": "netflix"}';

-- ?   key / array-element existence
SELECT * FROM film WHERE metadata -> 'available_regions' ? 'AU';
```

`@>` (**containment**) is the most important — it's the operator a **GIN index accelerates**:

```sql
CREATE INDEX idx_film_metadata ON film USING gin (metadata);
-- now `WHERE metadata @> '{"source":"netflix"}'` uses the index
```

### When JSONB is the right call

1. **User-defined attributes** — every tenant wants different fields (a clothing store tracks sizes; a bookstore tracks ISBN). JSONB lets each row carry different keys without schema changes.
2. **Event payloads / audit logs** — the payload differs by event type; cramming 50 event types into one normalised schema is worse.
3. **Third-party API responses** — store the blob you query occasionally but don't need to index field-by-field.
4. **Prototyping** — you don't know the schema yet; iterate in JSONB, then promote the fields you query a lot into real columns.

### When JSONB is a trap

1. **You already know the shape** — if every row has the same keys, use real columns: type checking, `NOT NULL`, better plans, smaller storage.
2. **You need relational queries** — joining on a JSONB value is slow and awkward. If you keep writing `WHERE metadata->>'author_id' = '5'`, that should be a real FK column (Week 3).
3. **Frequent single-key updates** — updating one key **rewrites the entire JSONB value**. Wasteful for hot fields.
4. **You're hiding a modelling decision** — "just throw it in JSONB" is often avoidance of the real schema work.

### The hybrid pattern (the usual winner)

Mix both: typed columns for the stable, always-queried data; JSONB for the variable extras.

```
film
├── film_id       (PK)        -- structured, always present
├── title         (TEXT)      -- structured, always queried
├── release_year  (year)      -- structured, type-checked
├── rental_rate   (NUMERIC)   -- structured, used in calculations
└── metadata      (JSONB)     -- varies by source: Netflix vs DVD extras
```

That's exactly what Exercise 1 builds — Pagila's normalised `film` columns plus one JSONB escape hatch.

### A lesson from DynamoDB

DynamoDB forces you to design around **access patterns** on day one — your partition/sort keys decide everything, with no "add an index later." Postgres lets you defer: normalise first, add indexes as needed, restructure with migrations (Week 5). That flexibility is powerful but can excuse lazy design. The borrowed discipline: **think about how you'll query the data before you choose JSONB vs columns** — not after.

---

## Interview Tips

They're probing the boundary between *"JSONB is the right tool"* and *"JSONB is avoiding schema design."*

- Give a concrete example of **each** side: variable per-tenant attributes (good) vs a stable shape you should have modelled as columns (bad).
- State your decision criteria out loud: **frequency of schema change, query patterns, need for referential integrity, and whether the shape is stable.**
- Green flag: recommending the **hybrid** — typed columns for stable/queried fields, JSONB for the genuinely variable rest — and mentioning the **GIN index** for `@>` queries.
