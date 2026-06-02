# Perspectives — Phase 1 prompts for AI-assisted coding

Phase 1 reaches the "TablePlus floor": connect to Postgres, browse the schema, open tables, scroll through millions of rows, run read-only SQL. Local-only, nothing editable yet.

Same discipline as Phase 0: **one prompt = one commit.** Verify after each. The prompts get terser as the AI accumulates context — that's intentional.

---

## What changed since Phase 0 (read before starting)

- **Phase 1 needs a real Postgres.** Phase 0 forbade tests that needed a database. That rule is now lifted *for the adapter and engine packages only*. Use **testcontainers** so tests spin up an ephemeral Postgres, seed it, assert, and tear down. The DSL and UI packages stay pure-unit.
- **You have a verified seed database.** The file `seed.sql` (provided alongside this document) creates a sample schema that exercises every relationship shape the product must eventually handle: n:1, 1:n, m:n (junction), self-referential, and a **compound foreign key**, plus a view and table/column comments. It has been run against Postgres 16 and verified. Use it both for testcontainers seeding and for local manual testing. Do not let the AI invent its own schema.
- **The grid is the centerpiece of this phase.** Budget real time for prompt 1.7. Everything the user sees hangs off it.

Keep these files in the AI's context throughout Phase 1: `docs/plan.md`, `docs/architecture.md`, `packages/dsl/src/schemas.ts`, `packages/engine/src/adapter.ts`, `packages/engine/src/metadata.ts`, and `seed.sql`.

---

## System primer addendum (paste once at session start, after the Phase 0 primer)

```
We are now in Phase 1 (read-only DB browser) per docs/plan.md §7. Rules that
join the Phase 0 hard rules:

- The adapter and engine packages may have tests that use a real Postgres via
  testcontainers. The DSL and UI packages stay pure-unit — no database.
- seed.sql in the repo root is the canonical sample schema. Tests seed an
  ephemeral Postgres with it. Do not invent alternative schemas.
- No raw SQL strings leave packages/adapter-postgres. The engine and UI speak
  QueryPlan / structured objects. The adapter compiles them to SQL.
- Connection credentials are local-only and never logged. Passwords are stored
  via Electron safeStorage (OS keychain), never in plaintext in SQLite.
- Everything read-only this phase. No INSERT/UPDATE/DELETE code paths. The SQL
  console runs inside a READ ONLY transaction so writes fail at the database.
- Keyset pagination, never OFFSET, for table browsing.

Stop when the Phase 1 deliverables in docs/plan.md are met. Do not start Phase 2
(relation navigation) even though the seed schema supports it.
```

---

## Prompt 1.1 — Postgres adapter: connection + introspection + test harness

```
Create packages/adapter-postgres implementing the connection and introspection
parts of the DatabaseAdapter interface from packages/engine/src/adapter.ts.

Dependencies: pg, and for tests: testcontainers, vitest.

Implement:
- A PostgresAdapter class constructed from a ConnectionProfile (host, port,
  database, user, password, sslMode, applicationName). Use a pg.Pool.
- testConnection(): returns ConnectionInfo (server version, current database,
  current user). Maps connection failures to the engine's ConnectionError.
- introspect(): returns a complete SchemaSnapshot. It must discover, querying
  the system catalogs (pg_catalog / information_schema):
    * schemas (exclude pg_catalog and information_schema)
    * tables AND views, distinguished by kind
    * columns: name, ordinal, data type, nullable, default, comment
    * primary keys
    * foreign keys INCLUDING COMPOUND ones — group columns by constraint name
      and preserve column order; capture referenced table + referenced columns
    * unique constraints
    * indexes (name, columns, unique flag)
    * table comments and column comments
  Self-referential foreign keys (conrelid = confrelid) must be represented
  correctly, not dropped.

Test harness:
- A vitest setup that starts a Postgres container with testcontainers, runs
  seed.sql against it, and exposes a connection profile to tests. Reuse one
  container per test file.
- Tests asserting introspection finds: the `customers` table with its comment,
  the `lifetime_value` column comment, the compound FK
  `inventory_warehouse_fk` over (tenant_id, warehouse_code) -> warehouses,
  the self-referential FK on `employees.manager_id`, the `active_customers`
  VIEW classified as a view (not a table), and the `customer_tags` table with
  a two-column primary key.

Also add a docker-compose.dev.yml at the repo root that brings up Postgres on
port 5433 seeded with seed.sql, for manual UI testing later in the phase.

Do NOT implement runQuery/pagination yet — that's the next prompt.
```

**Verify:** `pnpm --filter adapter-postgres test` passes against a real container. Manually confirm `docker compose -f docker-compose.dev.yml up` gives you a browsable DB.

---

## Prompt 1.2 — Postgres adapter: read queries, keyset pagination, counts

```
Extend packages/adapter-postgres with the read-query parts of DatabaseAdapter.

Implement:
- runQuery(plan: QueryPlan): compile a QueryPlan to parameterized SQL and run
  it. For this phase a plan selects: a base table, a list of columns (plain
  columns and computed SQL expressions), a sort spec, an optional FilterGroup
  (compile AND/OR trees to a parameterized WHERE — we'll need equality filters
  for Phase 2 navigation, so build the compiler now), and a limit. NO joins yet.
  Use parameterized queries ($1, $2, ...) — never string-interpolate values.
- paginateKeyset(plan, cursor?): keyset pagination. The effective sort is the
  plan's sort columns plus the primary key as a final tiebreaker (so ordering
  is total and stable). Encode the cursor as the tuple of the last row's sort+pk
  values, base64-encoded JSON. Decode and apply as a row-comparison predicate.
  Returns a page of rows plus the next cursor (null when exhausted).
- countRows(plan): exact COUNT(*) honoring the plan's filters.
- estimateCount(plan): fast estimate from pg_class.reltuples for an unfiltered
  table; for filtered plans fall back to EXPLAIN (FORMAT JSON) row estimate.
- A dialect metadata object: identifier quoting, supported operators, etc.
- Map common pg error codes to the engine error hierarchy (ConnectionError,
  ValidationError, etc.).

Tests against the seeded container:
- Paginate fully through `orders` (9000 rows) in pages of 500 using only the
  cursor; assert every row appears exactly once and none is skipped (collect
  ids into a Set, assert size == 9000 and matches a direct SELECT).
- Sort by a non-unique column (status) and confirm the pk tiebreaker keeps
  pagination stable.
- countRows on customers returns 3000; estimateCount returns a positive number
  of the right order of magnitude.
- A filtered plan (country_code = 'DE') returns only matching rows.
```

**Verify:** The pagination round-trip test is the important one — keyset bugs cause skipped or duplicated rows under load. If it passes against 9000 rows, the algorithm is sound.

---

## Prompt 1.3 — SQLite metadata store

```
Create packages/metadata-sqlite implementing the MetadataStore interface from
packages/engine/src/metadata.ts using better-sqlite3.

- A tiny migration runner (numbered .sql migrations applied in order, tracked
  in a _migrations table).
- Tables backing every MetadataStore collection: connection profiles,
  perspectives, relations, display configs, settings (kv), audit log. Create
  them all now even though only connections + settings are exercised this phase
  — implementing the full interface keeps the seams honest.
- Persisted DSL objects (perspectives, relations, displayConfig) are stored as
  JSON text and MUST be validated through the packages/dsl validators on both
  write and read. Reject invalid writes; on read, surface a typed error rather
  than returning a malformed object.
- CRITICAL — credential handling: ConnectionProfile rows store everything
  EXCEPT the password. The password is handed to a CredentialStore abstraction
  (interface defined here, with a no-op/in-memory impl for tests). The real
  Electron implementation comes in prompt 1.5 using safeStorage. Never write a
  password into SQLite. Add a test that scans the SQLite file contents after
  saving a profile and fails if the password string appears anywhere in it.

Tests (no Postgres needed — pure SQLite):
- CRUD round-trips for connection profiles and settings.
- Saving an invalid perspective (fails DSL validation) is rejected.
- The password-leak guard test described above.
- Migration runner applies cleanly to a fresh file and is idempotent.
```

**Verify:** The password-leak test is the one that matters. Confirm it actually fails if you temporarily make the store write the password in — then revert.

---

## Prompt 1.4 — Engine service + tRPC procedures

```
Add an orchestration layer in packages/engine and expose it over tRPC from the
Electron main process.

In packages/engine:
- An EngineService that holds: the MetadataStore, a CredentialStore, and a map
  of active adapter instances keyed by connection id. Methods:
    listConnections / createConnection / updateConnection / deleteConnection
    testConnection(profile)
    connect(connectionId) / disconnect(connectionId)
    getSchema(connectionId) -> SchemaSnapshot (cached per connection; refresh
      method to invalidate)
    getTablePage(connectionId, {schema, table, sort, cursor, pageSize})
    countTable / estimateTable
- The service depends only on the interfaces, not on adapter-postgres or
  metadata-sqlite directly — those are injected at composition time.

In apps/desktop main process:
- Compose the EngineService with PostgresAdapter, SqliteMetadataStore, and the
  (still stub) CredentialStore.
- Expand the tRPC router with routers: connections, schema, data — mapping to
  the EngineService methods above. Validate all inputs with zod.

Tests:
- A tRPC-level integration test that, against a testcontainers Postgres seeded
  with seed.sql, creates a connection, connects, introspects, and fetches the
  first page of `customers` through the full stack.
```

**Verify:** This is the first end-to-end slice through every layer. If the integration test is green, the architecture's seams are sound.

---

## Prompt 1.5 — Connection manager UI + real credential storage

```
Build the connection manager UI in the renderer, and the real Electron
CredentialStore.

CredentialStore (main process):
- Implement using Electron safeStorage (encryptString/decryptString) so the
  password is encrypted with an OS-backed key. Store the encrypted blob in
  SQLite as a separate secrets table keyed by connection id, or in userData —
  your call, but the plaintext password must never touch disk unencrypted and
  must never be logged.

UI (renderer):
- An empty-state screen for fresh installs: "Add your first connection".
- A connection list (sidebar or dialog) with add / edit / delete.
- A connection form (shadcn dialog or sheet): name, host, port (default 5432),
  database, user, password, SSL mode (disable/prefer/require/verify-ca/
  verify-full), application name (default "Perspectives").
- A "Test connection" button calling connections.test, showing success
  (server version) or a friendly mapped error.
- On successful connect, the schema sidebar (next prompt) becomes populated.

Use the tRPC connections router. No credentials in React state longer than the
form submission requires; never put a password in a query cache.

Tests: a component test for the form's validation logic (pure, no Electron).
```

**Verify:** Add a connection pointing at your `docker compose` Postgres (localhost:5433). Test connection succeeds. Quit and relaunch the app — the connection persists, and the password was never written in plaintext (check the SQLite file).

---

## Prompt 1.6 — Schema sidebar

```
Build the schema sidebar in the renderer, populated from schema.introspect.

- A tree: connection -> schema -> grouped (Tables, Views, Functions) -> items.
  (A Postgres connection targets one database with multiple schemas.)
- Distinct icons for tables vs views.
- A search/filter box that filters the tree by name as you type, keeping
  matching items' ancestors visible.
- Clicking a table or view opens it in a new tab (the table view from the next
  prompt — for now, opening can be a placeholder that shows the selected
  table's name; wire the real grid in 1.8).
- A manual "Refresh schema" affordance that calls the cache-invalidating
  refresh on the engine.
- Loading and error states.

Keep the tree virtualized only if a schema has hundreds of tables — otherwise
plain rendering is fine. Don't over-engineer.
```

**Verify:** Against the seeded DB you should see `public` with customers, orders, products, employees, companies, order_items, tags, customer_tags, warehouses, inventory under Tables, and `active_customers` under Views. Search narrows the tree.

---

## Prompt 1.7 — The grid component (the centerpiece)

```
Build a reusable data grid component in packages/ui (or apps/desktop renderer
shared components) using TanStack Table (headless) + TanStack Virtual for row
virtualization. Consult the frontend-design guidance for styling quality — this
is the component the whole product is judged on.

Requirements:
- Props: column definitions (each with name, db type, optional width), row data,
  loading state, a sort spec + onSortChange, and an onReachEnd callback for
  incremental loading.
- Row virtualization: smooth scrolling with 100k+ rows held in memory.
- Type-aware cell rendering: NULL shown distinctly (muted "NULL"), booleans as a
  clear true/false indicator, numbers right-aligned, timestamps formatted,
  json/array values shown truncated with an affordance to expand (the modal
  comes in 1.9).
- Column resizing by dragging the header edge; persist widths in component
  state for now.
- Click a column header to cycle sort (asc -> desc -> none), surfaced via
  onSortChange.
- Cell selection with keyboard navigation (arrows), and copy: Cmd/Ctrl+C copies
  the focused cell; a row context action copies the row as JSON/TSV.
- Sticky header; a left gutter showing row numbers.
- Empty state and loading skeleton.

Build it against mock data first (a stories-style harness or a dev route) so it
can be developed without the database. No data fetching inside the grid — it is
a pure presentation + interaction component.
```

**Verify:** Feed it 100k mock rows in a dev harness. Scrolling is smooth, sorting fires callbacks, resize works, keyboard nav and copy work. Resist scope creep — editing is Phase 4.

---

## Prompt 1.8 — Table view (grid + data, keyset pagination)

```
Wire the grid to live data to create the table view, opened from the schema
sidebar.

- Opening a table creates a tab. Multiple tabs can be open; tabs are closeable
  and the active tab is restored on relaunch (persist open tabs in settings).
- On open: fetch the estimated row count (show immediately, e.g. "~9,000 rows")
  and the first keyset page via data.getTablePage. Show columns from the schema
  snapshot with their types.
- Infinite scroll: when the grid's onReachEnd fires, fetch the next keyset page
  using the returned cursor and append. Use TanStack Query for caching/loading.
- Clicking a header to change sort resets pagination and refetches from the
  first page with the new sort.
- An "exact count" control that calls countTable and replaces the estimate.
- A "Refresh" button that refetches from the first page.
- A page-size selector (default 100 or 200).

Tests: a hook-level test for the pagination/append logic using a mocked tRPC
client (no real DB in the renderer tests).
```

**Verify:** Open `orders` against the seeded DB. The estimate appears instantly; scrolling loads more pages seamlessly; sorting by `placed_at` works and stays stable; exact count returns 9,000.

---

## Prompt 1.9 — Cell expansion modal

```
Add a cell detail view for inspecting large or structured values.

- Triggered from the grid (expand affordance on truncated cells, or a keyboard
  shortcut on the focused cell).
- Renders in a side panel or modal: plain long text wrapped and scrollable;
  JSON pretty-printed with a collapsible tree; arrays as a readable list;
  binary/bytea as a note rather than garbage.
- A copy button for the raw value.
- Read-only — no editing here this phase.
```

**Verify:** Find a row with a timestamp/numeric and confirm formatting; if you add a jsonb column locally, confirm the tree view. Copy works.

---

## Prompt 1.10 — Read-only SQL console

```
Add a SQL console tab.

- A SQL editor using CodeMirror 6 with PostgreSQL syntax highlighting. Bonus:
  autocomplete table and column names from the active connection's schema
  snapshot.
- Run with Cmd/Ctrl+Enter (and a Run button).
- READ-ONLY ENFORCEMENT: execute each run inside a transaction opened with
  BEGIN TRANSACTION READ ONLY, then ROLLBACK. Any write statement fails at the
  database level — this is more robust than trying to parse SQL for safety.
  Add a new engine method runReadOnlyQuery(connectionId, sql) for this; it does
  NOT go through the QueryPlan compiler (raw SQL is the user's, run as-is but
  read-only).
- Results render in the same grid component from 1.7. Column types come from the
  result's field metadata.
- Show execution time and row count. Show mapped errors clearly.
- A local query history (last N queries) stored in settings; click to reload.

Tests: an engine test against the seeded container confirming a SELECT returns
rows and an UPDATE attempt raises a read-only-transaction error.
```

**Verify:** Run `SELECT * FROM customers LIMIT 50` — rows appear in the grid. Run an `UPDATE` — it fails with a clear read-only error. History remembers your queries.

---

## Definition of done for Phase 1

- Fresh install → add a connection → browse schema → open any table → scroll
  through all rows smoothly → run read-only SQL. All working.
- `pnpm typecheck && pnpm lint && pnpm test` green from a clean clone (adapter
  and engine tests use testcontainers; CI must have Docker available — update
  the CI workflow to start Docker / use a Postgres service or testcontainers).
- Passwords are encrypted via safeStorage; the leak-guard test passes.
- Keyset pagination verified correct over thousands of rows.
- Nothing is editable anywhere.

**The Phase 1 screencast:** "Connect, browse, scroll a huge table without lag,
run a query." If it feels as smooth as TablePlus, you've hit the floor and
earned the right to build the things that make Perspectives better — which is
Phase 2.

---

## Common failure modes specific to Phase 1

- **OFFSET pagination sneaks in.** The AI may reach for `LIMIT n OFFSET m` because
  it's simpler. Reject it — it's O(n) per page and corrupts under concurrent
  writes. Keyset only.
- **String-interpolated SQL.** Any value placed directly into a SQL string
  instead of a bound parameter is both an injection risk and a bug. All values
  are parameters.
- **Credentials in logs or query cache.** Watch for the password landing in a
  console.log, an error object, or a TanStack Query cache key. The leak-guard
  test only covers SQLite; stay alert to the others in review.
- **The grid grows a data-fetching brain.** Keep the grid presentational. Data
  fetching lives in the table view (1.8), not the grid (1.7). Mixing them makes
  the SQL console (1.10) unable to reuse the grid.
- **Introspection misses compound or self-referential FKs.** The seed has both
  precisely so the tests catch this. If the FK tests pass, you're covered.
- **Tests try to reuse a single shared container badly.** Start one container
  per test file, seed once, and make tests read-only so they don't interfere.

---

## After Phase 1

Phase 2 (smart navigation) is where Perspectives stops being a TablePlus clone.
The seed database already contains everything you need to build and demo it:
forward and reverse FK jumps (customers <-> orders), a junction for m:n
(customer_tags), a self-referential relation (employees), and a compound FK
(inventory -> warehouses). Derive Phase 2 prompts from docs/plan.md §7 in the
same one-prompt-per-commit shape when you're ready.
