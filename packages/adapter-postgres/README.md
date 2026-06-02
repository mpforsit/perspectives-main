# @perspectives/adapter-postgres

The PostgreSQL implementation of the engine's `DatabaseAdapter` interface — introspection, query/mutation execution, keyset pagination, and dialect metadata. This is the only package in the repository allowed to contain raw SQL strings.

## What's implemented

| Method | Status |
|---|---|
| `testConnection()` | ✅ — one round-trip, returns `ConnectionInfo` (server name + version, database, user, backend PID, measured latency). |
| `introspect()` | ✅ — full `SchemaSnapshot` covering schemas, tables, materialized views, views, columns (with comments), primary keys, foreign keys (compound, self-referential), indexes, and `pg_class.reltuples` row-count estimates. |
| `runQuery()` | ✅ — compiles a `QueryPlan` to parameterised SQL. Base table only (no joins yet). Filter trees become a parameterised WHERE; sort and limit are honoured. |
| `paginateKeyset()` | ✅ — keyset pagination using the user's sort + the table's primary key as the final tiebreaker. The cursor's external wire format is base64url-encoded JSON via `encodeCursor` / `decodeCursor`. |
| `countRows()` | ✅ — `SELECT COUNT(*) FROM (<plan>) sub`. Exact count, honours filters. |
| `estimateCount()` | ✅ — `pg_class.reltuples` for unfiltered plans, `EXPLAIN (FORMAT JSON)` `Plan Rows` for filtered ones. |
| `runMutation()` | ⏳ — next prompt. |

## How introspection works

Seven parallel queries against the system catalogs (`pg_catalog.*`, with `obj_description` / `col_description` helpers), assembled in JavaScript into the engine's `SchemaSnapshot` shape:

1. **Schemas** — `pg_namespace` minus `pg_catalog` / `information_schema` / `pg_toast` and other system schemas.
2. **Tables + views** — `pg_class` filtered by `relkind IN ('r','v','m')`; `relkind = 'v'` rows go into `SchemaInfo.views`, `relkind ∈ {'r','m'}` go into `SchemaInfo.tables` with the corresponding `kind`. View definitions come from `pg_get_viewdef`.
3. **Columns** — `pg_attribute` + `pg_type` for types; `format_type` for the human-readable type string; `col_description` for comments.
4. **Primary keys** — `pg_constraint` with `contype = 'p'`, using `unnest(conkey) WITH ORDINALITY` to preserve column order.
5. **Foreign keys** — `pg_constraint` with `contype = 'f'`, using `unnest(conkey, confkey) WITH ORDINALITY` so compound FKs round-trip with their column order intact. Self-referential FKs (where `conrelid = confrelid`) fall out of the same query without special casing.
6. **Indexes** — `pg_index` + `pg_class` + `pg_am`; `unnest(indkey) WITH ORDINALITY` for column order.

## How read queries compile

`runQuery(plan)` compiles `plan` to a single parameterised SELECT:

- **Projection**: each `ColumnDef` becomes either `"col"` (plain), `(expression)` (computed — see trust note below), with `AS "alias"` if specified. Joined-alias columns throw — joins land in Phase 3.
- **WHERE**: `compileFilterGroup` walks the recursive AND/OR tree. Every operator becomes a parameter; literal values bind as `$n`, never get string-interpolated. Operators: `eq`, `neq`, `lt`, `gt`, `lte`, `gte`, `in` / `nin` (via `= ANY($n)`), `like` / `ilike` / `not_ilike`, `is_null` / `is_not_null`, `between` (two params), `contains` / `contained_by` (`@>` / `<@`). Dynamic values: `{ kind: "today", offset }` compiles inline (`CURRENT_DATE + n`); other dynamic kinds throw until shared-mode lands.
- **ORDER BY**: each `SortDef` becomes `"col" ASC|DESC [NULLS FIRST|LAST]`.
- **LIMIT / OFFSET**: honoured if set.

### Trust boundary for `computed` columns

The DSL's `{ computed: "<sql>" }` column source inserts the expression *raw* into the SELECT list (wrapped in parens). That string is the perspective's content — already authored by a user who could just write a SQL-base perspective. The compiler does not validate or sanitise it; the trust boundary is the perspective storage layer (only authorised writers create perspectives).

## How pagination works

`paginateKeyset(plan, cursor?)`:

1. Look up the base table's primary key (cached per `(schema, table)` on the adapter).
2. Build the **effective sort** = user's sort + PK columns not already in the user's sort, all ASC. Pagination requires total ordering, so the PK fall-through is mandatory.
3. Compile the SELECT with `LIMIT pageSize + 1` so we can tell when there's a next page.
4. If a cursor was passed, AND in a keyset predicate. The predicate is the nested-OR expansion of `(c1, c2, ..., cN) > (v1, v2, ..., vN)`:

   ```
   (c1 > v1)
   OR (c1 = v1 AND c2 > v2)
   OR (c1 = v1 AND c2 = v2 AND c3 > v3)
   ...
   ```

   Each `>` flips to `<` when the corresponding sort column is `desc`, so per-column direction mixes work.
5. Run, slice off the extra row if present, and (if there were more rows) emit a `Cursor` whose `values` are the last returned row's sort+PK tuple.

### Cursor wire format

The engine's `Cursor` interface is structured: `{ values: Array<scalar>; direction: "forward" | "backward" }`. For transport across processes (renderer ↔ main, HTTP, persisted bookmarks), use the exported helpers:

```ts
import { encodeCursor, decodeCursor } from "@perspectives/adapter-postgres";

const token = encodeCursor(cursor);        // → base64url-encoded JSON string
const back  = decodeCursor(token);          // → Cursor
```

The encoded form is the wire shape the prompt called for; the structured form is what `paginateKeyset` consumes and produces internally.

## Error mapping

[`src/errors.ts`](src/errors.ts) translates pg failures into the engine's typed errors:

- Node-level network codes (`ECONNREFUSED`, `ETIMEDOUT`, `EHOSTUNREACH`, …) → `ConnectionError`.
- SQLSTATE class `08*` (connection exceptions), `28*` (auth), `57*` (operator intervention) → `ConnectionError`.
- `42P01` undefined_table, `42883` undefined_function → `NotFoundError`.
- `42703`, `42P02`, `42P18`, `22*`, `42601`, `42804`, `23502`, `23503`, `23514` → `ValidationError`.
- `23505` unique_violation → `ConflictError`.
- `42501` insufficient_privilege → `PermissionDeniedError`.
- Anything else → `ConnectionError` (preserves the message but doesn't pretend to know the category).

## Running the tests

Tests start a real Postgres container per file via [testcontainers](https://node.testcontainers.org/) and seed it with [`test/fixtures/seed.sql`](./test/fixtures/seed.sql). Requires Docker.

```sh
pnpm --filter adapter-postgres test
```

The first run pulls `postgres:16` (~150 MB). Subsequent runs use the cached image and finish in ~10 s.

## Manual UI testing

For exercising the eventual UI against a known schema, [`docker-compose.dev.yml`](../../docker-compose.dev.yml) at the repo root brings up the same seeded schema on `localhost:5433`:

```sh
docker compose -f docker-compose.dev.yml up -d
# host: localhost  port: 5433  database: perspectives_dev  user/password: perspectives/perspectives
```
