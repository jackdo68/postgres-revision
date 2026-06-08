# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a PostgreSQL learning repository with a Docker-based development environment. The repository follows a CLI-first approach to PostgreSQL development, emphasizing practical hands-on learning with production-grade tools.

## Database Setup

### Starting the PostgreSQL Database

```bash
docker-compose up -d
```

This starts a PostgreSQL 17 container with:
- **User**: devuser
- **Password**: devpass
- **Database**: devdb
- **Port**: 5432
- **Container name**: postgres_dev

### Connecting to the Database

Using pgcli (recommended):
```bash
pgcli -h localhost -U devuser -d devdb
```

Using standard psql:
```bash
psql -h localhost -U devuser -d devdb
```

Password prompt will appear; use `devpass`.

### Stopping the Database

```bash
docker-compose down
```

To remove data volumes as well:
```bash
docker-compose down -v
```

## Learning Path

The README.md document provides a structured 12-week learning progression for PostgreSQL mastery. Key phases:

1. **Weeks 1-2**: CLI workflow basics, pgcli, and PGExercises
2. **Weeks 3-4**: Indexes, query planning, and migrations
3. **Weeks 5-8**: MVCC internals, vacuum, and connection pooling
4. **Weeks 9-12**: Partitioning, zero-downtime migrations, and monitoring

## Schema Design Course (`courses/`)

A separate 6-week interview-prep course on SQL schema design, built on the **Pagila** sample database (DVD rental schema). See [courses/README.md](courses/README.md) for the practice loop and prerequisites.

Each week lives in its own folder `week-N-<topic>/` containing three files: `lesson.md`, `exercises.md`, `solutions.md`:

| Week | Topic | Folder |
|------|-------|--------|
| 1 | Normalisation vs Denormalisation | `week-1-normalisation/` |
| 2 | Keys & IDs (SERIAL vs UUID vs ULID) | `week-2-keys-and-ids/` |
| 3 | Relationships & Foreign Keys | `week-3-relationships-and-fks/` |
| 4 | Indexes | `week-4-indexes/` |
| 5 | Zero-Downtime Migrations | `week-5-zero-downtime-migrations/` |
| 6 | JSONB & NoSQL-in-SQL | `week-6-jsonb/` |

- **`lesson.md`** — concept, tradeoffs, what interviewers look for
- **`exercises.md`** — hands-on SQL tasks against Pagila with `EXPLAIN ANALYZE` drills
- **`solutions.md`** — answers, expected plans, and interview talking points

**Prerequisite:** the course expects Pagila to be loaded into the `devdb` database (`pagila-schema.sql` + `pagila-data.sql`), which is separate from the `clubdata` database used elsewhere in this repo.

### Lesson structure convention

Each `lesson.md` follows this order: **Introduction** (what we're learning + one-sentence takeaway) → **Key Concepts** (vocabulary defined simply) → **Deep Dive** (the actual topic) → **Interview Tips**. Writing should be concise and understandable by someone with minimal PostgreSQL knowledge.

### Worked-example format (reference)

When adding teaching examples, follow the format used in the **3NF section of `week-1-normalisation/lesson.md`** ("Each rule with a Pagila example"). It is the canonical style for this project. The pattern:

1. **State the rule in plain language**, then show a concrete example.
2. **Show the *bad* table first** as a small ASCII table, using **real Pagila tables and real data values** (e.g. `address_id 1 = "47 MySakila Drive"`, `city_id 300 = Lethbridge`, `country = Canada`). Name bad tables with a `_bad` suffix.
3. **Annotate the problem inline** with `←` arrows pointing at the offending column/row (e.g. `← repeated for every film the actor is in`).
4. **Explain *why* it breaks** in one or two sentences.
5. **Show the fix**, ideally mapping to how real Pagila already models it.
6. **End with a one-line "shortcut"/instinct** the reader can remember.

**Comparison rule:** whenever explaining a comparison (X vs Y), present it as **both** a short set of dot points (the headline difference per option) **and** a table (attribute rows, one column per option). See the "OLTP vs OLAP" comparison in `week-1-normalisation/lesson.md` for the canonical format. Do not bury a comparison in a prose paragraph.

**Accuracy rule:** always verify example values (IDs, counts, column types, FK actions) against `pagila-data.sql` / `pagila-schema.sql` before writing them — do not guess. Pagila here is the 2022 edition (dates are 2022, `payment` is partitioned by month).

**Markdown policy reminder:** only create or edit `.md` files when the user explicitly asks (per global instructions).

## Recommended Sample Databases

### Clubdata (PGExercises database)

```bash
# Download clubdata.sql from pgexercises.com
# Then load it (creates 'exercises' database automatically)
psql -h localhost -U devuser -f clubdata.sql

# Connect to the exercises database
pgcli -h localhost -U devuser -d exercises

# Set search path to access tables easily
SET search_path TO cd, public;
```

The clubdata database contains three tables in the `cd` schema: `members`, `facilities`, and `bookings`. See **clubdata-schema.txt** for the complete schema diagram.

### pgbench (benchmark data)

```bash
pgbench -h localhost -U devuser -i -s 10 devdb
```

## Key Tools and Commands

### Essential psql Meta-Commands

- `\l+` - List databases with sizes
- `\dt+` - List tables with sizes
- `\d+ tablename` - Detailed table structure
- `\di` - List indexes
- `\x auto` - Toggle expanded display
- `\timing` - Show query execution time

### Performance Monitoring

Enable pg_stat_statements for query performance tracking:

```sql
-- Must be added to postgresql.conf first
CREATE EXTENSION pg_stat_statements;

-- Find slowest queries
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC LIMIT 10;
```

### Migration Tool (golang-migrate)

```bash
# Create new migration
migrate create -ext sql -dir db/migrations -seq migration_name

# Apply migrations
migrate -database "postgres://devuser:devpass@localhost:5432/devdb?sslmode=disable" \
        -path db/migrations up

# Rollback one migration
migrate -database "postgres://devuser:devpass@localhost:5432/devdb?sslmode=disable" \
        -path db/migrations down 1
```

## Architecture Notes

- **Isolation**: Docker-based PostgreSQL for reproducible environments
- **Version**: PostgreSQL 17 Alpine
- **Data Persistence**: Named volume `postgres_data` ensures data survives container restarts
- **Learning Focus**: CLI-first workflow using pgcli, golang-migrate, and pg_stat_statements

## References

- Official PostgreSQL docs: postgresql.org/docs/current
- The Internals of PostgreSQL: interdb.jp/pg
- PGExercises: pgexercises.com
- pgcli: github.com/dbcli/pgcli
- golang-migrate: github.com/golang-migrate/migrate
- when I ask for some command, if they are not existed in COMMANDS.md, after answer my question also confirm with me if I want to add this new command to the markdown file