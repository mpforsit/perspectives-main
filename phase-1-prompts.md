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

## Pre-flight: things that turned out to be load-bearing

These didn't fit into a single prompt but bite at integration time. Surface them early in your system primer so the AI doesn't have to discover them the hard way.

- **Native module ABI dance.** `better-sqlite3` (and any future native dep) ships one `.node` binary at a time. Electron uses a different Node ABI from system Node — building for one breaks the other. Add `rebuild:electron` and `rebuild:node` scripts using `@electron/rebuild`. Run before `pnpm dev` and before `pnpm test` respectively. Document this in the package README; otherwise the agent burns half an hour rediscovering it.
- **electron-vite externalize exclusions.** Workspace packages that publish TS source (`"exports": "./src/index.ts"`) cannot be `require()`'d by the Electron main process. Add every `@perspectives/*` package plus pure-ESM deps (e.g., `superjson`) to `externalizeDepsPlugin({ exclude: [...] })` so they're inlined. Keep native deps (`pg`, `better-sqlite3`) external.
- **`ELECTRON_RUN_AS_NODE` poisoning.** The agent harness can set this env var, which makes Electron launch as plain Node and produce confusing errors. Wrap the dev script: `env -u ELECTRON_RUN_AS_NODE electron-vite dev`.
- **Vitest needs jsdom for `.tsx` tests but not for `.ts` tests.** Use `environmentMatchGlobs` so the renderer's DOM tests get jsdom and the pure-logic tests stay on Node. Set up `@testing-library/jest-dom/vitest` via a setup file and augment `vitest`'s `Assertion` type in a `.d.ts` so the typechecker recognises the matchers.
- **Renderer is Electron-only by design.** The tRPC link calls `window.perspectivesAPI.trpc(...)` injected by the preload script. Loading the renderer in a plain browser tab (e.g., the Vite dev URL) will crash with `Cannot read properties of undefined`. Guard the link with a clear error message; an HTTP transport lands in Phase 5.
- **Migrations baked into the bundle.** Resolving `migrations/*.sql` via `import.meta.url` breaks once electron-vite bundles the main process. Use Vite's `?raw` import to inline the migration SQL strings at build time.

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
- Native deps (better-sqlite3) need an ABI rebuild between Electron and Node;
  add rebuild:electron / rebuild:node scripts and use them.

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

**Verify:** `pnpm --filter adapter-postgres test` passes against a real container. Manually confirm `docker compose -f docker-compose.dev.yml up` exposes a browsable DB on localhost:5433.

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
  values, base64url-encoded JSON. Decode and apply as a row-comparison predicate
  (handle mixed ASC/DESC via a nested-OR predicate, not row-value comparison —
  Postgres doesn't support row comparison across mixed directions).
  Returns a page of rows plus the next cursor (undefined when exhausted).
- countRows(plan): exact COUNT(*) honoring the plan's filters.
- estimateCount(plan): fast estimate from pg_class.reltuples for an unfiltered
  table; for filtered plans fall back to EXPLAIN (FORMAT JSON) row estimate.
- A dialect metadata object: identifier quoting, supported operators, etc.
- Map common pg error codes to the engine error hierarchy (ConnectionError,
  ValidationError, etc.).

Tests against the seeded container:
- Paginate fully through `orders` (9000 rows) in pages of 500 using only the
  cursor; assert every row appears exactly once and none is skipped (collect
  ids into a Set, assert size == 9000 and matches a direct SELECT). Expect
  exactly 18 pages.
- Sort by a non-unique column (status) and confirm the pk tiebreaker keeps
  pagination stable.
- A non-divisor page size (37) with a DESC non-PK sort to exercise the `<`
  branch of the keyset predicate. Expect ceil(9000/37) = 244 pages and the
  same row set.
- countRows on customers returns 3000; estimateCount returns a positive number
  of the right order of magnitude.
- A filtered plan (country_code = 'DE') returns only matching rows.
```

**Verify:** The pagination round-trip is the test that matters — keyset bugs cause skipped or duplicated rows under load. If all three pagination tests pass against 9000 rows (PK-only sort, non-unique sort, non-divisor page size with DESC), the algorithm is sound.

---

## Prompt 1.3 — SQLite metadata store

```
Create packages/metadata-sqlite implementing the MetadataStore interface from
packages/engine/src/metadata.ts using better-sqlite3.

- A tiny migration runner. Migrations are passed in as { filename, sql } pairs,
  not discovered from disk — Vite's `?raw` import inlines the SQL at build
  time so resolution works after bundling. Track applied migrations in a
  _migrations table.
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

**Verify:** The password-leak test is the one that matters. Confirm it actually fails if you temporarily make the store write the password in — then revert. (We did this in 1.3 and the test caught the planted leak via the `applicationName ?? value.password` swap.)

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
- All connection-returning methods return a `ConnectionProfileSummary`
  (= Omit<ConnectionProfile, "password">) so passwords cannot leak through
  the RPC boundary into a React Query cache.
- The service depends only on the interfaces, not on adapter-postgres or
  metadata-sqlite directly — those are injected at composition time.

In apps/desktop main process:
- Compose the EngineService with PostgresAdapter, SqliteMetadataStore, and the
  (still stub) CredentialStore.
- Expand the tRPC router with routers: connections, schema, data — mapping to
  the EngineService methods above. Validate all inputs with zod.
- Use superjson as the tRPC transformer for Date / bigint round-tripping.
  Superjson v2 is pure ESM; you'll need to exclude it from electron-vite's
  externalizeDepsPlugin so it gets inlined into the CJS bundle.

Tests:
- A tRPC-level integration test that, against a testcontainers Postgres seeded
  with seed.sql, creates a connection, connects, introspects, and fetches the
  first page of `customers` through the full stack.
```

**Verify:** This is the first end-to-end slice through every layer. If the integration test is green, the architecture's seams are sound. `caller.connections.create → caller.connections.connect → caller.schema.get → caller.data.getTablePage` should walk the whole stack without a single raw SQL string crossing a package boundary above adapter-postgres.

---

## Prompt 1.5 — Connection manager UI + real credential storage

```
Build the connection manager UI in the renderer, and the real Electron
CredentialStore.

CredentialStore (main process):
- Implement using Electron safeStorage (encryptString/decryptString) so the
  password is encrypted with an OS-backed key.
- Persist the encrypted blob to <userData>/credentials.json via atomic
  tmp-file-and-rename writes with mode 0600. Never to SQLite — separation of
  the credential store from the metadata store is the security boundary.
- Plaintext password never touches disk; never appears in any log.

UI (renderer):
- An empty-state screen for fresh installs: "Add your first connection".
- A connection list with add / edit / delete.
- A connection form (shadcn dialog): name, host, port (default 5432),
  database, user, password, SSL mode (disable/prefer/require/verify-ca/
  verify-full), application name (default "Perspectives").
- A "Test connection" button calling connections.test, showing success
  (server version) or a friendly mapped error.
- The form unmounts on close so any password state is dropped immediately.
- Saved connections render via ConnectionProfileSummary (no password field).

Use the tRPC connections router. Never put a password in a query cache: the
engine's CRUD methods return ConnectionProfileSummary (1.4).

Tests: a component test for the form's validation logic (pure, no Electron).
```

**Verify:** Add a connection pointing at your `docker compose` Postgres (localhost:5433). Test connection succeeds. Quit and relaunch the app — the connection persists, and `grep -a` over the SQLite file does not find the password string. The encrypted credential blob in `<userData>/credentials.json` should be unreadable bytes.

**Operational gotcha that lives here:** the first run will fail with `NODE_MODULE_VERSION` mismatch if you haven't wired `rebuild:electron`. This is the prompt where the ABI dance gets documented for real.

---

## Prompt 1.6 — Schema sidebar

```
Build the schema sidebar in the renderer, populated from schema.get.

- A tree: connection -> schema -> grouped (Tables, Views, Functions) -> items.
- Distinct lucide icons for tables / views / functions.
- A search/filter box that filters the tree by name as you type. A schema-name
  match keeps every item under it; otherwise items are filtered individually.
  Empty group keys are dropped from the filtered snapshot (no "Views" header
  with zero children).
- Force-expand the tree whenever the filter is non-empty so matches are
  visible without manual expand-clicks.
- Clicking a table or view opens it in a new tab. For now, opening can be a
  placeholder card that identifies the selected item; the real grid is wired
  in 1.8.
- A "Refresh schema" button that calls the cache-invalidating mutation on the
  engine. Write the returned snapshot directly into the get-query cache via
  utils.schema.get.setData (avoid an extra round-trip).
- Loading and error states.

Plain rendering — no virtualization unless a schema has hundreds of tables.
Don't over-engineer.

Sessions: opening a connection from the connection-manager view mounts a
SessionView component that owns the schema sidebar, tab bar, and main panel.
Activate the engine adapter via connections.connect on mount; disconnect on
the back button. The active connection id is what every downstream query keys
off of.
```

**Verify:** Against the seeded DB you should see `public` with customers, orders, products, employees, companies, order_items, tags, customer_tags, warehouses, inventory under Tables, and `active_customers` under Views. Search narrows the tree; clearing search restores the user's expand state.

---

## Prompt 1.7 — The grid component (the centerpiece)

```
Build a reusable data grid component (apps/desktop renderer shared components
is fine — moving to packages/ui can wait until Phase 5 introduces a server
consumer) using TanStack Table (headless) + TanStack Virtual for row
virtualization. Consult the frontend-design guidance for styling quality —
this is the component the whole product is judged on.

Requirements:
- Props: column definitions (each with name, db type, optional width), row
  data, loading state, a sort spec + onSortChange, and an onReachEnd callback
  for incremental loading.
- Row virtualization: smooth scrolling with 100k+ rows held in memory.
- Type-aware cell rendering: NULL shown distinctly (muted "NULL"), booleans
  as a clear true/false indicator, numbers right-aligned with tabular-nums,
  timestamps formatted as YYYY-MM-DD HH:MM:SS (en-CA locale for ISO order),
  json/array values shown truncated with an expand affordance (modal lands
  in 1.9), bytea values rendered as a length-summary chip, never as raw
  bytes.
- Column resizing by dragging the header edge; persist widths in component
  state for now.
- Click a column header to cycle sort: asc -> desc -> none for the same
  column; switching to a different column resets to asc.
- Cell selection with arrow-key navigation (Home/End jump in row,
  PageUp/PageDown by viewport). Cmd/Ctrl+C copies the focused cell through
  the same formatter as the display (WYSIWYG clipboard). A row context
  action (kebab in the row-number gutter) copies the row as JSON or TSV.
- Sticky header within the same scroll container as the body so horizontal
  scroll moves header and rows together.
- A left gutter showing row numbers.
- onReachEnd fires once per row-count epoch; resets automatically when the
  row count grows.
- Empty state and loading skeleton.

Build it against mock data first. Mount via a `#grid` hash-route so it can
be developed and demoed in the browser without the database.

No data fetching inside the grid — it is a pure presentation + interaction
component.

Vitest plumbing: set up environmentMatchGlobs so .tsx tests run in jsdom,
add @testing-library/jest-dom/vitest, and augment vitest's Assertion type
in a .d.ts so the typechecker recognises toBeInTheDocument etc.
```

**Verify:** Feed it 200 mock rows in the dev harness, scroll to the bottom → onReachEnd appends another 500 rows. Click a header → asc → desc → none → asc. Drag a header edge → column resizes. Click a cell → focus ring; arrows move; Cmd/Ctrl+C → cell on clipboard. Kebab → Copy as JSON / TSV. Toggle the loading button → skeleton; toggle empty → empty card. Bump to 30k+ rows with `+10k rows` — scrolling stays smooth.

---

## Prompt 1.8 — Table view (grid + data, keyset pagination)

```
Wire the grid to live data to create the table view, opened from the schema
sidebar.

- Opening a table creates a tab. Multiple tabs can be open; tabs are
  closeable, and the active tab plus the open-tab list are restored on
  relaunch (persist via the engine's settings KV, keyed per connection).
  Add a settings tRPC router for the persistence path; the engine exposes
  getSetting / setSetting passthroughs to the metadata store's KV.
- On open: fetch the estimated row count (show immediately, e.g. "~9,000
  rows") and the first keyset page via data.getTablePage. Show columns from
  the schema snapshot with their types.
- Infinite scroll: when the grid's onReachEnd fires, fetch the next keyset
  page using the returned cursor and append. Use TanStack Query's
  useInfiniteQuery; wrap it in a custom `useTablePage` hook that takes
  fetchPage / fetchEstimate / fetchExactCount as injectable callbacks so
  tests don't need to mock tRPC.
- Clicking a header to change sort resets pagination and refetches from the
  first page with the new sort (the queryKey shift handles this naturally).
- An "exact count" control that calls countTable and replaces the estimate.
  Resets when the queryKey changes (sort / page size / etc.).
- A "Refresh" button that calls qc.resetQueries on the page query so it
  goes back to page 1 rather than refetching all already-loaded pages in
  place.
- A page-size selector (default 100; options 50/100/200/500).

Tests: a hook-level test for useTablePage using mocked fetchers + a
QueryClientProvider — no tRPC, no DB.
```

**Verify:** Open `orders` against the seeded DB. The estimate appears instantly; scrolling loads more pages seamlessly; sorting by `placed_at` works and stays stable; exact count returns 9,000. Quit and relaunch with the same connection active — the orders tab restores.

---

## Prompt 1.9 — Cell expansion modal

```
Add a cell detail view for inspecting large or structured values.

- Triggered from the grid through three paths: (a) an expand button on
  json/array, long-text, and bytea cells; (b) Enter or Space on the focused
  cell; (c) double-click on a cell. All three call back into a single
  onExpandCell(column, value) prop on the grid; the caller renders the
  modal.
- Modal (shadcn Dialog), not side panel: side-panel real estate is reserved
  for Phase 4's form view.
- Per-kind rendering:
    * text: wrapped, scrollable <pre>
    * json / array: recursive collapsible tree (per-node disclosure;
      default 2 levels expanded). Parse JSON-shaped strings before
      rendering, because some pg drivers return jsonb as a string.
    * bytes: length note ("Binary data — N bytes") + a hex dump of the
      first 256 bytes. Never let raw bytes reach the screen as mojibake.
    * scalar (null / bool / number / date / time / timestamp): formatted
      via the same formatter the cell uses.
- "Copy raw" button that mirrors whatever was displayed: verbatim string
  for text, JSON for structured, summary+hex for bytes.
- Read-only — no editing affordances.

Extend format.ts with a "bytes" CellKind, isBinary() / bytesLength() /
bytesPreview() helpers. classifyCell wins on value (Uint8Array beats dbType)
so a string column accidentally holding a buffer still renders correctly.
```

**Verify:** Open a customer row with a jsonb `meta` column → tree expands. Focus a long-text cell, Enter → wrapped preview. If you have a bytea column locally, Enter → hex dump + "N bytes" note. Copy raw on each writes the expected representation. The harness `#grid` route now exercises every kind (bio long-text, avatar bytea, meta with nested arrays).

---

## Prompt 1.10 — Read-only SQL console

```
Add a SQL console tab.

- A SQL editor using CodeMirror 6 (@uiw/react-codemirror wrapper) with
  @codemirror/lang-sql in PostgreSQL dialect. Autocomplete table and column
  names from the active connection's schema snapshot: emit both bare and
  schema-qualified entries; drop the bare form on cross-schema collision so
  the user is forced to disambiguate.
- Run with Cmd/Ctrl+Enter (keymap inside CodeMirror plus a window-level
  fallback) and a Run button.
- READ-ONLY ENFORCEMENT: execute each run on a dedicated client checked
  out from the pool, inside `BEGIN TRANSACTION READ ONLY` ... `ROLLBACK`.
  ROLLBACK even on success so any SET LOCAL is reverted. Any write
  statement or DDL fails at the database with SQLSTATE 25006 — map it to
  ValidationError so users see "cannot execute UPDATE in a read-only
  transaction" verbatim.
  Add `runReadOnlySql(sql)` to DatabaseAdapter and
  `runReadOnlyQuery(connectionId, sql)` to EngineService. Neither goes
  through the QueryPlan compiler — raw SQL is the user's, run as-is but
  read-only.
- Expose as a tRPC mutation (not query) so React Query never caches it.
- Results render in the grid from 1.7. Column types come from the result's
  pg field OIDs via the existing oid→type-name mapping.
- Show execution time and row count. Errors render as a destructive Alert
  with the mapped error message.
- A local query history (last 50, dedup-move-to-front, persisted per
  connection in the settings KV). A collapsible history sidebar; clicking
  an entry reloads it into the editor. Successful queries only.
- Extend the OpenTab union with a `sql` variant (id + title) — SQL tabs
  are NOT dedupable; the user can open multiple consoles with independent
  drafts.

Tests (against the seeded container):
- SELECT returns rows + column metadata.
- UPDATE raises a read-only-transaction error (matches /read-only/i).
- CREATE TABLE (DDL) raises the same.
- SET LOCAL inside the txn is rolled back (probe with SHOW after).
- Syntax error maps to ValidationError matching /syntax/i.
```

**Verify:** Run `SELECT * FROM customers LIMIT 50` — rows appear in the grid, header shows `50 rows · ~12 ms`. Run an `UPDATE` — destructive Alert with "cannot execute UPDATE in a read-only transaction". Run a DDL — same. Type a table name → completions from the live schema. History sidebar lists previous successes; click one → editor reloads. Open multiple SQL tabs — each holds its own draft.

---

## Definition of done for Phase 1

- Fresh install → add a connection → browse schema → open any table → scroll through all rows smoothly → run read-only SQL. All working.
- `pnpm typecheck && pnpm lint && pnpm test` green from a clean clone (adapter and engine tests use testcontainers; CI must have Docker available — update the CI workflow to start Docker / use a Postgres service or testcontainers).
- Passwords are encrypted via safeStorage; the leak-guard test passes; no password appears anywhere on disk in plaintext.
- Keyset pagination verified correct over 9000 rows under three sort regimes (PK-only, non-unique + tiebreaker, non-divisor + DESC).
- Read-only SQL enforcement verified at the database with UPDATE and CREATE TABLE attempts.
- Nothing is editable anywhere.

**The Phase 1 screencast:** "Connect, browse, scroll a huge table without lag, run a query." If it feels as smooth as TablePlus, you've hit the floor and earned the right to build the things that make Perspectives better — which is Phase 2.

---

## Common failure modes specific to Phase 1

- **OFFSET pagination sneaks in.** The AI may reach for `LIMIT n OFFSET m` because it's simpler. Reject it — it's O(n) per page and corrupts under concurrent writes. Keyset only.
- **String-interpolated SQL.** Any value placed directly into a SQL string instead of a bound parameter is both an injection risk and a bug. All values are parameters.
- **Credentials in logs or query cache.** Watch for the password landing in a console.log, an error object, or a TanStack Query cache key. The leak-guard test only covers SQLite; stay alert to the others in review. `ConnectionProfileSummary` is the boundary.
- **The grid grows a data-fetching brain.** Keep the grid presentational. Data fetching lives in the table view (1.8), not the grid (1.7). Mixing them makes the SQL console (1.10) unable to reuse the grid.
- **Introspection misses compound or self-referential FKs.** The seed has both precisely so the tests catch this. If the FK tests pass, you're covered.
- **Tests try to reuse a single shared container badly.** Start one container per test file, seed once, and make tests read-only so they don't interfere.
- **ABI mismatch after switching between `pnpm dev` and `pnpm test`.** The `better-sqlite3` binary targets one ABI at a time. Add `rebuild:electron` / `rebuild:node` scripts and run the right one before the right command. Document it in the package README, not just oral history.
- **Mixed ASC/DESC keyset predicate via row comparison.** Postgres does not support row comparison across mixed directions. Use a nested-OR predicate (one OR-arm per leading-prefix). The non-divisor + DESC test in 1.2 catches this.
- **Refresh refetches every loaded page.** `useInfiniteQuery.refetch()` re-runs *all* fetched pages in place. For a Refresh button that should "go back to page 1", call `qc.resetQueries({queryKey})` and let the observer's enabled subscription pull page 1 fresh.

---

## Retrospective notes (things that emerged after shipping)

These weren't in the original prompts but landed as hardening passes after the phase shipped. Useful as a reference when Phase 2 layers on top.

- **SQL console security pass (AUDIT-CODEX.md).** The first cut stored history as `string[]` capped at 1 MiB per entry, with no opt-out. After audit:
  - Tightened per-entry cap to 64 KiB (a single SELECT is well inside; an accidental file drop is not).
  - Added a per-connection opt-out (`historyEnabled`) that no-ops `pushHistory` and wipes the persisted payload when disabled.
  - Added cancel-token plumbing so `runReadOnlySql` can be aborted via `pg_cancel_backend`; the token rotates per call so a late cancel can't reach a subsequent query.
  - Renderer surface: a History toggle + Clear button next to the sidebar header; the Clear button now removes the underlying KV entry, not just the in-memory state.
- **Browser-tab friendly error.** The renderer's tRPC link calls `window.perspectivesAPI.trpc(...)`. Loading the renderer outside Electron used to crash with `Cannot read properties of undefined (reading 'trpc')`. The link now checks for the bridge and emits a clear "Engine bridge not available — Perspectives runs in the Electron shell" error.
- **electron-vite externalize exclusions.** Workspace TS-source packages and `superjson` v2 must be in the `exclude` list of `externalizeDepsPlugin`; native deps (`pg`, `better-sqlite3`) must stay external. Lives in `apps/desktop/electron.vite.config.ts` with a header comment explaining why each entry is there.
- **Vitest jsdom plumbing.** `vitest.config.ts` with `environmentMatchGlobs`, `@testing-library/jest-dom/vitest` setup, and a `vitest.d.ts` augmenting the `Assertion` interface. Required for any renderer DOM test (DataGrid, JsonTree, CellDetail, etc.).
- **JSON tree handles stringified JSON.** Some pg drivers hand back jsonb as a string; the detail view tries `JSON.parse` if the value starts with `{`/`[` and falls back to the raw string on parse failure.

---

## After Phase 1

Phase 2 (smart navigation) is where Perspectives stops being a TablePlus clone. The seed database already contains everything you need to build and demo it:
- forward and reverse FK jumps (customers ↔ orders)
- a junction for m:n (customer_tags)
- a self-referential relation (employees.manager_id)
- a compound FK (inventory → warehouses)

See `phase-2-prompts.md` for the next set in the same one-prompt-per-commit shape.
