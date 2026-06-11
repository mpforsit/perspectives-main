# Perspectives — Phase 2 prompts for AI-assisted coding

Phase 2 is where Perspectives stops being a TablePlus clone. The seed database from Phase 1 (`seed.sql`) already contains everything the demo needs:

- Forward + reverse FK jumps: `customers ↔ orders`, `orders ↔ order_items`
- A junction for m:n: `customer_tags` (sits between `customers` and `tags`)
- A self-referential relation: `employees.manager_id`
- A compound FK: `inventory (tenant_id, warehouse_code) → warehouses`

Same discipline as Phase 1: **one prompt = one commit.** Verify after each.

---

## What changed since Phase 1 (read before starting)

- **The DSL already has `RelationDef`.** Phase 0 baked the shape; Phase 1 left the `metadata-sqlite` `relations` table stubbed. Phase 2 fills it in. Re-read `packages/dsl/src/schemas.ts` and the `RelationDef`/`DisplayConfig` shapes in `docs/plan.md` §4 before starting.
- **The DataGrid is still purely presentational.** Forward-FK clickability lands as a per-column annotation passed through props, NOT as a data-fetcher inside the grid. The TableView (1.8) handles the click, not the grid.
- **No row-multiplying joins yet.** Phase 2 supports navigation across n:1 and 1:1 from the source side. Junction-table detection is the *only* m:n trick this phase pulls; full structured-join perspectives come in Phase 3.
- **Read-only stays read-only.** Phase 2 adds navigation, custom relations metadata, and display config — but no `INSERT/UPDATE/DELETE` paths reach the target DB. Custom-relation persistence is metadata-only.

Keep these files in the AI's context throughout Phase 2: `docs/plan.md`, `packages/dsl/src/schemas.ts`, `packages/engine/src/adapter.ts`, `packages/engine/src/metadata.ts`, `packages/engine/src/service.ts`, the existing `SessionView` / `TableView` / `useTablePage` from Phase 1, and `seed.sql`.

---

## System primer addendum (paste once at session start, after the Phase 1 primer)

```
We are now in Phase 2 (smart navigation) per docs/plan.md §7. Rules that
join the Phase 1 hard rules:

- RelationDef from packages/dsl is the canonical shape for relations. Both
  schema-derived FKs and user-defined relations end up as RelationDefs.
- Compound and self-referential FKs MUST behave the same as simple ones at
  every navigation surface. seed.sql has both — tests reference them.
- No row-multiplying joins yet. Navigation traverses n:1 and 1:1 from the
  source side; junction tables (m:n) are detected and *collapsed* (jump
  through them as a single step), not joined.
- DisplayConfig persists per (connection, schema, table) in the metadata
  store. Used for FK labels and breadcrumbs. A missing DisplayConfig is
  normal — fall back to the PK.
- All new navigation paths go through the existing tRPC seam. No raw SQL
  outside packages/adapter-postgres.
- All counts for cardinality previews come through the existing
  countRows / estimateCount paths; we are NOT inventing a new count API.

Stop when the Phase 2 deliverables in docs/plan.md are met. Phase 3
(structured-join perspectives, saveable presentations) is next.
```

---

## Prompt 2.1 — Relations index: engine + tRPC + tests

```
Build the relations layer in packages/engine and expose it over tRPC.

In packages/engine:
- A new module that, given a SchemaSnapshot, derives RelationDefs from every
  foreign key including compound and self-referential. Stable id: a
  deterministic hash of (source schema, source table, source columns,
  target schema, target table, target columns) so the same FK produces the
  same RelationDef id across reconnects. `source: "schema"` for these.
- An EngineService method:
    listRelations(connectionId) -> RelationDef[]
  returning schema-derived relations merged with custom relations loaded
  from metadataStore.relations.list(). The metadata store filters by a
  scope key it derives from the ConnectionProfile's
  (host, port, database) tuple — relations are per-database, not
  per-connection-id, so renaming a connection profile doesn't orphan
  customs.
- An EngineService method:
    getRowByKey(connectionId, schema, table, pkValues) -> ResultRow | null
  Compiles a QueryPlan with an equality filter on the primary key
  (handles compound PKs). Used by FK navigation to verify the target row
  exists and to render the row label (via DisplayConfig later).

In adapter-postgres:
- No new adapter methods needed — getRowByKey is built on the existing
  runQuery path with a filter. Add an integration test that proves
  compound PKs round-trip correctly through the equality filter.

tRPC:
- relations.list({connectionId}) -> RelationDef[]
- data.getRowByKey({connectionId, schema, table, pkValues}) -> row|null

Tests (against the seeded container):
- Schema-derived relations include:
    * customers ← orders (1:n)
    * orders ← order_items (1:n)
    * orders → customers (n:1)
    * employees → employees (self-referential via manager_id)
    * inventory → warehouses (compound FK)
- Compound FK keeps its column tuple in order:
  inventory_warehouse_fk has from.columns = ["tenant_id", "warehouse_code"]
  and to.columns matching the PK column order on warehouses.
- listRelations merges a hand-inserted custom relation
  (source="custom") alongside the schema-derived set without duplicating.
- getRowByKey returns the right row for a compound PK, and null for a
  miss.
```

**Verify:** All five seed-derived RelationDefs appear with stable ids across reconnects; the compound-FK column order is preserved; a custom relation inserted via the metadata store appears in the same `relations.list` result.

---

## Prompt 2.2 — Forward FK navigation (clickable cells + filtered tab + breadcrumb foundation)

```
Make FK cells clickable in the table view. Clicking jumps to the
referenced row in a new tab.

Grid (apps/desktop/src/renderer/src/grid):
- DataGridColumn gains an optional `link?: ForwardLink` annotation. The
  grid stays presentational: when `link` is present, render the cell's
  value with a forward-arrow icon and a click handler that calls a new
  `onFollowLink(link, row)` prop. No fetching inside the grid.
- ForwardLink carries the relation id + the column indices on the source
  side so the caller can extract values from the row.

TableView:
- After fetching the schema and the relations index, build a per-column
  link annotation: for every outbound FK from the visible table, every
  column that participates in the FK gets a `link` pointing at the
  RelationDef. Compound FKs share the link across their member columns.
- Handle `onFollowLink`: extract the target-side PK values from the
  clicked row, call `data.getRowByKey` to confirm the row exists, then
  emit a new tab.

OpenTab union: add a new variant:
  { kind: "filteredTable"; schema: string; name: string;
    filter: FilterGroup;        // equality on the target PK
    crumb: BreadcrumbStep }     // see below
And update tabs-storage's discriminated-union schema accordingly. Make
sure the Zod parse rejects malformed compound-filter payloads.

Breadcrumbs (foundation only — full UI lands in 2.7):
- Define BreadcrumbStep = { schema, table, label, filter }.
- Each filteredTable tab carries a breadcrumb array (head = origin,
  tail = current step). For now render the array as a row of clickable
  labels above the grid in TableView; clicking a non-tail step opens a
  new tab pinned at that step.

Engine + tRPC:
- No new procedures needed beyond 2.1's data.getRowByKey.
- TableView's `useTablePage` already supports a filter via the existing
  QueryPlan filter path; thread the filteredTable's filter through it.

Tests:
- A renderer unit test for the link-extraction logic: given a row and a
  RelationDef, return the right BreadcrumbStep + filter payload. Covers
  simple FK, compound FK, and self-referential FK.
- A renderer unit test for the discriminated tabs-storage schema with the
  new filteredTable variant.
```

**Verify:** Open `orders` against the seeded DB. The `customer_id` column shows a forward-arrow on hover. Click a value → new tab opens at `customers` filtered to that one row; the breadcrumb shows `orders › Order #N › customer: Acme`. Open `inventory`, click the compound-FK pair `(tenant_id, warehouse_code)` → filtered `warehouses` tab opens with both equality constraints applied. Open `employees`, click a `manager_id` → filtered `employees` tab opens at the manager row (self-ref works).

---

## Prompt 2.3 — Reverse FK panel + junction-table m:n collapse

```
Add a row-inspector panel that lists every table referencing the focused
row, with cardinality counts and one-click open. Also detect junction
tables and collapse the traversal.

EngineService:
- detectJunctions(connectionId) -> Map<TableKey, JunctionInfo>
  A table is a junction iff:
    * Exactly two outbound FKs.
    * The union of those FK columns forms the table's primary key (or a
      unique constraint covering all of them).
    * No other non-key, non-audit columns. Allow `created_at` /
      `updated_at` as audit columns — they don't disqualify.
  JunctionInfo = { fromRel, toRel } — the two RelationDefs that the
  junction couples.
- getReferencingCounts(connectionId, schema, table, pkValues)
    -> Array<{ relationId, count: number, estimated: boolean }>
  For each inbound FK to (schema, table), run countRows on a plan
  filtered by the FK columns = pkValues. For tables with estimateCount >
  some threshold (e.g. 100k unfiltered), return the estimate flagged
  `estimated: true` and offer "Exact count" on demand in the UI.

  For each junction the (visible) source table participates in, return
  an extra synthetic entry with relationId = `junction:<id>` collapsing
  the two hops into one count (e.g., a customer's distinct tag count via
  customer_tags).

tRPC: relations.detectJunctions, data.getReferencingCounts.

UI:
- A right-side row-inspector panel in TableView, opened by clicking the
  row-number gutter or pressing `i` on the focused row.
- Top of the panel: row fields in a compact key-value layout (read-only
  this phase). Long values open the existing CellDetail dialog (1.9).
- Section "Referenced by": one entry per inbound relation (and per
  detected junction), label from RelationDef.label.reverse, count badge.
  Click → open a filteredTable tab on the referencing table with the
  inbound FK columns = pkValues. Junctions land directly at the
  far-side table (customer → tags), not the junction itself.

Caching:
- Cardinality counts are session-scoped (Map keyed by row+rel). Don't
  refetch on every panel open; clear on Refresh.

Tests:
- Junction detection identifies `customer_tags` as a junction between
  customers and tags. Does NOT misclassify `order_items` as a junction
  (it has quantity / unit_price beyond the FK columns).
- getReferencingCounts for a specific customer returns the right number
  of orders + the collapsed tag count via the junction.
```

**Verify:** Open a customer row (`customers` table → `i` on a row → inspector). "Referenced by" lists:
- "47 orders" — click → filtered orders tab opens
- "3 tags" (collapsed through `customer_tags`) — click → filtered tags tab opens
- The junction `customer_tags` does NOT appear separately
- For a large table the count shows with `~` until you ask for an exact count.

For a warehouse row, the compound-FK side surfaces too: "12 inventory rows" → filtered inventory tab with both FK columns constrained.

---

## Prompt 2.4 — Custom relations editor

```
Add a UI for creating relations between tables when no FK exists. Stored
as RelationDef with source: "custom". Treated identically to schema-derived
relations in navigation.

UI:
- A "Relations" view, accessible from the SessionView topbar ("Manage
  relations" button or similar). Lists every relation for the current
  connection, schema-derived ones marked with a "schema" pill and custom
  ones marked "custom" with edit/delete affordances.
- Create-relation form (shadcn dialog):
    * Source: schema + table + columns (multi-select for compound)
    * Target: schema + table + columns (multi-select; column count must
      match source)
    * Cardinality: one-to-many | one-to-one
    * Optional labels: forward / reverse strings (used in the inspector
      panel + breadcrumbs)
    * Display direction: forward | reverse | both
- Validation through the existing RelationDef Zod schema. Refuse on:
    * column-count mismatch
    * target column not a unique/PK on the target side (cardinality
      would be ambiguous)
    * exact duplicate of a schema-derived relation
- On save: persist via metadata.relations.create/update. tRPC:
  relations.createCustom, relations.updateCustom, relations.deleteCustom.

Engine:
- Reject creation if the target columns are not collectively unique
  (server-side check via introspection; the renderer's check is a UX
  shortcut, not security).
- listRelations from 2.1 already merges custom + schema-derived, so no
  changes needed to the read path.

Tests:
- The form's column-count + uniqueness validation is exercised by a
  renderer-only unit test (mock the snapshot).
- An engine test: creating a custom relation, then listRelations
  surfaces it; deleting removes it; an invalid (non-unique target)
  relation is rejected.
```

**Verify:** Add a custom relation between two seed tables that have no FK between them — e.g., `orders.shipping_country` → `countries.code` if you stage that. Open the source table, the source columns now show forward-link arrows for the custom relation; the target table's inspector lists the new reverse entry. Edit the label, observe it propagate; delete it, observe the arrows go away.

---

## Prompt 2.5 — Display config: per-table display column + row label template

```
Add a per-table "Display" configuration so FK labels and breadcrumbs use
human-readable strings instead of raw PKs.

DSL:
- DisplayConfig is already defined in packages/dsl. Confirm the shape:
    { schema, table, displayColumn, secondaryColumn?, rowLabelTemplate? }
  rowLabelTemplate uses `{column}` placeholders.

Engine:
- metadata.displayConfig CRUD is already there from 1.3. Surface via
  tRPC: displayConfig.getForTable, displayConfig.upsert,
  displayConfig.delete.
- New EngineService method:
    formatRowLabel(connectionId, schema, table, row) -> string
  Looks up the table's DisplayConfig; if none, falls back to PK values
  joined with `·`. Templates resolve `{column}` to row[column];
  missing/null fields render as empty (template "x: {y}" with y=null →
  "x: ").

UI:
- A "Display" tab in a per-table settings popover (gear icon in TableView
  header). Lets the user pick:
    * Display column (single-select from this table's columns)
    * Secondary column (optional, displayed as a smaller label below)
    * Row label template (free-form text with autocompletion offering
      `{column_name}` insertions)
- Persist via tRPC; invalidate the displayConfig cache for this table.
- Consumers:
    * Forward-FK cell rendering (2.2): once the target row's display
      label is known, render `Acme Corp` instead of `42`. Looks up
      labels in batches — when the visible page lands, kick off a
      single batch query for the displays of all referenced rows.
    * Breadcrumb step labels (from 2.2).
    * Inspector panel's "Referenced by" entries when the count is small
      enough to enumerate (TBD threshold).

Engine batch-label method:
- getRowLabels(connectionId, schema, table, pkTuples[]) -> string[]
  One round trip to fetch + format labels for many rows. Used by the
  grid to populate forward-FK cell displays. Cached per session.

Tests:
- formatRowLabel resolves templates correctly: "{first_name}
  {last_name}" against {first_name: "Ada", last_name: "Lovelace"} →
  "Ada Lovelace"; null fields render as empty; missing fields are
  treated as null.
- getRowLabels batches a single SQL round trip; verified by adapter test
  that the underlying QueryPlan has a single `IN` filter, not N
  separate queries.
```

**Verify:** Set a DisplayConfig on `customers` with displayColumn=`full_name` and rowLabelTemplate=`{full_name} ({country_code})`. Open `orders` — the `customer_id` column now renders both the id and the customer label in the cell. Breadcrumbs from FK clicks show `orders › Order #N › Ada Lovelace (FR)` instead of `orders › Order #N › 42`. Quit and relaunch — the display config persists per (database, schema, table).

---

## Prompt 2.6 — Cardinality preview badges on visible rows

```
Surface cardinality counts inline on rows so the user sees "this customer
has 47 orders" without clicking.

UI:
- TableView's per-table settings (the gear from 2.5) gains a "Preview
  cardinality" toggle. When on, the user picks 1–2 outbound relations
  to preview.
- For each visible row, fetch the count for those relations and render
  a badge inside the gutter column (e.g., "47 orders · 3 tags"). For
  rows currently off-screen (virtualized away), don't fetch.
- Use the existing useTablePage hook's row supply; subscribe to the
  virtualizer's visible-range and dispatch count requests in batches
  per page-load. Cancel in-flight requests when the user scrolls past
  the rows.
- Estimated counts (estimateCount above the threshold from 2.3) render
  with `~`. The badge has a click to escalate to exact count for that
  row+relation.

Engine:
- getCountsForRows(connectionId, sourceTable, pkTuples[], relationIds[])
    -> Array<{ rowPkTuple, relationId, count, estimated }>
  One round trip per batch — composes a SQL of `SELECT
  source_pk, COUNT(*) FROM target WHERE fk_col IN (...) GROUP BY
  source_pk` for each relation. Cap batch size (e.g., 200 rows) and
  paginate beyond that.

Performance:
- For relations where target rowCount estimate exceeds 100k, drop to
  per-row estimateCount instead of a batched grouped count. The visible
  set is small (≤100 rows) but each estimate is a single fast `EXPLAIN`.
- Cache results keyed by (sourceRow PK, relation id) for the session.
  Refresh button clears it.

Tests:
- Renderer test: with a mocked count fetcher, scrolling reveals rows
  that fire batched count requests; scrolling back doesn't refetch
  cached entries; switching relations resets the cache for the affected
  rows.
- Engine test against the seed: customers' "orders count" preview for
  the first 100 customers matches a hand-written SQL ground-truth
  query. The total of all customers' counts equals 9000.
```

**Verify:** Open `customers`, enable cardinality preview on the `orders` relation. Each visible row shows its order count; scrolling is still smooth; clicking a `~` badge promotes that row's count to exact. Toggle to a high-cardinality relation and confirm we fall back to estimates without freezing the grid.

---

## Definition of done for Phase 2

- A user opens a customer row, clicks `customer_id` from an `orders` row → new tab at the right customer. The breadcrumb shows the path.
- The inspector panel shows "47 orders" + "3 tags" (collapsed through the junction) + reverse compound-FK entries. One click on any entry opens the referencing table filtered to those rows.
- Junction-table detection correctly identifies `customer_tags` and ignores `order_items`.
- A custom relation between two tables with no FK behaves identically to a schema-derived one. Persists per (database, schema, table) across reconnects.
- DisplayConfig changes FK labels and breadcrumbs from "42" to "Ada Lovelace (FR)".
- The cardinality preview reveals counts inline without making scrolling laggy.
- Compound FKs (`inventory → warehouses`) and self-referential FKs (`employees.manager_id`) work everywhere — forward click, reverse panel, breadcrumb, custom relations all handle them correctly.
- `pnpm typecheck && pnpm lint && pnpm test` green; integration tests pass against testcontainers; nothing editable on the target DB.

**The Phase 2 screencast:** "Click a foreign key. Look — every referencing table with counts. Define a relation in the UI, instantly clickable. The customer label follows you through the breadcrumb." If a viewer says "wait, can it jump *backwards* through a relation?", Phase 2 is done.

---

## Common failure modes specific to Phase 2

- **Compound FKs treated as N independent simple FKs.** Every navigation surface must operate on the *constraint*, not on each column individually. The grid's link annotation needs to share the link across columns; the filter assembled on click is an AND of equality predicates on each column. seed.sql's `inventory_warehouse_fk` is the test case — if any surface forgets to bundle the two columns, it surfaces as a wrong-row jump.
- **Junction misclassification.** A table that *looks* like a junction (two FKs, both in the PK) but has a `quantity` or `unit_price` column is NOT a junction — it's a first-class entity that happens to point at two parents. `order_items` is the trap. Allow only audit columns (`created_at`, `updated_at`) beyond the FK columns; everything else disqualifies.
- **Self-referential traversal loops.** A user clicks "manager" five times and ends up viewing the same row. Breadcrumbs must show the chain honestly (no deduplication); the inspector panel for `employees` must still surface `reports_to` (reverse) without infinite recursion at render time.
- **Counts fan out to N queries.** Per-row `countRows(filter)` calls for 100 visible rows × 2 relations is 200 queries. Always batch through `GROUP BY` in `getCountsForRows`. Tests should assert one round trip per batch.
- **Custom relations stored at the wrong scope.** Tying them to ConnectionProfile id means renaming a connection orphans the relations. The scope is the (host, port, database) tuple. Make this explicit in the metadata schema.
- **Display label lookups N+1.** Once the FK target row's PK is known, the grid wants a label per row. Batch with `IN` lists, not one query per cell. Test that the underlying SQL is a single `WHERE pk IN (...)`.
- **Forward navigation forgets to verify the row exists.** A stale schema or a deleted row would otherwise open an empty filtered tab. `data.getRowByKey` returning null is the signal to surface "Row not found" rather than opening an empty tab.
- **Cancellation on scroll.** Cardinality batch requests should be abortable; scrolling past rows that haven't returned yet should cancel them. The existing tRPC client supports observer cancellation — wire it from the virtualizer.
- **DisplayConfig templates eat XSS-like markup.** Templates resolve to display strings, then render through React text nodes — never `dangerouslySetInnerHTML`. Treat the template as plain text with `{column}` substitution only.

---

## After Phase 2

Phase 3 (Perspectives v1) makes the relations + display configs persistable as saved presentations. A perspective declares structured joins by referencing the same `RelationDef`s Phase 2 surfaces. Engine-side cardinality enforcement ("n:1 / 1:1 only from the source side") will live in the perspective planner, not in this phase — but the relations index from 2.1 is what it'll consume.

The shape stays: one prompt = one commit; verify each; the prompts get terser as the agent accumulates context.
