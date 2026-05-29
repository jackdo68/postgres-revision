# Week 1: Normalisation vs Denormalisation

## The Core Decision

Every schema starts with this question: **do I split the data into clean, non-redundant tables (normalise), or do I duplicate data to make reads faster (denormalise)?**

Neither is always right. The answer depends on your read/write ratio, how often the duplicated data changes, and whether you can tolerate stale data.

## What Normalisation Actually Means

Normalisation is about eliminating redundancy. In Pagila, actor names live in ONE place — the `actor` table. If an actor changes their name, you update one row. Every query that needs actor info joins to that table.

**Third Normal Form (3NF)** — the sweet spot for most OLTP systems:

- Every column depends on the primary key (1NF)
- Every column depends on the WHOLE primary key (2NF)
- Every column depends on NOTHING BUT the primary key (3NF)

Pagila's `film_actor` table is a textbook example — it contains only `film_id` and `actor_id`. No duplicated names, no redundant data.

## What Denormalisation Looks Like

You take data that lives in separate tables and flatten it into one. Example: instead of joining `film → film_actor → actor` every time, you store the actor names directly on the film row (e.g. as a text array or comma-separated string).

**The tradeoff:**
- Reads get faster (no joins)
- Writes get slower (update one actor name → update every film they're in)
- Data can become inconsistent (actor name updated in `actor` but not in the denormalised column)

## When to Normalise

- The data changes frequently (e.g. user profiles, account balances)
- Consistency matters more than read speed (financial systems, inventory)
- You don't know your query patterns yet (normalised schemas are more flexible)

## When to Denormalise

- Read-heavy workloads (dashboards, reports, search results)
- The duplicated data rarely changes (country names, category labels)
- You've measured a join bottleneck with EXPLAIN ANALYZE (not guessed)
- You're building a read model / materialised view for a specific query

## What Interviewers Look For

They want to hear: "It depends on the access pattern." Then they want a concrete example. Pagila is perfect for this — you can talk about how `film_actor` is normalised, but if you're building a search page showing "Film X starring Actor A, Actor B" thousands of times per second, you might denormalise actor names onto the film row.

The red flag answer is "always normalise" or "always denormalise." The green flag is demonstrating you've felt the pain of both and can articulate when each is appropriate.
