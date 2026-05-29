# Week 5: Schema Migrations That Don't Break Prod

## The Core Problem

In production, your database is never asleep. Users are querying and writing at all times. A schema change that locks a table — even for seconds — can cascade into timeouts, connection pool exhaustion, and downtime.

The skill isn't writing `ALTER TABLE`. It's knowing which ALTER TABLE operations are safe and which ones will page you at 2am.

## What Locks a Table (and What Doesn't)

**Safe (no lock or very brief lock):**
- `ADD COLUMN` with no default → instant, just updates the catalog
- `ADD COLUMN ... DEFAULT x` → instant in Postgres 11+ (stores default in catalog, doesn't rewrite rows)
- `DROP COLUMN` → instant (marks column as invisible, doesn't reclaim space)
- `CREATE INDEX CONCURRENTLY` → builds index without blocking writes

**Dangerous (takes an ACCESS EXCLUSIVE lock):**
- `ALTER COLUMN ... TYPE` → rewrites every row in the table
- `ADD COLUMN ... DEFAULT x` on Postgres 10 or below → rewrites every row
- `CREATE INDEX` (without CONCURRENTLY) → blocks all writes until done
- `ALTER TABLE ... RENAME COLUMN` → brief lock but breaks applications reading the old name
- `NOT NULL` constraint on existing column → full table scan to verify

## The Expand/Contract Pattern

The safest way to make a breaking schema change. Three phases:

**1. Expand** — add the new structure alongside the old one
```
Add new column → backfill data → add indexes
(Old code still works, reads/writes old column)
```

**2. Migrate** — update application code to use new structure
```
Deploy code that writes to BOTH columns
Then deploy code that reads from new column
```

**3. Contract** — remove the old structure
```
Stop writing to old column → drop old column
(Only after confirming no code reads it)
```

This pattern is slow (3 deploys minimum) but safe. Each step is independently reversible.

## Backfilling Without Locking

Never update millions of rows in a single statement:

```sql
-- BAD: locks the table for the entire update
UPDATE film SET new_column = old_column;

-- GOOD: batch in chunks
UPDATE film SET new_column = old_column
WHERE film_id BETWEEN 1 AND 1000 AND new_column IS NULL;
-- Repeat for next batch...
```

Batching lets other transactions proceed between chunks. Use a loop in your migration script with `pg_sleep(0.1)` between batches to give the system breathing room.

## CREATE INDEX CONCURRENTLY

Regular `CREATE INDEX` takes a write lock on the table — no inserts or updates until it's done. On a 100M-row table, this could be minutes.

`CREATE INDEX CONCURRENTLY` builds the index in the background. It's slower overall but doesn't block writes. The catch: it scans the table twice and can fail (leaving an INVALID index you need to drop and retry).

**Always check after:**
```sql
SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'your_index';
-- If it's not there, check for invalid indexes:
SELECT * FROM pg_class WHERE relkind = 'i' AND relname = 'your_index';
```

## Migration Tools

Your repo mentions `golang-migrate` and `pgroll`:
- **golang-migrate**: file-based, runs UP/DOWN SQL scripts in order. Simple, explicit.
- **pgroll**: designed specifically for zero-downtime Postgres migrations. Manages the expand/contract lifecycle automatically.

## What Interviewers Look For

They want to hear that you understand ALTER TABLE isn't just a command — it's an operation with locking implications. "I'd add the column, backfill in batches, then add the NOT NULL constraint" shows you've dealt with real production databases. Bonus points for mentioning the expand/contract pattern by name.
