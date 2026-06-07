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

### Redundancy

The same fact stored in more than one place. Redundancy is the problem normalisation removes — if "Canada" were typed onto 50 different city rows and the spelling needed fixing, you'd have 50 rows to update instead of 1.

### Normalisation & Third Normal Form (3NF)

**Normalisation** = organising tables so each fact lives in exactly one place. The practical target for most apps is **3NF**, summed up as: *every column depends on the key, the whole key, and nothing but the key.*

- depends on **the key** (1NF) — each column holds one value, identified by the primary key
- depends on the **whole key** (2NF) — no column depends on only part of a composite key
- depends on **nothing but the key** (3NF) — no column describes another non-key column

You don't need to memorise the formal proofs. The instinct that matters: *"is any fact here repeated, or does any column describe something other than this row's id? If so, it probably belongs in its own table."*

> **OLTP vs OLAP (where each style fits).**
> **OLTP** (*Online Transaction Processing*) is the live database behind an app — lots of small, fast reads/writes: rent a film (insert one `rental` row), take a payment (insert one `payment` row). These schemas are **normalised** for correctness. **OLAP** (*Online Analytical Processing*) is reporting/analytics — a few big queries scanning millions of rows ("revenue per category per month"). These are often **denormalised** for read speed. Pagila is an OLTP-style schema.

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

Denormalisation flattens that split data back into one wide result, trading duplication for fewer joins. Pagila ships a built-in example — the `film_list` **view**, which glues `film → film_category → category` and `film → film_actor → actor` together and mashes all the actor names into one text field:

```sql
SELECT * FROM film_list LIMIT 5;
-- fid | title | category | price | length | rating | actors
-- ... | ...   | Horror   | 4.99  | ...    | PG     | "PENELOPE GUINESS, CHRISTIAN GABLE, ..."
```

Reading that is easy — one row, no joins. But imagine *storing* the `actors` text permanently on each film row. That's denormalisation, and here's the trade:

| | Normalised (`film_actor`) | Denormalised (actor names on `film`) |
|---|---|---|
| Reads | Need a join | Already flat, fast |
| Writes | Update a name in one place | Update it on every film they're in |
| Consistency | Guaranteed by the FK | Can drift (renamed in `actor`, stale on `film`) |
| Storage | Smaller | Larger (repeated text) |

> A **view** like `film_list` gives you the *read convenience* of denormalisation while the *underlying tables stay normalised* — the join just runs each time you query. Storing the flattened result is what creates the duplication risk.

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
