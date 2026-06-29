# SQL Schema Design — Hands-On Course

A 6-week practice course using the **Pagila** database (DVD rental schema). Every exercise runs against real tables with real data. The goal: build schema design instincts for production systems and interviews.

> **About Pagila:** Pagila is a well-known open-source PostgreSQL sample database — a port of MySQL's Sakila — modelling a DVD rental store. We use it because it has realistic, interconnected tables (films, actors, customers, rentals, payments) plus production-grade features like partitioning, full-text search, and triggers. Source: [github.com/xzilla/pagila](https://github.com/xzilla/pagila).

## Prerequisites

```bash
# Start Pagila locally
docker-compose up -d
psql -h localhost -U devuser -d devdb -f pagila-schema.sql
psql -h localhost -U devuser -d devdb -f pagila-data.sql
```

Recommended tools: `pgcli` for daily work, `EXPLAIN ANALYZE` as a reflex.

## Pagila Schema Overview

```
Core entities:
  film, actor, category, language, store, staff, customer

Relationships:
  film ↔ actor       (many-to-many via film_actor)
  film ↔ category    (many-to-many via film_category)
  film → language     (FK)
  inventory → film, store
  rental → inventory, customer, staff
  payment → customer, staff, rental
  customer → store, address
  address → city → country

Special features:
  - payment is PARTITIONED by date range
  - film has a tsvector fulltext column
  - last_update triggers on most tables
  - rewards_report stored function
```

## Weekly Schedule

| Week | Topic | Key Question |
|------|-------|-------------|
| 1 | Normalisation vs Denormalisation | When do joins hurt more than duplication? |
| 2 | Keys & IDs | SERIAL vs UUID vs ULID — what breaks at scale? |
| 3 | Relationships & Foreign Keys | When should you skip FKs? |
| 4 | Indexes | Which index type for which access pattern? |
| 5 | Zero-Downtime Migrations | How do you rename a column without downtime? |
| 6 | JSONB & The NoSQL-in-SQL Question | When does JSONB beat a proper table? |

## How to Use This Course

Each week has three files:

- **LESSON.md** — Concept explanation, tradeoffs, and what interviewers look for
- **EXERCISES.md** — Hands-on SQL tasks against Pagila (run them yourself)
- **SOLUTIONS.md** — Answers, expected EXPLAIN output, and interview talking points

### The Practice Loop

1. Read the lesson (~10 min)
2. Do the exercises against your local Pagila (~45-60 min)
3. Check solutions and compare your EXPLAIN output
4. Write a 3-sentence summary of the key tradeoff in `NOTES.md` (interview prep)

### Interview Readiness Checklist

After completing all 6 weeks, you should be able to:

- [ ] Explain normalisation vs denormalisation tradeoffs with a real example
- [ ] Justify your choice of primary key type for a high-write system
- [ ] Describe when you'd skip foreign keys and why
- [ ] Read an EXPLAIN ANALYZE plan and identify the bottleneck
- [ ] Walk through a zero-downtime migration step by step
- [ ] Explain when JSONB is the right call vs a relational table

## Your Notes

Create a `NOTES.md` file as you go — this becomes your interview cheat sheet.
