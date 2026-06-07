# Week 1 Exercises: Normalisation vs Denormalisation

## Setup

Make sure Pagila is loaded and you're connected (this repo loads Pagila into the `devdb` database):

```bash
pgcli -h localhost -U devuser -d devdb
```

---

## Exercise 1: Understand the Normalised Schema

**Task:** Write a query that returns film titles with all their actors, ordered by film title. This is the "normalised way" — joining three tables.

```sql
-- Write your query here. You need: film, film_actor, actor
-- Expected columns: film title, actor first_name, actor last_name
```

**Then run:**

```sql
EXPLAIN ANALYZE <your query>;
```

**Record:** How many rows scanned? What join types were used? How long did it take?

---

## Exercise 2: Build a Denormalised Version

**Task:** Create a new table that flattens actors into each film row:

```sql
CREATE TABLE film_denormalised AS
SELECT
    f.film_id,
    f.title,
    f.description,
    f.release_year,
    f.rental_rate,
    -- YOUR TASK: aggregate actor names into a single text array
    -- Hint: use array_agg() or string_agg()
FROM film f
LEFT JOIN film_actor fa ON f.film_id = fa.film_id
LEFT JOIN actor a ON fa.actor_id = a.actor_id
GROUP BY f.film_id, f.title, f.description, f.release_year, f.rental_rate;
```

**Then query it:**

```sql
SELECT title, actors FROM film_denormalised WHERE title = 'ACADEMY DINOSAUR';
```

**Run EXPLAIN ANALYZE** on this query and compare with Exercise 1.

---

## Exercise 3: Measure the Write Cost

**Task:** Simulate an actor name change in BOTH schemas.

**Normalised (one update):**

```sql
-- How many rows does this touch?
EXPLAIN ANALYZE
UPDATE actor SET first_name = 'JOHNNY' WHERE actor_id = 1;
```

**Denormalised (update every film that actor appears in):**

```sql
-- First: how many films is actor_id=1 in?
SELECT count(*) FROM film_actor WHERE actor_id = 1;

-- Now rebuild those rows in the denormalised table
-- Write the UPDATE statement that fixes the actor name in film_denormalised
-- Hint: you need a subquery to re-aggregate actor names for affected films
```

**Record:** How many rows did each approach touch? What's the ratio?

---

## Exercise 4: Materialised View — Best of Both Worlds?

**Task:** Instead of a permanent denormalised table, create a materialised view:

```sql
CREATE MATERIALIZED VIEW mv_film_actors AS
SELECT
    f.film_id,
    f.title,
    -- same aggregation as Exercise 2
FROM film f
LEFT JOIN film_actor fa ON f.film_id = fa.film_id
LEFT JOIN actor a ON fa.actor_id = a.actor_id
GROUP BY f.film_id, f.title;
```

**Questions to answer:**

1. Query the materialised view. Is performance similar to the denormalised table?
2. Update an actor name in the `actor` table. Query the materialised view again. Is the data stale?
3. Run `REFRESH MATERIALIZED VIEW mv_film_actors;` — how long does it take?
4. Try `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_film_actors;` — what error do you get? Why?

---

## Exercise 5: Real-World Scenario

**Scenario:** You're building a rental history page. The query joins `rental → inventory → film → customer` and runs 500 times/sec. It's slow.

**Task:**

1. Write the full normalised query (find all rentals with film title and customer name)
2. Run EXPLAIN ANALYZE and identify the most expensive join
3. Propose a denormalisation strategy — what would you flatten and why?
4. What's the downside of your proposal? When would it break?

**Write your answer as a comment block in SQL.**

---

## Cleanup

```sql
DROP TABLE IF EXISTS film_denormalised;
DROP MATERIALIZED VIEW IF EXISTS mv_film_actors;
-- Reset actor name if you changed it
UPDATE actor SET first_name = 'PENELOPE' WHERE actor_id = 1;
```

---

## Self-Check

Before looking at solutions, ask yourself:

- [ ] Can I explain the join cost I measured in Exercise 1?
- [ ] Can I articulate why the write cost in Exercise 3 matters at scale?
- [ ] Do I understand when a materialised view is better than a denormalised table?
- [ ] Can I walk someone through my Exercise 5 reasoning in 2 minutes?
