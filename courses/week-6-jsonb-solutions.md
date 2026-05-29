# Week 6 Solutions

## Exercise 2: JSONB Operators

- `@>` containment and `?` key existence → Seq Scan without GIN index, index-accelerated with GIN
- `->>` text extraction followed by a cast → always Seq Scan with GIN (GIN doesn't understand text comparisons)
- `->` for access is not a filter, just projection — no index involved

---

## Exercise 3: GIN Index

**With GIN, the `@>` query** changes from Seq Scan to Bitmap Index Scan → Bitmap Heap Scan. On 1,000 rows the time difference is tiny, but on 1M+ rows it's the difference between scanning every row vs. hitting a few index entries.

**Why GIN doesn't help `->>` comparisons:**
GIN indexes the *structure* of the JSONB — keys, values, containment. It doesn't know how to compare extracted text values as numbers. For that, you need an expression index:

```sql
CREATE INDEX idx_film_imdb ON film (((metadata -> 'scores' ->> 'imdb')::numeric));
```

This creates a B-tree on the computed numeric value, which supports `>`, `<`, `BETWEEN`, and `ORDER BY`.

**Interview talking point:** "GIN indexes are for containment queries — 'does this document contain X?' Expression indexes are for computed value queries — 'is this extracted number greater than Y?' Knowing which to use depends on your query pattern."

---

## Exercise 4: JSONB vs Relational Comparison

**Typical findings:**

| Query | JSONB | Relational |
|-------|-------|-----------|
| Score range (> 9.0) | Needs expression index | B-tree on (source, score) — fast out of the box |
| Multi-condition (region + tag) | Single GIN index covers both | Requires 2 JOINs, but each uses a PK index |
| Add a new score source | Just insert a new key — no schema change | Needs an INSERT into film_scores — also no schema change |
| Type safety | None — you can store `"imdb": "banana"` | NUMERIC column rejects non-numbers |

**The verdict:**
- Relational is better when the schema is stable and you need integrity + fast analytical queries
- JSONB is better when the schema changes frequently and you query by containment rather than by range
- Hybrid is usually the right answer in practice

---

## Exercise 5: JSONB Update Cost

**Single-row update:** nearly identical speed for typed column vs JSONB key. The rewrite penalty is invisible at this scale.

**Where it shows up:**
- Large JSONB values (10KB+) — the entire value is rewritten even for a single key change
- High-frequency updates — each update generates a new row version (MVCC), and the JSONB blob is duplicated entirely
- GIN index maintenance — after many updates, the GIN index accumulates dead entries (bloat). Run `REINDEX INDEX idx_film_metadata;` periodically.

---

## Exercise 6: Product Catalog Design

**Approach A: All JSONB**
```sql
CREATE TABLE products_jsonb (
    id BIGSERIAL PRIMARY KEY,
    data JSONB NOT NULL
    -- Everything in JSONB: name, price, category, custom attributes
);
```

Problems: no type checking on price (could be a string), no NOT NULL on name, can't enforce uniqueness, JOINs are painful.

**Approach B: Hybrid (recommended)**
```sql
CREATE TABLE products_hybrid (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    category TEXT NOT NULL,
    attributes JSONB DEFAULT '{}'
    -- clothing: {"size": "M", "color": "blue"}
    -- electronics: {"voltage": 220, "warranty_months": 24}
    -- books: {"isbn": "978-...", "page_count": 350}
);

CREATE INDEX idx_products_category ON products_hybrid(category);
CREATE INDEX idx_products_attrs ON products_hybrid USING gin(attributes);
```

**Why hybrid wins:**
1. `name`, `price`, `category` are type-checked, indexable, and always present
2. `attributes` handles the per-category variation without schema changes
3. You can add GIN index for containment queries on attributes
4. If a field starts appearing in >80% of products, promote it to a typed column (expand/contract from Week 5)

**Migration from A to B:**
Use the expand/contract pattern:
1. Add typed columns (`name`, `price`, `category`)
2. Backfill from JSONB: `UPDATE products SET name = data->>'name'` in batches
3. Deploy code to read from typed columns
4. Remove those keys from the JSONB column
5. Rename `data` to `attributes`

---

## Week 6 Interview Flash Card

**Q: When would you use JSONB instead of proper relational tables?**

"JSONB is the right call when the schema varies per row — like user-defined custom fields, event payloads with different structures per event type, or third-party API responses where I don't control the shape. I'd always pair it with a GIN index for containment queries. But if every row has the same fields, I'd use typed columns — you get NOT NULL, type checking, better query plans, and smaller storage. In practice, I usually end up with a hybrid: typed columns for stable, always-present fields, and a JSONB column for the extensible part. The key is knowing when to promote a JSONB field to a real column — usually when you're querying it in WHERE clauses frequently or need referential integrity."
