# Week 2 Solutions

## Exercise 1: Pagila's Current Keys

**Findings:** All Pagila PKs use `integer` (SERIAL). This is typical for older schemas and works fine for a single-database app.

**Security implications:**
- `SELECT max(customer_id) FROM customer;` → ~599. An attacker now knows roughly how many customers you have.
- `SELECT max(payment_id) FROM payment;` → ~16,049. Same problem.
- Sequential IDs also allow enumeration: try `/api/customers/1`, `/api/customers/2`, etc.

**Interview talking point:** "Sequential IDs are fine internally but shouldn't be exposed in public APIs without authorization checks. The real fix isn't obscuring IDs — it's proper access control. But UUIDs add defense in depth."

---

## Exercise 2: Three Table Versions

All three tables created as specified. The key observation is at insert and query time (Exercises 3–5).

---

## Exercise 3: Bulk Insert Benchmark

**Typical results on local Docker (500k rows):**

| Table | Insert Time |
|-------|------------|
| orders_serial | ~1.5–2.5s |
| orders_uuid | ~2.5–4.0s |

UUID inserts are typically **40–80% slower**. Why:

- SERIAL appends to the end of the B-tree → hot page stays in cache
- UUID v4 is random → inserts scatter across the entire index → constant page splits and cache misses
- At 500k rows the difference is noticeable; at 50M it's painful

---

## Exercise 4: Index Size Comparison

**Typical results:**

| Table | Table Size | Index Size |
|-------|-----------|------------|
| orders_serial | ~27 MB | ~11 MB |
| orders_uuid | ~37 MB | ~20 MB |

UUID indexes are roughly **1.5–2x larger** because:
- UUID is 16 bytes vs 4 bytes for integer
- Random distribution causes more page splits → lower leaf density → more pages needed

**pgstatindex results:**
- SERIAL `avg_leaf_density`: ~85–90% (tight, sequential)
- UUID `avg_leaf_density`: ~65–75% (fragmented, random)

---

## Exercise 5: Range Query Performance

**SERIAL range query:**
```sql
EXPLAIN ANALYZE SELECT * FROM orders_serial WHERE id > 499900 ORDER BY id LIMIT 100;
-- Index Scan on orders_serial_pkey
-- Execution time: < 1ms
-- The B-tree walks to 499900 and reads forward. Sequential locality makes this trivial.
```

**UUID "range" query:**
```sql
EXPLAIN ANALYZE SELECT * FROM orders_uuid ORDER BY id LIMIT 100;
-- Index Scan on orders_uuid_pkey
-- Execution time: ~1-2ms
-- Works, but you can't do "next page after this UUID" without storing the last seen value
```

**Pagination with UUIDs:** You can't do `WHERE id > :last_id` meaningfully since UUID order is random. Workarounds:
- Cursor-based pagination using `created_at` + `id` as a tiebreaker
- Keyset pagination on a secondary sequential column
- This is exactly where ULIDs help — time-prefixed means ORDER BY id = ORDER BY creation time

---

## Exercise 6: Security Discussion

**When ID enumeration actually matters:**
- Multi-tenant systems where guessing another tenant's resource ID bypasses isolation
- APIs without proper authorization checks (the real bug)
- Any system where the ID is the only access control

**When it's security theater:**
- You have proper row-level security or authorization middleware
- The resource is public anyway
- Internal service-to-service calls behind a VPN

**The balanced answer:** "UUIDs aren't a security mechanism — they're defense in depth. The real protection is authorization. But in a system where a developer might forget an auth check on one endpoint, non-enumerable IDs reduce the blast radius."

---

## Week 2 Interview Flash Card

**Q: Why not just use UUIDs everywhere?**

"Random UUIDs have a real performance cost in Postgres. B-tree indexes are optimised for sequential inserts — random UUIDs cause page splits and cache misses that get worse as the table grows. I measured this directly: UUID indexes were almost 2x larger and inserts were 40-80% slower at 500k rows. For internal tables, BIGSERIAL is simpler and faster. For public-facing IDs or distributed systems, I'd use ULIDs — they give you global uniqueness and time-sortability with much better B-tree locality than random UUIDs."
