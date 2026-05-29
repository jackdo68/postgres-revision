# Week 3 Solutions

## Exercise 1: FK Map

Pagila has ~20+ foreign keys. The most referenced table is typically `customer` or `film` — many tables depend on them.

All Pagila FKs use **RESTRICT** (the default) — no CASCADE anywhere. This is the safe choice for a rental system where you don't want accidental data loss.

**Dependency chain for deleting a customer:**
```
customer ← rental (customer_id) — BLOCKED
customer ← payment (customer_id) — BLOCKED
```
You'd need to delete payments first, then rentals, then the customer.

---

## Exercise 2: CASCADE Chain

**After deleting the Downtown store (id=1):**
- Staff remaining: 1 (Carol, who works at Airport)
- Rentals remaining: 3 (Carol's rentals only)
- Alice and Bob were cascaded away, AND their rentals were cascaded too

**This is dangerous because:** a single `DELETE FROM store` wiped out staff records and rental history. In a real system, you'd lose financial records. This is why Pagila uses RESTRICT, not CASCADE.

**With RESTRICT:**
```sql
-- ERROR: update or delete on table "test_store" violates foreign key constraint
-- Detail: Key (id)=(1) is still referenced from table "test_staff"
```
Forces you to explicitly handle dependencies — much safer.

---

## Exercise 3: FK Write Overhead

**Typical results (200k rows):**

| Table | Insert Time |
|-------|------------|
| With FK | ~1.5–2.5s |
| Without FK | ~1.0–1.5s |

FK overhead is typically **30–60%** on bulk inserts. This is because Postgres does a lookup against `customer(customer_id)` for every single insert.

**At what scale does this matter?**
- Below 1k inserts/sec: negligible
- 1k–10k inserts/sec: noticeable, tune with batch inserts
- 10k+ inserts/sec: consider whether the FK is worth the cost

**Risk of dropping:** `INSERT INTO orders_without_fk (customer_id, amount) VALUES (99999, 50.00)` succeeds silently. You now have an order for a customer that doesn't exist.

---

## Exercise 4: Orphaned Data Detection

```sql
-- Find all orphaned customer_ids
SELECT DISTINCT o.customer_id
FROM orders_without_fk o
LEFT JOIN customer c ON o.customer_id = c.customer_id
WHERE c.customer_id IS NULL;
```

**Prevention without FKs:**
1. Application-level check before insert (adds latency, can race)
2. Scheduled job that scans for orphans and alerts
3. Event-driven: when a customer is deleted, publish an event and clean up references
4. Soft deletes — never actually delete the parent row

**Interview talking point:** "Dropping FKs doesn't mean dropping the guarantee — it means moving the guarantee from the database to the application. The question is whether you trust your application code more than Postgres."

---

## Exercise 5: N+1 Analysis

**N+1 approach:** 1 query for films + 10 queries for actors = **11 queries total**. Each one has connection overhead, parse time, and plan time.

**Single JOIN:** 1 query, typically 2-5x faster total. Postgres optimises the join plan once.

**Indexes on film_actor:**
```sql
-- Check existing indexes
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'film_actor';
```

Pagila has indexes on `film_actor(actor_id)` and `film_actor(film_id)`. A composite index `(film_id, actor_id)` could be a covering index for the join, but in practice the individual indexes are sufficient here — Postgres uses them in the hash join.

---

## Exercise 6: FK Strategy Design

```sql
CREATE TABLE new_orders (
    id BIGSERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customer(customer_id) ON DELETE RESTRICT,
    -- RESTRICT: never auto-delete an order when a customer is removed.
    -- Financial records must be preserved. Handle in application.

    film_id INT NOT NULL REFERENCES film(film_id) ON DELETE RESTRICT,
    -- RESTRICT: don't lose order history if a film is delisted.
    -- Soft-delete the film instead.

    staff_id INT REFERENCES staff(staff_id) ON DELETE SET NULL,
    -- SET NULL: if a staff member leaves, the order still exists
    -- but we no longer know who processed it. Acceptable for non-critical field.

    amount NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

**The reasoning pattern:** RESTRICT for anything financial or legally important. SET NULL for optional references where losing the link is acceptable. CASCADE almost never for tables that hold business records.

---

## Week 3 Interview Flash Card

**Q: When would you skip foreign keys?**

"I use FKs by default — they catch bugs that application code misses, especially in teams where multiple services write to the same database. I'd consider dropping them in two scenarios: first, when write throughput is measured bottleneck and the FK check is the culprit (not just a guess). Second, when the system is sharded or split across microservices where cross-database FKs are physically impossible. In both cases, I'd add orphan detection — a scheduled job or event-driven cleanup — because the consistency guarantee doesn't disappear, it just moves to the application layer."
