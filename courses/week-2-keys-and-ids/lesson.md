# Week 2: Keys & IDs — SERIAL vs UUID vs ULID

## Introduction

Every table needs a **primary key** — a column that uniquely identifies each row (Week 1 introduced this). The question this week: *what should that key actually be?*

The lazy answer is "just use an auto-incrementing number." Often that's right. But the choice quietly affects **write performance, security, and whether your system can scale across many servers.**

The one idea to walk away with: **pick the smallest, most sequential key that still meets your security and distribution needs — because the key's shape decides how fast inserts stay as the table grows.**

Pagila uses auto-incrementing integers everywhere (`actor_id`, `film_id`, `customer_id`, `rental_id`, `payment_id`), so we'll start there and ask what would change if we picked something else.

---

## Key Concepts

### Primary key

The column that uniquely identifies a row. PostgreSQL automatically builds a **B-tree index** on it (see below) so lookups by id are fast.

### B-tree index (you must picture this)

A B-tree is a sorted, balanced tree PostgreSQL uses to find rows quickly. The crucial fact for this week: **it stays cheap when new values arrive in increasing order** (they all land at the "right edge," touching the same few pages), and **gets expensive when new values are random** (every insert lands in a different spot). Hold that picture — it explains everything below.

### The three contenders

- **SERIAL / BIGSERIAL** — auto-incrementing integer (`1, 2, 3, …`). `SERIAL` is 4 bytes, `BIGSERIAL` is 8.
- **UUID v4** — a 16-byte random value like `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`.
- **ULID** — a 16-byte value whose first part is a timestamp, so it sorts by creation time: `01ARZ3NDEKTSV4RRFFQ69G5FAV`.

> **Note on Pagila:** `actor_id integer DEFAULT nextval('actor_actor_id_seq')` *is* the SERIAL pattern — an integer column fed by a sequence. `SERIAL` is just shorthand for exactly that.

---

## Deep Dive: Choosing the Key

### SERIAL / BIGSERIAL (auto-increment integer)

```sql
CREATE TABLE example (id BIGSERIAL PRIMARY KEY);  -- 1, 2, 3, 4, ...
```

**Pros:** small (4 or 8 bytes), fast inserts, excellent B-tree locality (values always land at the right edge), human-readable for debugging.

**Cons:**
- **Predictable** — `customer_id=5` means an attacker can guess `4` and `6`. If you expose these in URLs, you leak.
- **Leaks business info** — `rental_id=16044` tells a competitor roughly how many rentals you've ever had.
- **Bad for distributed writes** — two database nodes can't both hand out "the next number" without coordinating.

> Use `BIGSERIAL` (8 bytes), not `SERIAL` (4 bytes), for anything that might grow. A 4-byte int caps at ~2.1 billion; busy tables like `payment` or `rental` can blow past that, and changing the type later is a painful migration.

### UUID v4 (random)

```sql
CREATE TABLE example (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
```

**Pros:** globally unique with **no coordination** (any node, any service can generate one safely), reveals nothing about volume or order.

**Cons:** 16 bytes (2× a bigint, and that cost repeats in every index and every FK that references it), not human-friendly, and — the big one — **random order destroys B-tree insert performance.**

### ULID (time-sortable, 16 bytes)

```
01ARZ3NDEKTSV4RRFFQ69G5FAV
|--------||---------------|
 time       randomness
```

**Pros:** globally unique like UUID, but the timestamp prefix means new values still land near the right edge of the B-tree — you keep most of UUID's benefits **without** wrecking insert locality. Bonus: rows naturally sort by creation time.

**Cons:** needs an extension or app-level generation (not built into core Postgres), still 16 bytes.

### The B-tree problem with random UUIDs (the key insight)

This is what interviewers are really probing. Because a B-tree is sorted:

- **Sequential keys (SERIAL/ULID):** every new row lands at the right edge, reusing the same hot pages already in memory. Cheap.
- **Random keys (UUID v4):** every new row lands in a random page. That page may not be in memory (**cache miss → disk read**), and filling already-full pages forces **page splits**, which fragment the index (**bloat**). Over time, writes amplify and the index swells.

At ~1M rows this becomes measurable; at 100M+ it's painful. *This* is why "just use a UUID for everything" is a trap on high-write tables.

### When to use each

| Use case | Recommended | Why |
|----------|-------------|-----|
| Internal service, single DB | BIGSERIAL | Simple, fast, smallest |
| Public-facing / API IDs | UUID or ULID | Don't expose counts or let people enumerate |
| Distributed / multi-region writes | UUID or ULID | No coordination needed |
| Time-series / event data | ULID | Natural creation-time sort |
| Very high write rate (>10k inserts/sec) | BIGSERIAL or ULID | Random UUID kills the B-tree |

A common hybrid: keep a `BIGSERIAL` primary key internally (fast joins, small FKs) **and** add a separate UUID column for the public-facing id. Best of both.

---

## Interview Tips

The choice isn't about uniqueness — all three are unique. It's about **index performance and system architecture.**

- The strongest answer connects the id choice to the **B-tree**: *"Random UUIDs scatter inserts, causing page splits and cache misses — write amplification. SERIAL or ULID keep inserts at the right edge."*
- Mention the **security/enumeration** angle for anything user-facing.
- Mention **distribution**: sequences don't coordinate across nodes, so multi-region writes push you toward UUID/ULID.
- **Green flag:** the hybrid (`BIGSERIAL` PK + external UUID), and "I'd default to `BIGSERIAL` and only reach for UUID/ULID when I'm exposing ids publicly or writing from multiple nodes."
