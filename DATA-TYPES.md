# Common Data Types

A quick reference to the PostgreSQL data types you'll reach for most often. Each row: what it is, when to use it, and a gotcha to remember. Examples reference the Pagila schema where relevant.

## Numbers

| Type | Range / Size | Use it for | Watch out for |
|------|-------------|------------|---------------|
| `smallint` | -32K to 32K (2 bytes) | Tiny counters, enums-as-ints | Overflows fast |
| `integer` / `int` | ±2.1 billion (4 bytes) | Default whole number, FKs, IDs | `SERIAL` is just `int` + auto-increment |
| `bigint` | ±9.2 quintillion (8 bytes) | High-volume IDs, big counts | Use for IDs that may exceed 2.1B rows |
| `numeric(p,s)` / `decimal` | Exact, arbitrary precision | **Money**, anything where rounding is unacceptable | Slower than int/float; always set precision/scale |
| `real` / `double precision` | Approximate floating point | Scientific values, ratios | Never use for money — `0.1 + 0.2 != 0.3` |
| `serial` / `bigserial` | Auto-incrementing int/bigint | Legacy auto IDs | Prefer `GENERATED ALWAYS AS IDENTITY` in new schemas |

*Pagila:* `film.film_id` is `int` (via a sequence); `payment.amount` is `numeric(5,2)`.

## Text

| Type | Use it for | Watch out for |
|------|------------|---------------|
| `text` | Default for any string, any length | No real downside — prefer this |
| `varchar(n)` | String with a **business** length limit | The limit is a constraint, not a perf win |
| `char(n)` | Fixed-length codes (rare) | Pads with spaces — almost never what you want |

**Shortcut:** in Postgres, `text` and `varchar` perform identically. Reach for `text` unless you genuinely need to cap length.

*Pagila:* `film.title` is `varchar(255)`, `film.description` is `text`.

## Boolean

| Type | Use it for | Watch out for |
|------|------------|---------------|
| `boolean` | True/false flags | Accepts `true/false`, `'t'/'f'`, `1/0`; can be `NULL` (three states!) |

## Dates & Times

| Type | Use it for | Watch out for |
|------|------------|---------------|
| `date` | Calendar day, no time | — |
| `time` | Time of day, no date | Rarely useful alone |
| `timestamp` | Date + time, **no zone** | Ambiguous across timezones — usually the wrong choice |
| `timestamptz` | Date + time, zone-aware | **Default for any real timestamp** — stores UTC, converts on read |
| `interval` | A duration (`'2 days'`, `'3 hours'`) | Great for date math |

**Shortcut:** almost always use `timestamptz`, not `timestamp`.

*Pagila:* `rental.rental_date`, `payment.payment_date` are `timestamp` (note: a `timestamptz` would be the modern choice).

## Identity & Special

| Type | Use it for | Watch out for |
|------|------------|---------------|
| `uuid` | Distributed/random IDs | Random UUIDs hurt B-tree locality (Week 2) — consider UUIDv7/ULID |
| `bytea` | Raw binary blobs | Prefer storing files externally, keep a path in the DB |
| `inet` / `cidr` | IP addresses / networks | Purpose-built — beats storing IPs as text |
| `ENUM` | Fixed small set of labels | Adding/reordering values needs DDL; a lookup table is often more flexible |

## Semi-structured

| Type | Use it for | Watch out for |
|------|------------|---------------|
| `json` | Raw JSON, preserved exactly | Stored as text — slow to query, keeps whitespace/key order |
| `jsonb` | Queryable JSON (Week 6) | Binary, indexable with GIN; loses key order & duplicate keys |
| `array` (`int[]`, `text[]`) | Small ordered lists on a row | Don't use to dodge a proper join table for real relationships |
| `tsvector` | Full-text search documents | Pair with a GIN index (Week 4) |

*Pagila:* `film.fulltext` is a `tsvector`; `film.special_features` is a `text[]`.

## Picking instincts

- **Whole number?** `int`, jump to `bigint` if it could exceed ~2 billion.
- **Money?** `numeric` — never floating point.
- **Timestamp?** `timestamptz`.
- **String?** `text`.
- **A flexible blob of attributes?** `jsonb` — but ask first whether columns would be better (Week 6).
