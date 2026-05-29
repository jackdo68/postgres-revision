# Week 6: JSONB & When Postgres Isn't Enough

## The Core Decision

Postgres gives you JSONB — a binary, indexable JSON column type. It lets you store semi-structured data alongside your relational tables. The question is: when is this a good idea vs. when are you just avoiding proper schema design?

## JSONB vs JSON vs TEXT

- **TEXT**: stores raw JSON as a string. No validation, no operators, no indexing. Useless.
- **JSON**: validates JSON on insert, but stores as text. Can't index. Rarely useful.
- **JSONB**: binary format. Validates, indexes (with GIN), supports operators. This is what you want.

## JSONB Operators You Need to Know

```sql
-- Access a key (returns JSONB)
SELECT metadata -> 'tags' FROM film;

-- Access a key as text
SELECT metadata ->> 'rating_source' FROM film;

-- Containment (does the JSONB contain this sub-object?)
SELECT * FROM film WHERE metadata @> '{"rating_source": "imdb"}';

-- Key existence
SELECT * FROM film WHERE metadata ? 'tags';

-- Nested access
SELECT metadata -> 'scores' -> 'imdb' FROM film;
```

The `@>` containment operator is the most important — it's the one that GIN indexes accelerate.

## When JSONB Is the Right Call

1. **User-defined attributes** — every customer wants different fields. A clothing store tracks sizes; a bookstore tracks ISBN. JSONB lets each row have different keys without schema changes.

2. **Event payloads / audit logs** — the payload structure varies by event type. Forcing 50 event types into one normalised schema is worse than storing the payload as JSONB.

3. **API response caching** — you store third-party API responses that you query occasionally but don't need to index every field.

4. **Prototyping** — you don't know the schema yet. JSONB lets you iterate fast. Promote heavily-queried fields to proper columns later.

## When JSONB Is a Trap

1. **You know the schema** — if every row has the same keys, use proper columns. You get type checking, NOT NULL constraints, better query plans, and smaller storage.

2. **You need relational queries** — JOINing on JSONB values is painful and slow. If you need `WHERE metadata->>'author_id' = '5'`, that should be a foreign key column.

3. **Nested writes** — updating a single key inside JSONB rewrites the entire JSONB value. For frequently updated fields, this is wasteful.

4. **You're hiding schema decisions** — "just throw it in JSONB" is often a sign of avoiding the hard work of modelling your data properly.

## The Hybrid Pattern

The best schemas often mix both:

```
film
├── film_id (SERIAL PK)
├── title (TEXT — always present, always queried)
├── release_year (INT — always present, type-checked)
├── rental_rate (NUMERIC — always present, used in calculations)
└── metadata (JSONB — varies by film source: Netflix metadata vs DVD metadata)
```

Typed columns for structured, always-present, frequently-queried data. JSONB for extensible, varies-by-context, rarely-joined data.

## DynamoDB vs Postgres: The Access Pattern Question

DynamoDB forces you to design around access patterns from day one. There's no "add an index later" escape hatch — your partition key and sort key determine everything.

Postgres lets you defer that decision. You can normalise first, add indexes as needed, and restructure with migrations. This flexibility is powerful but can lead to lazy schema design.

**The lesson from DynamoDB that applies to Postgres:** think about your query patterns BEFORE you design your tables, not after.

## What Interviewers Look For

They want you to articulate the boundary between "JSONB is the right tool" and "JSONB is avoiding schema design." The strongest answer gives a concrete example of each and explains the criteria you'd use to decide: frequency of schema changes, query patterns, need for referential integrity, and whether the data has a stable shape.
