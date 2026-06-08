# Week 1: Normalisation vs Denormalisation

## Introduction

This week answers one question that every database design starts with:

> **When I have data to store, do I split it into clean, separate tables (normalise), or do I copy it together into fewer tables to make reads faster (denormalise)?**

The one idea to walk away with: **store each fact in exactly one place by default (normalise). Only duplicate it on purpose, when you've measured a read that needs it (denormalise).**

We'll use the **Pagila** database (a DVD rental shop) for every example. By the end you should be able to look at a table and say *"this is normalised because…"* and explain the trade-off out loud.

---

## Key Concepts

Before the deep dive, here are the words you need. If these are already clear, skip ahead.

### The building blocks: database → schema → table → row

Think of PostgreSQL as a set of nested boxes:

```
PostgreSQL server (your Docker container, port 5432)
│
└── Database  ........... "devdb"     ← the dataset you connect to
    │
    └── Schema  ......... "public"    ← a folder grouping tables
        │
        └── Table  ...... "actor", "film", "city" ...
            │
            └── Rows & Columns  ← the actual data grid
```

- **Database (`devdb`)** — the biggest box. One server can hold many databases, and they're isolated from each other. Our whole Pagila dataset lives in here.
- **Schema (`public`)** — a folder *inside* a database that groups tables. Everything lands in `public` by default. A table's full name is `schema.table`, e.g. `public.actor`.
- **Table (`actor`)** — a grid of data, like one sheet in a spreadsheet.
  - **Columns** are the fields with fixed names and types: `actor` has `actor_id` (number), `first_name` (text), `last_name` (text), `last_update` (timestamp).
  - **Rows** are the records. `actor` has 200 rows; row 1 is `1 | PENELOPE | GUINESS | …`. Try it: `SELECT * FROM actor LIMIT 5;`

### Primary key

A column that uniquely identifies each row. In `actor` it's `actor_id` — no two actors share one. It's how other tables point at this exact row.

### Foreign key (FK)

A column that *points to* a primary key in another table. In Pagila, `city.country_id` points to `country.country_id`. This is the "link" that lets data live in one table and be referenced from another. (Week 3 goes deep on FKs.)

### Join

The SQL operation that follows a foreign key to stitch tables back together at read time:

```sql
SELECT city.city, country.country
FROM city
JOIN country ON city.country_id = country.country_id;
```

Normalising means you split data apart; joining is how you put it back together when you query.

### View vs materialised view

Both let you give a name to a query (often a big join) and then `SELECT` from it like a table — but they store data very differently:

- **View** — a *saved query*. Stores **no data**; every time you read it, Postgres re-runs the underlying query against the live tables. Always up to date, but pays the query cost on every read. Pagila's `film_list` and `customer_list` are views.
- **Materialised view** — runs the query **once and stores the result on disk** (a snapshot). Reads are fast (no query underneath), but the data is frozen until you run `REFRESH MATERIALIZED VIEW`.

| | View | Materialised view |
|---|---|---|
| Stores data? | No — just the saved query | Yes — a stored snapshot |
| Query runs at read time? | Yes, every read | No — reads the snapshot |
| Read speed | Same as the query (e.g. the join) | Fast |
| Always fresh? | Yes — live | No — stale until `REFRESH` |
| Refresh needed? | Never | Yes, manually or on a schedule |

Rule of thumb: a **view** is for convenience (a reusable query shape) and always-correct data; a **materialised view** is for speed when you can tolerate slightly stale data. This distinction matters for denormalisation below — a plain view does *not* avoid the join cost, but a materialised view does.

### Redundancy

The same fact stored in more than one place. Redundancy is the problem normalisation removes — if "Canada" were typed onto 50 different city rows and the spelling needed fixing, you'd have 50 rows to update instead of 1.

### Normalisation & Third Normal Form (3NF)

**Normalisation** = organising tables so each fact lives in exactly one place. The practical target for most apps is **3NF**, summed up as: *every column depends on the key, the whole key, and nothing but the key.*

- depends on **the key** (1NF) — each column holds one value, identified by the primary key
- depends on the **whole key** (2NF) — no column depends on only part of a composite key
- depends on **nothing but the key** (3NF) — no column describes another non-key column

You don't need to memorise the formal proofs. The instinct that matters: *"is any fact here repeated, or does any column describe something other than this row's id? If so, it probably belongs in its own table."*

#### Each rule with a Pagila example

The pattern is the same every time: spot the bad table, see why it breaks, fix it by splitting.

**1NF — each cell holds one value.** Violation: cram multiple actors into one column.

```
film_bad
film_id | title            | actors
--------+------------------+-------------------------------------------
1       | ACADEMY DINOSAUR | "PENELOPE GUINESS, CHRISTIAN GABLE, ..."
```

The `actors` cell holds a *list*, not a single value — you can't easily query "all films with a given actor," index it, or join on it. **Fix:** one fact per row, which is exactly Pagila's `film_actor`:

```
film_actor
film_id | actor_id
--------+---------
1       | 1
1       | 10
```

**2NF — depends on the WHOLE key** (only relevant when the key is composite). `film_actor`'s primary key is two columns together: `(film_id, actor_id)`. Violation: add `actor_last_name`, which depends on `actor_id` *alone* (half the key):

```
film_actor_bad
film_id | actor_id | actor_last_name   ← depends only on actor_id, not film_id
--------+----------+----------------
1       | 1        | GUINESS
23      | 1        | GUINESS           ← repeated for every film the actor is in
```

**Fix:** put the name where its real key lives — the `actor` table (keyed by `actor_id` only). `film_actor` keeps just the two ids.

**3NF — depends on NOTHING BUT the key** (no column describing another non-key column). Violation: put `city_name` and `country_name` directly on `address`:

```
address_bad
address_id | address           | city_id | city_name  | country_name
-----------+-------------------+---------+------------+-------------
1          | 47 MySakila Drive | 300     | Lethbridge | Canada
2          | 28 MySQL Blvd     | 300     | Lethbridge | Canada      ← repeated
```

`city_name` doesn't describe the *address* — it describes `city_id`. The chain is `address_id → city_id → city_name` (transitive), so "Lethbridge"/"Canada" get retyped on every address in that city. **Fix:** keep only the foreign key on `address`; the name lives in `city`, the country in `country` — exactly Pagila's real `address → city → country` chain.

**The shortcut:** if a value is *repeated across rows*, it's usually a normal-form smell. 1NF = don't stuff lists in a cell; 2NF = don't depend on half a composite key; 3NF = don't store a fact that really belongs to something you're already pointing at.

#### OLTP vs OLAP (where each style fits)

Two kinds of database workload, and they pull schema design in opposite directions:

- **OLTP** (*Online Transaction Processing*) — the live database behind an app. Normalised for correctness.
- **OLAP** (*Online Analytical Processing*) — reporting/analytics. Often denormalised for read speed.

| | OLTP | OLAP |
|---|---|---|
| Full name | Online Transaction Processing | Online Analytical Processing |
| What it is | The live database behind an app | Reporting / analytics |
| Workload | Many small, fast reads/writes | A few big queries scanning millions of rows |
| Example | Rent a film (insert one `rental` row) | "Revenue per category per month" |
| Schema style | **Normalised** (3NF) | Often **denormalised** |
| Optimised for | Correctness & per-transaction speed | Scanning/aggregating large volumes |

Pagila is an OLTP-style schema.

---

## Deep Dive: Normalisation vs Denormalisation

### What normalisation looks like in Pagila

The clearest example is the location chain. Instead of writing the city and country onto every address, Pagila splits it into three tables linked by foreign keys:

```
address ──(city_id)──▶ city ──(country_id)──▶ country
```

```sql
-- country: each country stored ONCE (109 rows)
country(country_id PK, country)            -- e.g. 20 | Canada

-- city: points to a country (600 rows)
city(city_id PK, city, country_id FK)      -- e.g. 300 | Lethbridge | 20

-- address: points to a city (603 rows)
address(address_id PK, address, city_id FK)
```

Why this is good:
- **"Canada" is stored once** in `country`, even though many cities sit in it. Fix a typo in one row and every address is instantly correct.
- No row can reference a country that doesn't exist — the foreign key enforces it.
- It's flexible: you can ask "how many addresses per country?" without trusting that the text was typed consistently.

The same idea handles a **many-to-many** relationship between films and actors. A film has many actors and an actor appears in many films, so Pagila uses a small **junction table**:

```sql
film(film_id PK, title, ...)               -- 1000 films
actor(actor_id PK, first_name, last_name)  -- 200 actors
film_actor(film_id FK, actor_id FK)        -- 5462 links, names stored NOWHERE here
```

`film_actor` is a textbook 3NF table: it holds only the two ids that form its key and nothing else. An actor's name lives only in `actor`.

### What denormalisation looks like

Real denormalisation means **physically storing the flattened/duplicated data** so the join doesn't have to run at read time. The *shape* you're aiming for looks like Pagila's built-in `film_list` **view**, which glues `film → film_category → category` and `film → film_actor → actor` together and mashes all the actor names into one text field:

```sql
SELECT * FROM film_list LIMIT 5;
-- fid | title | category | price | length | rating | actors
-- ... | ...   | Horror   | 4.99  | ...    | PG     | "PENELOPE GUINESS, CHRISTIAN GABLE, ..."
```

That reads like one flat table — but **a plain view is not actually denormalised.** A view is just a *saved query*: every time you read it, Postgres re-runs the full join underneath. So `film_list` gives you the denormalised *shape* (convenience) but **not** the denormalised *storage* — you still pay the join cost on every read.

To get the read-speed win, you must store the flattened result for real. Two ways:

- **Denormalised table** — store the `actors` text (or array) directly on the film row. No join at read; but *you* own the duplication and must keep it in sync on every write.
- **Materialised view** — like a view, but Postgres stores the query result on disk as a snapshot. Reads skip the join; the cost is staleness until you run `REFRESH MATERIALIZED VIEW`.

| | Plain view (`film_list`) | Denormalised table | Materialised view |
|---|---|---|---|
| Stores flattened data? | No — saved query | Yes | Yes (snapshot) |
| Join runs at read time? | **Yes, every time** | No | No |
| Faster reads? | No (same as the join) | Yes | Yes |
| Real denormalisation? | **No** | Yes | Yes |
| Data freshness | Always live | Live *if* you sync writes | Stale until `REFRESH` |

So: **view = denormalised *interface*; denormalised table / materialised view = denormalised *storage*.** Only the latter two trade duplication for read speed. And that trade is the core decision:

| | Normalised (`film_actor`) | Denormalised storage (names on `film`) |
|---|---|---|
| Reads | Need a join | Already flat, fast |
| Writes | Update a name in one place | Update it on every film they're in |
| Consistency | Guaranteed by the FK | Can drift (renamed in `actor`, stale on `film`) |
| Storage | Smaller | Larger (repeated text) |

### Why a join can become a bottleneck

A join isn't free — Postgres has to **match rows together at query time**, spending **CPU** (comparing values), **memory** (building a hash table or sorting), and **I/O** (reading rows from each table). The catch is that this cost is paid on **every single read**:

- One query joining 4 tables in ~2ms feels free.
- The same query on a search page running 500×/second pays that join cost 500×/second — now CPU and memory add up and the database becomes the bottleneck.

Denormalising pre-computes the join once, so each read is a plain single-table lookup with no matching work. That's the trade:

| Per read | Normalised (join at read) | Denormalised (pre-joined) |
|---|---|---|
| Read speed | Slower — match rows every query | Faster — one table, no matching |
| CPU | Higher (compare / hash / sort) | Lower |
| Memory | Hash tables / sort buffers | Minimal |
| Storage | Smaller — each fact stored once | Larger — data repeated |
| Write speed | Fast — update one row | Slower — update every copy |
| Consistency | Guaranteed (single source) | Can drift / go stale |

**But measure first.** A join is only a bottleneck once you've proven it. Two things usually fix a "slow join" *without* denormalising: (1) an **index on the join column** turns a slow scan into a fast lookup — Pagila already indexes `film_actor.film_id`; (2) Postgres **caches hot pages** in memory, so repeated joins often hit RAM, not disk. Reach for denormalisation only after `EXPLAIN ANALYZE` shows the join itself dominating the plan.

### When to normalise (the default)

- The data changes often (customer details, account balances) — you want one place to update.
- Consistency matters more than raw read speed (payments, inventory).
- You don't know your query patterns yet — normalised schemas keep your options open.

### When to denormalise (deliberately)

- Read-heavy workloads where the same join runs constantly (dashboards, search results).
- The duplicated value rarely changes (country names, category labels).
- You've **measured** a join bottleneck with `EXPLAIN ANALYZE` — not guessed.
- You're building a read model / materialised view for one specific query.

---

## Interview Tips

What interviewers want to hear: **"It depends on the access pattern"** — then a concrete example.

- A strong answer points at something real: *"`film_actor` is normalised so actor names live once. But if I served a search page rendering 'Film X starring A, B, C' thousands of times a second, I'd consider denormalising those names onto the film row — and I'd add a job to keep them in sync."*
- Name the trade explicitly: faster reads, slower writes, risk of stale data.
- **Red flags:** "always normalise" or "always denormalise."
- **Green flag:** showing you've felt the pain of both and can say *when* each applies — and that you'd denormalise only after measuring, not on a hunch.
