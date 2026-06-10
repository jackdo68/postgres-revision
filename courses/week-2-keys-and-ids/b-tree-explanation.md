# B-tree, explained simply

A **B-tree** is the data structure PostgreSQL uses to find rows fast. When you put a primary key or index on a column, Postgres builds a B-tree on that column's values. Instead of scanning every row, it walks a short tree to jump straight to what you want.

This note builds one by hand from a 10-row table so you can *see* the shape.

---

## The pieces

A B-tree is made of **pages** (fixed-size blocks — 8KB in Postgres). There are two kinds:

- **Leaf pages** — hold the actual sorted values, each with a pointer to the real table row.
- **Internal pages** (including the **root** at the top) — hold *separator keys* that just tell you "go left or right" to reach the correct leaf.

Two properties make it fast:
- **Sorted** — values are kept in order inside each page.
- **Balanced** — every leaf sits the same distance from the root, so any lookup takes the same small number of hops.

---

## Simple diagram (the general shape)

```
                 ┌──────────────┐
                 │   root page  │        ← separator keys: "which way down?"
                 └──────┬───────┘
            ┌───────────┼───────────┐
            ▼           ▼           ▼
        ┌───────┐   ┌───────┐   ┌───────┐
        │ leaf  │   │ leaf  │   │ leaf  │  ← sorted values + pointer to each row
        └───┬───┘   └───┬───┘   └───┬───┘
            └───────────┴───────────┘
              leaves linked left → right (in sorted order)
```

You always start at the root, step down through internal pages, and land on one leaf.

> **Note:** a real Postgres page holds *hundreds* of entries, so a 10-row table would actually fit in **one** page (the root *is* the only leaf). To show the tree shape, the rest of this note **pretends each page holds at most 3 values**.

---

## Our 10-row table

The first 10 rows of Pagila's `actor` table. The B-tree is built on the primary key, `actor_id`:

```
actor_id | first_name | last_name
---------+------------+-------------
   1     | PENELOPE   | GUINESS
   2     | NICK       | WAHLBERG
   3     | ED         | CHASE
   4     | JENNIFER   | DAVIS
   5     | JOHNNY     | LOLLOBRIGIDA
   6     | BETTE      | NICHOLSON
   7     | GRACE      | MOSTEL
   8     | MATTHEW    | JOHANSSON
   9     | JOE        | SWANK
  10     | CHRISTIAN  | GABLE
```

---

## How the B-tree looks for these 10 rows

With our "3 values per page" rule, the 10 `actor_id`s split into 4 leaf pages, and a root on top points to them:

```
                      ROOT (internal page)
                 ┌─────┬─────┬──────┐
                 │  4  │  7  │  10  │          separator keys
                 └──┬──┴──┬──┴───┬──┴───┐
            <4 │    4..6 │  7..9 │   ≥10 │
               ▼         ▼        ▼       ▼
          ┌─────────┐ ┌───────┐ ┌───────┐ ┌──────┐
 LEAVES:  │ 1  2  3 │ │ 4 5 6 │ │ 7 8 9 │ │  10  │
          └────┬────┘ └───┬───┘ └───┬───┘ └──┬───┘
               └──────────┴─────────┴────────┘
                     linked in sorted order →

          each leaf value points to its table row, e.g.
          3 → (ED, CHASE)        8 → (MATTHEW, JOHANSSON)
```

The root's separators say: *anything below 4 is in leaf 1, 4–6 in leaf 2, 7–9 in leaf 3, 10-and-up in leaf 4.*

---

## How a lookup works

`SELECT * FROM actor WHERE actor_id = 8;`

1. **Start at the root.** Is 8 < 4? No. < 7? No. < 10? Yes → take the "7..9" branch.
2. **Arrive at leaf `[7 8 9]`.** Scan it: 7… **8** ✅.
3. **Follow the pointer** to the actual row → `(MATTHEW, JOHANSSON)`.

That's **2 hops** instead of checking all 10 rows. With millions of rows it's still only ~3–4 hops — that's the power of the tree.

---

## How many B-trees does a table have? (one per index)

**Each index is its own separate B-tree.**

- The **primary key** automatically builds one B-tree (a unique index) on the PK column → a table with just a PK has **1 B-tree**.
- **Every additional `CREATE INDEX`** builds **another** B-tree on whichever column(s) you index.

So one table can have many B-trees — one per index. Pagila's `rental` table, for example, has three:

```
rental
├── rental_pkey                       → B-tree on (rental_id)        [from the PK]
├── idx_fk_inventory_id               → B-tree on (inventory_id)
└── idx_unq_rental_..._customer_id    → B-tree on (rental_date, inventory_id, customer_id)
```

A **composite** index (the last one) is still **one** B-tree — just built on several columns combined.

Three things worth knowing:

1. **The table itself is *not* a B-tree.** Your rows live in a separate, unordered structure called the **heap**. Each index B-tree stores the sorted key values plus a *pointer into the heap*. So even the PK lookup is: walk the B-tree to find the row's location → fetch the row from the heap.
   - (Different from MySQL/InnoDB, where the table *is* a B-tree clustered on the PK. Postgres keeps index and table separate.)

2. **Not every index is a B-tree.** B-tree is the *default* (and what a plain `CREATE INDEX` gives you), but Postgres also has GIN, BRIN, etc. for other jobs — that's Week 4.

3. **This is why indexes cost writes.** Every `INSERT`/`UPDATE` must update *every* B-tree on the table. One PK + 4 indexes = 5 trees to keep sorted on each write. That's the "every index slows writes" tradeoff — it exists precisely because each index is its own tree.

---

## How inserts work (the Week 2 point)

**Sequential id (`actor_id = 11`, a SERIAL):** 11 is bigger than everything, so it belongs at the **far right**. It drops into the last leaf:

```
before:  [ 10 ]
after:   [ 10  11 ]      ← always lands at the "right edge", one hot page
```

Cheap: Postgres touches the same end page over and over, and it's already in memory.

**Random id (a UUID):** the new value could sort *anywhere* — say it belongs between 4 and 5, but that leaf `[4 5 6]` is already full. Postgres must **split** it to make room:

```
before:  [ 4  5  6 ]                (full)
after:   [ 4  X ]   [ 5  6 ]        ← split into two half-empty pages
```

Expensive: it jumps to a random page (often a disk read), and splitting leaves pages **half-empty** — which is the **leaf density** problem (packed pages = good; half-empty pages = a bigger, slower index).

---

## But how does a random UUID fit a *sorted* tree?

A UUID is **sortable too** — it's not "unsortable randomness." Postgres stores it as 16 bytes and compares them left-to-right (like comparing the hex string), so every pair of UUIDs has a clear smaller/bigger order:

```
0a1f...  <  3c44...  <  7c9b...  <  a0ee...  <  e3d4...  <  f012...
```

That's all a B-tree needs. It keeps UUIDs sorted in the leaves exactly like integers (abbreviating each UUID to its first 4 hex chars):

```
                      ROOT
                ┌──────┬──────┬──────┐
                │ 7c9b │ a0ee │ e3d4 │     separator keys (sorted UUIDs)
                └──┬───┴──┬───┴──┬───┴──┐
                   ▼      ▼      ▼       ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
   LEAVES:    │0a1f 1f2a │ │7c9b 8d12 │ │a0ee b531 │ │e3d4 f012 │
              │     3c44 │ │     9f03 │ │     c7d9 │ │          │
              └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

**Lookup is identical to integers.** To find `b531...`: at the root, `b531` is not < `7c9b`, not < `a0ee`, but is < `e3d4` → take that branch → scan leaf `[a0ee, b531, c7d9]` → found → follow the pointer to the row. Same `O(log n)`, same handful of hops.

So what does randomness actually break? **Inserts, not lookups:**

| | Sequential id | Random UUID |
|---|---|---|
| Where a **new** value sorts | Always largest → far-right leaf | Random spot → some middle leaf |
| **Insert** cost | Cheap (one hot end page) | Page splits + cold-page disk reads |
| **Lookup** cost | `O(log n)` | `O(log n)` — **same** |

A new random UUID has a perfectly well-defined sorted position — it's just usually in the *middle* of an already-full leaf, forcing a split. A sequential id is always the biggest, so it appends to the end.

> **Sorting and lookup work the same for UUIDs and integers — the B-tree just compares values.** The problem with *random* UUIDs is purely that each **insert** lands in a random, possibly-full, possibly-uncached page (→ splits, bloat, disk reads). Reads aren't slower per lookup; writes are. A time-ordered UUID (v7) puts "newest = biggest," so inserts go back to the cheap right-edge — while lookups, already fine, stay fine.

---

> **The whole Week 2 lesson in one line:** sequential keys always land on the right edge (fast, tightly packed); random keys land all over and force splits (slow, half-empty pages). A *time-ordered* UUID (v7) or ULID restores the right-edge behaviour.
