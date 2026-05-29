# Week 3: Relationships & Foreign Keys

## The Core Decision

Foreign keys enforce data integrity at the database level. They guarantee that a `rental.customer_id` always points to a real customer. Sounds like an obvious win — so why do some teams skip them?

## How Foreign Keys Work in Postgres

When you define a FK, Postgres does two things on every INSERT/UPDATE to the child table:

1. **Checks the parent table** — does the referenced row exist? This is a lookup against the parent's primary key index.
2. **On DELETE/UPDATE of the parent** — Postgres checks if any child rows reference it, then applies your chosen action.

This means every write to a FK column triggers a read on another table. At low volume, invisible. At 10k+ writes/sec, measurable.

## CASCADE, RESTRICT, SET NULL — The Three Actions

```
ON DELETE CASCADE    — delete parent → auto-delete all children
ON DELETE RESTRICT   — delete parent → error if children exist (default)
ON DELETE SET NULL   — delete parent → set FK column to NULL in children
```

**CASCADE** is powerful but dangerous. Deleting a `store` could cascade through `staff → rental → payment` and wipe thousands of rows. In Pagila, this chain exists — try it in the exercises.

**RESTRICT** is safe but requires your application to handle the ordering — delete children first, then parent.

**SET NULL** is useful for soft relationships — "this customer's preferred store was deleted, but the customer still exists."

## When Teams Skip Foreign Keys

Large-scale systems sometimes drop FKs for:

1. **Write throughput** — FK checks add latency to every insert. At massive scale (Uber, Shopify), this overhead matters.
2. **Sharded databases** — FKs can't span shards. If `customer` lives on shard A and `rental` on shard B, Postgres can't enforce the reference.
3. **Microservice boundaries** — if `customer` and `rental` are in different services with different databases, FKs are physically impossible.

**The tradeoff:** you gain write speed but lose the database-level guarantee. Orphaned rows become possible. You must enforce consistency in application code or accept eventual consistency.

## The N+1 Problem — A Schema Decision

N+1 queries happen when your ORM fetches a parent, then fires one query per child. But the root cause is often a schema decision:

- Junction tables without proper indexes force sequential scans
- Missing composite indexes on FK columns mean Postgres can't efficiently find children
- Lazy loading defaults in ORMs hide the cost until production

The fix isn't always "just use a JOIN" — sometimes it's "add the right index on the FK column."

## What Interviewers Look For

They want nuance, not dogma. "Always use FKs" is a junior answer. "Never use FKs" is a contrarian answer. The senior answer is: "I use FKs by default for data integrity, and I'd only drop them after measuring a specific write bottleneck or when crossing service boundaries. When I do skip them, I document the consistency guarantee I'm giving up and how I'll detect orphaned data."
