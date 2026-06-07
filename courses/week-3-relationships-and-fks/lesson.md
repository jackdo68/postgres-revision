# Week 3: Relationships & Foreign Keys

## Introduction

Week 1 showed that normalisation splits data across tables; the **foreign key (FK)** is the thing that links them back together and *guarantees the link is valid*. An FK makes the database promise that `rental.customer_id` always points at a customer that actually exists.

This week is about that promise: how Postgres enforces it, what it costs, what happens to children when a parent is deleted, and why some large teams deliberately give it up.

The one idea to walk away with: **use foreign keys by default for correctness; only drop them for a specific, measured reason — and then own the consistency you've given up.**

---

## Key Concepts

### Foreign key (FK)

A column in a **child** table that must match a primary key in a **parent** table. Example from Pagila:

```sql
-- rental is the child, customer is the parent
ADD CONSTRAINT rental_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES customer(customer_id);
```

Now you cannot insert a `rental` for a `customer_id` that doesn't exist, and (depending on the rule) you can't delete a customer who still has rentals.

### Referential integrity

The guarantee that every FK points to a real row — no "orphans." This is the whole point of FKs: the database, not your application code, keeps the data honest.

### Referential actions (what happens to children)

When a parent row is deleted or its key updated, Postgres applies the action you chose:

```
ON DELETE RESTRICT   → block the delete if any child references it (Pagila's choice)
ON DELETE CASCADE    → delete the parent and auto-delete all its children
ON DELETE SET NULL   → keep the child, set its FK column to NULL
```

(There's a matching `ON UPDATE …` for when the parent's key value changes.)

---

## Deep Dive: How FKs Behave

### What Postgres does on every write

When a table has an FK, Postgres does extra work:

1. **On INSERT/UPDATE of the child** — it looks up the parent's primary key index to confirm the referenced row exists.
2. **On DELETE/UPDATE of the parent** — it checks whether any child rows reference it, then applies your action.

So every write to an FK column triggers a read on another table. Invisible at low volume; **measurable at 10k+ writes/sec.**

### CASCADE vs RESTRICT vs SET NULL — and what Pagila actually does

This is where the existing mental model often goes wrong, so look at the real constraints. **Almost every FK in Pagila is `ON UPDATE CASCADE ON DELETE RESTRICT`:**

```sql
ADD CONSTRAINT rental_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES customer(customer_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;
```

What that means in practice:

- **RESTRICT (delete):** the relationship chain `store → staff/inventory → rental → payment` exists, but Pagila does **not** cascade deletes. Try to `DELETE` a store that still has staff or inventory and you get a **foreign-key violation error** — the delete is blocked. To remove it you must delete children first, bottom-up. (Verify this in the exercises — the common belief that "deleting a store wipes thousands of rows" is *false* in Pagila precisely because of RESTRICT.)
- **CASCADE (update):** if a parent's key *value* changes, the new value propagates to children automatically. Rarely fires here because keys are stable sequence ids.

Now the three actions in general:

- **CASCADE** — convenient but dangerous: deleting one row can silently wipe thousands. Great for true ownership (delete an order → delete its line items); risky for shared data.
- **RESTRICT** — safe and explicit (Pagila's default). Forces your app to handle deletion order, which prevents accidents.
- **SET NULL** — for soft relationships: "this customer's preferred store was removed, but the customer remains." Requires the FK column to be nullable.

### When teams skip foreign keys

At very large scale, some teams drop FKs:

1. **Write throughput** — the parent lookup adds latency to every insert. At Uber/Shopify scale this overhead is real.
2. **Sharding** — an FK can't span shards. If `customer` lives on shard A and `rental` on shard B, Postgres can't enforce the reference.
3. **Microservice boundaries** — if `customer` and `rental` are owned by different services with separate databases, an FK is physically impossible.

**The trade:** you gain write speed/flexibility but lose the database-level guarantee. Orphans become possible, so you must enforce consistency in application code (or accept eventual consistency) and have a way to *detect* orphaned rows.

### The N+1 problem — often a schema/index decision

N+1 is when an ORM loads a parent, then fires one query per child (1 + N queries). People blame the ORM, but the root cause is frequently the schema:

- Junction tables (like `film_actor`) without indexes on the FK columns force sequential scans.
- Missing index on a child's FK column means Postgres can't efficiently find children.

> Postgres indexes the **parent's** primary key automatically, but **not** the child's FK column. You usually want an index on `rental.customer_id` yourself — without it, "find this customer's rentals" scans the whole table. (Indexes are Week 4.)

The fix is sometimes "use a JOIN instead of N queries," but just as often it's "add the right index on the FK column."

---

## Interview Tips

They want nuance, not dogma.

- "Always use FKs" is a junior answer; "never use FKs" is contrarian. The senior answer: *"FKs by default for integrity; I'd only drop them after measuring a specific write bottleneck or when crossing a shard/service boundary — and then I'd document the consistency guarantee I'm giving up and how I'd detect orphans."*
- Show you know the **referential actions** and can pick one with intent — and that you'd check what the schema *actually* uses (Pagila is RESTRICT, not CASCADE).
- Bonus: connect N+1 back to **indexing the FK column**, tying Week 3 to Week 4.
