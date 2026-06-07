# Week 5: Schema Migrations That Don't Break Prod

## Introduction

Weeks 1–4 were about *designing* a schema. This week is about *changing* one **while it's live**. In production the database never sleeps — users are reading and writing constantly. A schema change that locks a table for even a few seconds can snowball into request timeouts, an exhausted connection pool, and an outage.

The one idea to walk away with: **`ALTER TABLE` isn't just a command — it's an operation with locking consequences. The skill is knowing which changes are instant and which rewrite or lock the whole table, then sequencing risky changes so the table stays available.**

We'll use Pagila's `film` table for the examples.

---

## Key Concepts

### Lock

To stay consistent, Postgres takes **locks** during changes. Most everyday work uses light locks that let others keep working. The dangerous one is **`ACCESS EXCLUSIVE`**: it blocks *everything* — reads and writes — on that table until the operation finishes.

### Table rewrite

Some changes force Postgres to rewrite **every row** on disk. On a small table that's instant; on a 100M-row table it can take minutes — during which the table is locked.

### Blocking vs non-blocking

- **Blocking** — other queries wait (or time out) until your change completes.
- **Non-blocking** — your change runs alongside normal traffic (e.g. `CREATE INDEX CONCURRENTLY`).

---

## Deep Dive: Changing a Live Schema Safely

### What locks a table (and what doesn't)

**Safe — instant or very brief lock:**
- `ADD COLUMN` with no default → just updates the catalog
- `ADD COLUMN ... DEFAULT x` → instant on **Postgres 11+** (the default is stored in the catalog, rows aren't rewritten)
- `DROP COLUMN` → instant (marks the column invisible; space reclaimed later by vacuum)
- `CREATE INDEX CONCURRENTLY` → builds without blocking writes

**Dangerous — `ACCESS EXCLUSIVE` lock and/or full rewrite/scan:**
- `ALTER COLUMN ... TYPE` → rewrites every row
- `ADD COLUMN ... DEFAULT x` on **Postgres ≤ 10** → rewrites every row
- `CREATE INDEX` *without* `CONCURRENTLY` → blocks all writes until done
- `ADD CONSTRAINT ... NOT NULL` / check constraints → full table scan to verify existing rows
- `RENAME COLUMN` → brief lock, but instantly breaks any app still reading the old name

### The Expand / Contract pattern

The safe way to make a *breaking* change: never flip from old to new in one step. Do it in three reversible phases. Say we're replacing `film.rental_rate` with a new column.

**1. Expand** — add the new structure next to the old one.
```
ADD COLUMN new_rate → backfill it → add any index
(Old code keeps working; it still reads/writes rental_rate)
```

**2. Migrate** — move the application across.
```
Deploy code that writes BOTH columns
Then deploy code that reads the NEW column
```

**3. Contract** — remove the old structure, only once nothing reads it.
```
Stop writing rental_rate → DROP COLUMN rental_rate
```

It's slow (3 deploys) but each step is independently reversible, and the table is always usable.

### Backfilling without locking

Never rewrite millions of rows in one statement — it locks them all for the whole update:

```sql
-- BAD: one giant transaction, locks the table
UPDATE film SET new_rate = rental_rate;

-- GOOD: small batches, lets other transactions run in between
UPDATE film SET new_rate = rental_rate
WHERE film_id BETWEEN 1 AND 200 AND new_rate IS NULL;
-- repeat for the next range...
```

Loop the batches in your migration script with a short `pg_sleep(0.1)` between them to give the system breathing room. (Pagila's `film` is only 1000 rows, so batching is just for practice here — but the habit matters at scale.)

### CREATE INDEX CONCURRENTLY

Plain `CREATE INDEX` write-locks the table until it finishes — minutes on a huge table. `CREATE INDEX CONCURRENTLY` builds in the background without blocking writes. The catch: it's slower, scans the table twice, **can't run inside a transaction block**, and can fail — leaving an `INVALID` index you must drop and rebuild.

```sql
-- check it actually built
SELECT indexname FROM pg_indexes WHERE indexname = 'your_index';
-- if missing, look for an invalid leftover and drop it
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
```

### Migration tools

- **golang-migrate** (in this repo) — file-based UP/DOWN SQL scripts run in order. Simple and explicit; *you* are responsible for making each step safe.
- **pgroll** — purpose-built for zero-downtime Postgres migrations; automates the expand/contract lifecycle.

---

## Interview Tips

- Show you know `ALTER TABLE` has **locking implications**: *"I'd add the nullable column, backfill in batches, then add the `NOT NULL` constraint separately."*
- Name the **expand/contract** pattern explicitly — it signals real production experience.
- Mention `CREATE INDEX CONCURRENTLY` for adding indexes to a live table, and that it can leave an invalid index to clean up.
- Green flag: framing every change as "is this instant, a rewrite, or a lock?" before running it.
