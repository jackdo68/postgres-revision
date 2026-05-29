# Week 6 Exercises: JSONB & The NoSQL-in-SQL Question

## Exercise 1: Add JSONB to Pagila

**Task:** Add a `metadata` JSONB column to the `film` table and populate it with varied data.

```sql
ALTER TABLE film ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Populate with different structures per film category
UPDATE film SET metadata = jsonb_build_object(
    'source', CASE WHEN film_id % 3 = 0 THEN 'netflix' WHEN film_id % 3 = 1 THEN 'dvd' ELSE 'theatrical' END,
    'tags', CASE WHEN film_id % 2 = 0 THEN '["classic","remastered"]'::jsonb ELSE '["new-release"]'::jsonb END,
    'scores', jsonb_build_object(
        'imdb', round((random() * 4 + 6)::numeric, 1),
        'rotten_tomatoes', (random() * 40 + 60)::int
    ),
    'available_regions', CASE
        WHEN film_id % 4 = 0 THEN '["US","UK","AU"]'::jsonb
        WHEN film_id % 4 = 1 THEN '["US","CA"]'::jsonb
        ELSE '["US"]'::jsonb
    END
);

-- Verify
SELECT title, jsonb_pretty(metadata) FROM film LIMIT 3;
```

---

## Exercise 2: Query JSONB with Operators

**Task:** Practice each operator and understand what it returns.

```sql
-- 1. Get the source for a specific film (as text)
SELECT title, metadata ->> 'source' AS source FROM film WHERE film_id = 1;

-- 2. Get the IMDB score (nested access)
SELECT title, metadata -> 'scores' ->> 'imdb' AS imdb_score
FROM film ORDER BY (metadata -> 'scores' ->> 'imdb')::numeric DESC LIMIT 10;

-- 3. Find all Netflix films (containment)
EXPLAIN ANALYZE
SELECT title FROM film WHERE metadata @> '{"source": "netflix"}';

-- 4. Find films available in Australia
EXPLAIN ANALYZE
SELECT title FROM film WHERE metadata -> 'available_regions' ? 'AU';

-- 5. Find films tagged as "classic"
SELECT title FROM film WHERE metadata -> 'tags' @> '"classic"';
```

**Questions:**
1. Which queries used Seq Scan?
2. Which operators would benefit from a GIN index?

---

## Exercise 3: GIN Index on JSONB

**Task:** Add a GIN index and measure the difference.

```sql
-- Without index: run and record plan
EXPLAIN (ANALYZE, BUFFERS)
SELECT title FROM film WHERE metadata @> '{"source": "netflix"}';

-- Add GIN index
CREATE INDEX idx_film_metadata ON film USING gin(metadata);

-- With index: run and compare
EXPLAIN (ANALYZE, BUFFERS)
SELECT title FROM film WHERE metadata @> '{"source": "netflix"}';
```

**Now test an operator GIN doesn't help with:**

```sql
-- GIN doesn't accelerate ->> text comparison
EXPLAIN ANALYZE
SELECT title FROM film
WHERE (metadata -> 'scores' ->> 'imdb')::numeric > 9.0;
```

**Questions:**
1. Did the GIN index help the `@>` query?
2. Why doesn't GIN help the `->>` comparison?
3. How would you index the IMDB score for range queries? (Hint: expression index)

```sql
-- Try this:
CREATE INDEX idx_film_imdb ON film (((metadata -> 'scores' ->> 'imdb')::numeric));

EXPLAIN ANALYZE
SELECT title FROM film
WHERE (metadata -> 'scores' ->> 'imdb')::numeric > 9.0;
```

---

## Exercise 4: JSONB vs Relational — Side by Side

**Task:** Model the same data two ways and compare.

**Approach A: JSONB (already done)**
Films have metadata with scores, tags, and regions in a JSONB column.

**Approach B: Relational**

```sql
CREATE TABLE film_scores (
    film_id INT REFERENCES film(film_id),
    source TEXT NOT NULL, -- 'imdb', 'rotten_tomatoes'
    score NUMERIC(4,1) NOT NULL,
    PRIMARY KEY (film_id, source)
);

CREATE TABLE film_tags (
    film_id INT REFERENCES film(film_id),
    tag TEXT NOT NULL,
    PRIMARY KEY (film_id, tag)
);

CREATE TABLE film_regions (
    film_id INT REFERENCES film(film_id),
    region TEXT NOT NULL,
    PRIMARY KEY (film_id, region)
);

-- Populate from the JSONB data
INSERT INTO film_scores (film_id, source, score)
SELECT film_id, 'imdb', (metadata -> 'scores' ->> 'imdb')::numeric
FROM film WHERE metadata -> 'scores' ->> 'imdb' IS NOT NULL;

INSERT INTO film_scores (film_id, source, score)
SELECT film_id, 'rotten_tomatoes', (metadata -> 'scores' ->> 'rotten_tomatoes')::numeric
FROM film WHERE metadata -> 'scores' ->> 'rotten_tomatoes' IS NOT NULL;

INSERT INTO film_tags (film_id, tag)
SELECT film_id, tag
FROM film, jsonb_array_elements_text(metadata -> 'tags') AS tag;

INSERT INTO film_regions (film_id, region)
SELECT film_id, region
FROM film, jsonb_array_elements_text(metadata -> 'available_regions') AS region;
```

**Now compare queries:**

```sql
-- Find films with IMDB score > 9.0
-- JSONB:
EXPLAIN ANALYZE
SELECT title FROM film WHERE (metadata -> 'scores' ->> 'imdb')::numeric > 9.0;

-- Relational:
EXPLAIN ANALYZE
SELECT f.title FROM film f
JOIN film_scores fs ON f.film_id = fs.film_id
WHERE fs.source = 'imdb' AND fs.score > 9.0;

-- Find films available in AU with "classic" tag
-- JSONB:
EXPLAIN ANALYZE
SELECT title FROM film
WHERE metadata -> 'available_regions' ? 'AU'
  AND metadata -> 'tags' @> '"classic"';

-- Relational:
EXPLAIN ANALYZE
SELECT f.title FROM film f
JOIN film_regions fr ON f.film_id = fr.film_id
JOIN film_tags ft ON f.film_id = ft.film_id
WHERE fr.region = 'AU' AND ft.tag = 'classic';
```

**Record results and answer:**
1. Which approach is faster for each query?
2. Which approach is easier to extend (add a new score source)?
3. Which approach gives you type safety and referential integrity?
4. Which would you choose for a system where the set of metadata fields changes monthly?

---

## Exercise 5: JSONB Update Cost

**Task:** Measure the cost of updating a single key inside JSONB.

```sql
\timing on

-- Update a typed column
UPDATE film SET rental_rate = 5.99 WHERE film_id = 1;

-- Update a single JSONB key (rewrites the entire JSONB value)
UPDATE film SET metadata = jsonb_set(metadata, '{source}', '"updated"') WHERE film_id = 1;

-- Bulk update: change all Netflix sources to "streaming"
UPDATE film SET metadata = jsonb_set(metadata, '{source}', '"streaming"')
WHERE metadata @> '{"source": "netflix"}';
```

**Questions:**
1. Is there a difference in update speed for a single row?
2. For the bulk update, did the GIN index help find the rows?
3. What happens to the GIN index after many JSONB updates? (Hint: bloat)

---

## Exercise 6: Design Decision — Your Turn

**Scenario:** You're building a product catalog. Products have:
- Name, price, category (always present)
- Custom attributes that vary by category (clothing: size, color; electronics: voltage, warranty_months; books: isbn, page_count)

**Task:** Write two CREATE TABLE approaches:

```sql
-- Approach A: All JSONB
-- Write your schema here

-- Approach B: Hybrid (typed columns + JSONB for custom attributes)
-- Write your schema here
```

**Then answer:**
1. Which would you pitch to your team and why?
2. What queries would break or suffer under each approach?
3. How would you migrate from A to B if the schema stabilises later?

---

## Cleanup

```sql
DROP TABLE IF EXISTS film_scores, film_tags, film_regions;
DROP INDEX IF EXISTS idx_film_metadata, idx_film_imdb;
ALTER TABLE film DROP COLUMN IF EXISTS metadata;
```

---

## Self-Check

- [ ] I can use `->`, `->>`, `@>`, and `?` operators correctly
- [ ] I understand what GIN indexes accelerate and what they don't
- [ ] I can articulate when JSONB beats relational tables and vice versa
- [ ] I measured JSONB update costs and understand the rewrite penalty
- [ ] I can design a hybrid schema and justify the boundary between typed and JSONB
