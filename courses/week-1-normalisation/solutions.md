# Week 1 Solutions

## Exercise 1: Normalised Query

```sql
SELECT f.title, a.first_name, a.last_name
FROM film f
JOIN film_actor fa ON f.film_id = fa.film_id
JOIN actor a ON fa.actor_id = a.actor_id
ORDER BY f.title;
```

**Expected EXPLAIN ANALYZE observations:**
- Hash Joins or Merge Joins on `film_actor`
- ~5,462 rows returned (each film-actor combination)
- Execution time: typically 5-20ms on local Docker
- The `film_actor` table is the "bridge" — it gets scanned fully

**Interview talking point:** "This is fast enough for most use cases. The question is whether your application needs to run this query thousands of times per second with sub-millisecond latency."

---

## Exercise 2: Denormalised Table

```sql
CREATE TABLE film_denormalised AS
SELECT
    f.film_id,
    f.title,
    f.description,
    f.release_year,
    f.rental_rate,
    array_agg(a.first_name || ' ' || a.last_name ORDER BY a.last_name) AS actors
FROM film f
LEFT JOIN film_actor fa ON f.film_id = fa.film_id
LEFT JOIN actor a ON fa.actor_id = a.actor_id
GROUP BY f.film_id, f.title, f.description, f.release_year, f.rental_rate;
```

**EXPLAIN comparison:**
- Normalised (3-table join): scans ~5,462 rows across 3 tables
- Denormalised (single table): scans ~1,000 rows from 1 table
- The denormalised query should be 2-5x faster for a single film lookup

---

## Exercise 3: Write Cost

**Normalised:**
```sql
UPDATE actor SET first_name = 'JOHNNY' WHERE actor_id = 1;
-- Touches: 1 row. Done.
```

**How many films is actor_id=1 in?**
```sql
SELECT count(*) FROM film_actor WHERE actor_id = 1;
-- Typically 19 films
```

**Denormalised update:**
```sql
UPDATE film_denormalised fd
SET actors = sub.actors
FROM (
    SELECT f.film_id,
           array_agg(a.first_name || ' ' || a.last_name ORDER BY a.last_name) AS actors
    FROM film f
    JOIN film_actor fa ON f.film_id = fa.film_id
    JOIN actor a ON fa.actor_id = a.actor_id
    WHERE f.film_id IN (SELECT film_id FROM film_actor WHERE actor_id = 1)
    GROUP BY f.film_id
) sub
WHERE fd.film_id = sub.film_id;
-- Touches: 19 rows, requires re-aggregation for each
```

**The ratio:** 1 row vs 19 rows + a subquery with joins. At scale (millions of films per actor), this becomes a serious write amplification problem.

**Interview talking point:** "Denormalisation trades write complexity for read speed. The question is: how often does the source data change? For actor names — rarely. For account balances — constantly. That's where I'd draw the line."

---

## Exercise 4: Materialised View

```sql
CREATE MATERIALIZED VIEW mv_film_actors AS
SELECT
    f.film_id,
    f.title,
    array_agg(a.first_name || ' ' || a.last_name ORDER BY a.last_name) AS actors
FROM film f
LEFT JOIN film_actor fa ON f.film_id = fa.film_id
LEFT JOIN actor a ON fa.actor_id = a.actor_id
GROUP BY f.film_id, f.title;
```

**Answers:**

1. Performance is similar to the denormalised table — same scan, same speed
2. After updating `actor`, the materialised view returns STALE data — it still shows the old name
3. `REFRESH MATERIALIZED VIEW mv_film_actors;` — takes a few ms on this dataset, but locks the view (no reads during refresh)
4. `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires a UNIQUE INDEX on the view:
   ```sql
   CREATE UNIQUE INDEX ON mv_film_actors (film_id);
   -- Now CONCURRENTLY works — allows reads during refresh
   REFRESH MATERIALIZED VIEW CONCURRENTLY mv_film_actors;
   ```

**Interview talking point:** "Materialised views are great for read-heavy dashboards where data can be a few minutes stale. The tradeoff is refresh cost and staleness. For real-time needs, you need a different strategy."

---

## Exercise 5: Rental History Scenario

```sql
-- The normalised query
SELECT
    c.first_name || ' ' || c.last_name AS customer_name,
    f.title AS film_title,
    r.rental_date,
    r.return_date
FROM rental r
JOIN inventory i ON r.inventory_id = i.inventory_id
JOIN film f ON i.film_id = f.film_id
JOIN customer c ON r.customer_id = c.customer_id
ORDER BY r.rental_date DESC
LIMIT 50;
```

**Recommended denormalisation strategy:**
- Add `film_title` and `customer_name` directly to a `rental_summary` table
- Rationale: film titles and customer names change very rarely
- Reduces 4-table join to a single table scan
- Trade: need a trigger or async process to update names if they change

**When it breaks:**
- If customers change names frequently (legal name changes, etc.)
- If you add films to inventory and forget to update the summary
- If you need real-time accuracy (financial reporting on rentals)

---

## Week 1 Interview Flash Card

**Q: When would you denormalise a schema?**

"When I've measured a specific read bottleneck with EXPLAIN ANALYZE — not when I guess one exists. Denormalisation makes sense for read-heavy workloads where the duplicated data rarely changes. For example, flattening actor names onto a film row for a search page. But for data that changes often — like account balances — I'd keep it normalised and optimise with indexes or caching instead. Materialised views are a good middle ground when you can tolerate slightly stale data."
