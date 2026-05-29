# Week 5 Solutions

## Exercise 1: Lock Behavior

| Operation | Blocks? | Why |
|-----------|---------|-----|
| ADD COLUMN (no default) | Briefly (AccessExclusive, but instant) | Only updates system catalog |
| ADD COLUMN (with default, PG11+) | Briefly | Default stored in catalog, no row rewrite |
| CREATE INDEX | Yes, blocks writes | Takes ShareLock, waits for existing transactions |
| CREATE INDEX CONCURRENTLY | No | Builds in background, two passes |
| ALTER COLUMN TYPE | Yes, blocks everything | Rewrites every row, AccessExclusive lock |

**Key insight:** the operations that rewrite rows are the dangerous ones. Catalog-only changes are safe.

---

## Exercise 2: Expand/Contract

The pattern works in three deploys:
1. **Deploy 1:** Add `name` column + backfill + trigger → old code works, new column fills silently
2. **Deploy 2:** Update code to read from `name` instead of `title`
3. **Deploy 3:** Drop `title` column + trigger

The dual-write trigger ensures no data is lost between deploys. This is standard practice at companies like GitHub, Shopify, and Stripe for any breaking schema change.

**Interview talking point:** "I'd never rename a column in place. The expand/contract pattern takes three deploys but each step is independently reversible. The total wall-clock time is longer, but the risk of downtime is zero."

---

## Exercise 3: Batched Backfill

**Typical results:**

| Approach | Total Time | Lock Duration |
|----------|-----------|---------------|
| Single UPDATE | ~200ms (faster overall) | Locks entire table for the full duration |
| Batched (2000 rows/batch) | ~500ms–1s (slower overall) | Locks only current batch, releases between |

The single statement is faster in total wall-clock time, but it holds a lock on all affected rows for the entire duration. On a table with 10M+ rows, that could be minutes — blocking all other writes.

The batched approach is slower overall but **never blocks other queries for more than the time to process one batch** (~50ms). In production, this is always the right choice for large tables.

---

## Exercise 4: NOT NULL Safely

1. `ADD CONSTRAINT ... NOT VALID` → instant, no table scan. It only applies to future rows.
2. `VALIDATE CONSTRAINT` → scans the table but uses a weaker lock (ShareUpdateExclusiveLock) that doesn't block writes.
3. `SET NOT NULL` → with the validated CHECK constraint already in place, Postgres knows all rows pass and skips the full scan.

**Without this pattern:** `SET NOT NULL` alone takes an AccessExclusive lock and scans every row. On a large table, this blocks all reads and writes during the scan.

---

## Exercise 5: Failed CONCURRENTLY Recovery

If `CREATE INDEX CONCURRENTLY` fails or is cancelled:
- The index exists but is marked INVALID
- Postgres will not use it for queries
- You must `DROP INDEX idx_name` and rebuild

**Always check after CONCURRENTLY:**
```sql
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'rental';
-- Cross-reference with:
SELECT c.relname, i.indisvalid FROM pg_class c
JOIN pg_index i ON c.oid = i.indexrelid
WHERE NOT i.indisvalid;
```

**Pro tip:** in migration scripts, wrap CONCURRENTLY builds with a check-and-retry pattern.

---

## Week 5 Interview Flash Card

**Q: How would you add a NOT NULL column to a 50M-row table in production?**

"I'd use the expand/contract pattern. First, ADD COLUMN with a nullable default — that's instant in Postgres 11+. Then backfill in batches of 5,000-10,000 rows with a sleep between batches so I don't saturate the connection pool. Once backfilled, I'd add a CHECK constraint with NOT VALID, then VALIDATE it separately — this avoids an AccessExclusive lock. Finally, SET NOT NULL, which Postgres can do instantly because the CHECK constraint already guarantees no nulls exist. Total: zero downtime, three or four migration steps."
