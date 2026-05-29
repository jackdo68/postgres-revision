# Week 5 Exercises: Zero-Downtime Migrations

## Exercise 1: Identify Dangerous vs Safe Operations

**Task:** For each operation below, predict whether it will lock the table. Then test it.

Open TWO terminal sessions. In Session 1, start a long-running transaction:

```sql
-- Session 1: hold a lock on the film table
BEGIN;
SELECT * FROM film WHERE film_id = 1 FOR UPDATE;
-- Don't COMMIT yet — leave this open
```

In Session 2, try each operation and see if it blocks:

```sql
-- Session 2: try these one at a time

-- Test A: Add column with no default
ALTER TABLE film ADD COLUMN test_col_a TEXT;

-- Test B: Add column with default (Postgres 11+)
ALTER TABLE film ADD COLUMN test_col_b INT DEFAULT 0;

-- Test C: Create index (non-concurrent)
CREATE INDEX idx_test ON film(rental_rate);

-- Test D: Create index concurrently
CREATE INDEX CONCURRENTLY idx_test_conc ON film(rental_rate);

-- Test E: Change column type
ALTER TABLE film ALTER COLUMN description TYPE TEXT;
```

**For each test:**
1. Did Session 2 block (hang waiting for Session 1)?
2. If yes, for how long?
3. After testing each, ROLLBACK Session 1 and clean up

**Cleanup between tests:**
```sql
-- Session 1
ROLLBACK;
-- Clean up test columns/indexes
ALTER TABLE film DROP COLUMN IF EXISTS test_col_a;
ALTER TABLE film DROP COLUMN IF EXISTS test_col_b;
DROP INDEX IF EXISTS idx_test;
DROP INDEX IF EXISTS idx_test_conc;
```

---

## Exercise 2: The Expand/Contract Pattern

**Scenario:** You need to rename `film.title` to `film.name`. In production, you can't just rename it — existing code reads `title`.

**Step 1 — Expand: Add the new column**

```sql
-- Add the new column (safe — no rewrite)
ALTER TABLE film ADD COLUMN name TEXT;

-- Backfill in batches (simulate)
UPDATE film SET name = title WHERE film_id BETWEEN 1 AND 500;
UPDATE film SET name = title WHERE film_id BETWEEN 501 AND 1000;

-- Verify
SELECT film_id, title, name FROM film LIMIT 5;
```

**Step 2 — Dual-write trigger**

```sql
-- Create a trigger that keeps both columns in sync
CREATE OR REPLACE FUNCTION sync_film_name() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        IF NEW.name IS NULL THEN
            NEW.name = NEW.title;
        END IF;
        IF NEW.title IS NULL THEN
            NEW.title = NEW.name;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_film_name
BEFORE INSERT OR UPDATE ON film
FOR EACH ROW EXECUTE FUNCTION sync_film_name();

-- Test: update title, check name follows
UPDATE film SET title = 'TEST TITLE' WHERE film_id = 1;
SELECT film_id, title, name FROM film WHERE film_id = 1;
```

**Step 3 — Contract (only after all code uses `name`)**

```sql
-- In reality, you'd deploy code changes between these steps
-- For exercise: drop the old column
ALTER TABLE film DROP COLUMN title;
-- This would break Pagila's other views/functions, so DON'T actually do this.
-- Just understand the pattern.
```

**Rollback everything:**
```sql
UPDATE film SET title = name WHERE film_id = 1; -- fix the test row
UPDATE film SET title = (SELECT title FROM film f2 WHERE f2.film_id = film.film_id) WHERE film_id = 1;
-- Actually let's just reset:
DROP TRIGGER IF EXISTS trg_sync_film_name ON film;
DROP FUNCTION IF EXISTS sync_film_name();
ALTER TABLE film DROP COLUMN IF EXISTS name;
-- Restore the title we changed:
-- (If needed, reload pagila-data.sql for film_id=1)
```

---

## Exercise 3: Batched Backfill

**Task:** Simulate a large backfill with timing.

```sql
-- Add a column to populate
ALTER TABLE rental ADD COLUMN rental_year INT;

-- BAD: single update
\timing on
UPDATE rental SET rental_year = EXTRACT(YEAR FROM rental_date);
-- Record time: ___

-- Reset
UPDATE rental SET rental_year = NULL;

-- GOOD: batched update (simulate with ranges)
DO $$
DECLARE
    batch_start INT := 1;
    batch_size INT := 2000;
    max_id INT;
BEGIN
    SELECT max(rental_id) INTO max_id FROM rental;
    WHILE batch_start <= max_id LOOP
        UPDATE rental
        SET rental_year = EXTRACT(YEAR FROM rental_date)
        WHERE rental_id BETWEEN batch_start AND batch_start + batch_size - 1
          AND rental_year IS NULL;
        batch_start := batch_start + batch_size;
        PERFORM pg_sleep(0.05); -- breathing room
        RAISE NOTICE 'Batch done: % to %', batch_start - batch_size, batch_start - 1;
    END LOOP;
END $$;
-- Record time: ___
```

**Questions:**
1. Which approach was faster in total time?
2. Which approach would be safer in production? Why?
3. What happens to other queries during the single-statement update vs the batched version?

**Cleanup:**
```sql
ALTER TABLE rental DROP COLUMN IF EXISTS rental_year;
```

---

## Exercise 4: Adding a NOT NULL Constraint Safely

**Task:** Add a NOT NULL constraint to a column that already has data.

The naive way:
```sql
ALTER TABLE film ALTER COLUMN description SET NOT NULL;
-- This requires a full table scan to verify no NULLs exist.
-- On a large table, this locks.
```

The safe way:
```sql
-- Step 1: Add a CHECK constraint as NOT VALID (no full scan)
ALTER TABLE film ADD CONSTRAINT chk_description_not_null
    CHECK (description IS NOT NULL) NOT VALID;

-- Step 2: Validate it separately (reads but doesn't lock writes)
ALTER TABLE film VALIDATE CONSTRAINT chk_description_not_null;

-- Step 3: Now you can safely set NOT NULL (Postgres trusts the validated CHECK)
ALTER TABLE film ALTER COLUMN description SET NOT NULL;
```

**Test this pattern. Questions:**
1. Did the `NOT VALID` step block?
2. Did the `VALIDATE` step take longer?
3. Why is this two-step approach safer than a direct `SET NOT NULL`?

**Cleanup:**
```sql
ALTER TABLE film ALTER COLUMN description DROP NOT NULL;
ALTER TABLE film DROP CONSTRAINT IF EXISTS chk_description_not_null;
```

---

## Exercise 5: CREATE INDEX CONCURRENTLY Failure

**Task:** Intentionally break a concurrent index build and recover.

```sql
-- Start building an index concurrently
CREATE INDEX CONCURRENTLY idx_rental_conc ON rental(staff_id);

-- Now imagine this failed midway (simulate by cancelling in another session)
-- Check for invalid indexes:
SELECT
    c.relname AS index_name,
    i.indisvalid AS is_valid
FROM pg_class c
JOIN pg_index i ON c.oid = i.indexrelid
WHERE c.relname LIKE 'idx_rental_conc%';
```

If the index is VALID, drop it and try to simulate a failure:
```sql
-- In Session 1: begin a transaction that will block
BEGIN;
LOCK TABLE rental IN SHARE MODE;

-- In Session 2: try concurrent index (it will wait, then you can cancel)
-- CREATE INDEX CONCURRENTLY idx_rental_conc2 ON rental(customer_id);
-- Press Ctrl+C to cancel

-- Check for invalid index
-- If invalid: DROP INDEX idx_rental_conc2; and rebuild
```

**Cleanup:**
```sql
DROP INDEX IF EXISTS idx_rental_conc;
DROP INDEX IF EXISTS idx_rental_conc2;
```

---

## Self-Check

- [ ] I can identify which ALTER TABLE operations lock and which don't
- [ ] I can walk through the expand/contract pattern step by step
- [ ] I understand why batched backfills are safer than single-statement updates
- [ ] I know the NOT VALID → VALIDATE → SET NOT NULL pattern
- [ ] I can recover from a failed CONCURRENTLY index build
