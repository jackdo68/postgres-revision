# Week 2: Keys & IDs — SERIAL vs UUID vs ULID

## The Core Decision

Every table needs a primary key. The choice seems trivial — just use `SERIAL` right? But at scale, this decision affects index performance, security, distributed systems, and even debugging.

## The Three Contenders

### SERIAL / BIGSERIAL (Auto-increment Integer)

```sql
CREATE TABLE example (id SERIAL PRIMARY KEY);
-- Generates: 1, 2, 3, 4, 5...
```

**Pros:** Small (4 or 8 bytes), fast inserts, great B-tree locality, human-readable.
**Cons:** Predictable (attackers can enumerate), bad for distributed systems (sequences don't coordinate across nodes), leaks business info (id=50000 tells you the table has ~50k rows).

### UUID v4 (Random)

```sql
CREATE TABLE example (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
-- Generates: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
```

**Pros:** Globally unique, no coordination needed, doesn't leak info.
**Cons:** 16 bytes (2x bigint), random distribution kills B-tree insert performance (page splits everywhere), hard to sort by creation time, not human-friendly.

### ULID (Universally Unique Lexicographically Sortable Identifier)

```
-- 01ARZ3NDEKTSV4RRFFQ69G5FAV
-- |-------||----------------|
--  time      randomness
```

**Pros:** Sortable by creation time, globally unique, better B-tree locality than UUID (time prefix clusters recent inserts), 128 bits like UUID.
**Cons:** Requires an extension or app-level generation, less native Postgres support, still 16 bytes.

## The B-tree Problem with Random UUIDs

This is the key insight interviewers want. B-tree indexes are optimised for sequential inserts — new values go at the end of the tree, hitting the same few pages. Random UUIDs scatter inserts across the entire tree, causing:

- **Page splits:** the index constantly reorganizes
- **Cache misses:** new inserts hit cold pages instead of hot ones
- **Index bloat:** fragmentation grows over time

At 1M+ rows, this becomes measurable. At 100M+, it's painful.

## When to Use Each

| Use Case | Recommended | Why |
|----------|------------|-----|
| Internal service, single DB | BIGSERIAL | Simple, fast, sufficient |
| Public-facing API IDs | UUID or ULID | Don't expose internals |
| Distributed / multi-region | UUID or ULID | No coordination needed |
| Time-series or event data | ULID | Natural sort order |
| High-write table (>10k inserts/sec) | BIGSERIAL or ULID | UUID kills B-tree |

## What Interviewers Look For

They want you to know that the choice isn't just about uniqueness — it's about index performance and system architecture. The strongest answer connects the ID choice to the B-tree structure and explains the write amplification problem with random UUIDs.
