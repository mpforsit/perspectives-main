# Perspectives — Phase 3 prompts for AI-assisted coding

Phase 3 builds the feature the product is named after: saveable, reusable presentations of data. Everything lands on rails that already exist:

- The DSL is **already complete** for this phase. `PerspectiveDef`, `JoinDef`, `ParamDef`, `FilterBarConfig`, `ColumnFormat`, and the `trustedSql` flag are all in `packages/dsl/src/schemas.ts` since Phase 0/1. Phase 3 writes zero new DSL shapes — it makes the existing ones executable and editable.
- `QueryPlan.joins: JoinDef[]` already exists in `packages/engine/src/adapter.ts`; the Postgres compiler currently throws `ValidationError("Joins are not supported in this phase")`. That guard is the door Phase 3 opens.
- The relations index from Phase 2 (`listRelations`, deterministic Crockford-base32 ids) is what `JoinDef.via` resolves against. Every relation id already passes the DSL's ULID validation — the 2.1 round-trip test guaranteed it.
- `metadata-sqlite` already has a `PerspectivesStore` implementing `CRUDStore<PerspectiveDef>` — but it is **not scoped** yet (relations and display configs got their scope columns in migrations 0002/0003; perspectives need the same treatment in 3.3).

Same discipline as Phases 1–2: **one prompt = one commit.** Verify after each.

---

## Scope decisions for this phase (settled, don't relitigate mid-phase)

1. **Custom m:n relations are IN** (deferred from 2.4). They extend the relations editor and power *navigation* (inspector counts, collapsed jumps). They remain **rejected as join targets** — m:n joins are row-multiplying and stay out until aggregations land.
2. **Schema drift handling is IN** (docs/plan.md §8 says "build this in around Phase 3"). Scope: validate on open, a persistent "broken" state with a precise error, no crash. Interactive re-binding UI is Phase 4+.
3. **Row-multiplying joins stay OUT.** The engine enforces 1:1 / n:1 from the source side at plan time. This is an engine rule, not a schema rule — the DSL deliberately doesn't encode it.
4. **`currentUser` dynamic values stay OUT.** Shared mode doesn't exist yet. The engine rejects them with an error naming Phase 6, not a generic failure.
5. **Filter-bar runtime values are NOT part of the saved perspective.** What the user types into the filter bar is session state. Only the *configuration* (which fields, which ops, which params, defaults) is persisted.

---

## What changed since Phase 2 (read before starting)

- **The compiler already compiles computed columns** (`(${src.computed})` in `packages/adapter-postgres/src/compiler.ts`) — but computed sources and SQL bases are arbitrary-SQL escape hatches. The `trustedSql` flag on `PerspectiveDef` gates them (AUDIT-CODEX finding #5). Phase 3 makes that gate real: untrusted perspectives with computed columns or SQL bases must be rejected at compile time, and every interactive save path in the desktop app marks `trustedSql: true` because the local user typed it.
- **The compiler currently rejects**: SQL bases, joins, sort-by-joined-column, join-qualified filter columns, and dynamic values other than `today`. 3.1 and 3.2 remove exactly these rejections — nothing else about the compiler's structure changes.
- **Read-only stays read-only.** Phase 3 adds no mutation paths. Perspectives read data; editing through perspectives is Phase 4.
- **The metadata scope convention is established**: relations and display configs key off the `(host, port, database)` tuple so renaming a connection profile orphans nothing. Perspectives adopt the same scope in 3.3.
- **The grid stays presentational.** Column formatting (3.5) lands as per-column render config passed through props, exactly like `ForwardLink` did in 2.2. No fetching, no DSL awareness inside `DataGrid`.

Keep these files in the AI's context throughout Phase 3: `docs/plan.md` (§4, §7 Phase 3), `packages/dsl/src/schemas.ts`, `packages/engine/src/adapter.ts` (QueryPlan), `packages/engine/src/service.ts`, `packages/engine/src/metadata.ts`, `packages/adapter-postgres/src/compiler.ts`, `apps/desktop/src/renderer/src/session/tabs-storage.ts`, `TableView.tsx`, `SqlConsoleView.tsx`, and `seed.sql`.

---

## System primer addendum (paste once at session start, after the Phase 1 + 2 primers)

```
We are now in Phase 3 (Perspectives v1) per docs/plan.md §7. Rules that
join the Phase 1 + 2 hard rules:

- PerspectiveDef from packages/dsl is canonical. Every save round-trips
  through validatePerspective() BEFORE persisting; a perspective that
  fails validation is a bug in the caller, never "fixed up" silently.
- Joins are resolved through RelationDef ids (JoinDef.via). The engine
  enforces cardinality at plan time: effective cardinality from each
  source side MUST be 1:1 or n:1. Row-multiplying joins are rejected
  with an error that names the offending join alias and relation.
- trustedSql is a security boundary, not a hint. Computed column sources
  and base.kind "sql" compile ONLY when trustedSql === true. Interactive
  desktop edits set it true; imports set it false until the user
  explicitly re-trusts. No path may copy trustedSql from input payloads.
- Filter-bar runtime values are session state, never persisted into the
  PerspectiveDef.
- All new surfaces go through the existing tRPC seam. No raw SQL outside
  packages/adapter-postgres (computed expressions and SQL bases pass
  through as opaque strings — the adapter never builds SQL from user
  input by concatenation anywhere else).
- Perspectives persist in the metadata store under the same
  (host, port, database) scope as relations and display configs.

Stop when the Phase 3 deliverables in docs/plan.md are met. Phase 4
(editing, audit, safety) is next.
```

---

## Prompt 3.1 — Join compilation: engine planner rules + Postgres JOIN support

```
Make QueryPlan.joins real, end to end. Engine-side semantic validation,
adapter-side SQL generation. No UI in this prompt.

In packages/engine (new module, e.g. src/joins.ts):
- resolveJoins(plan-or-def, relations: RelationDef[]) — a PURE function
  that takes the join list and the relations index and returns a
  resolved join graph or a typed error. It enforces, in order:
    * every JoinDef.via resolves to a known RelationDef;
    * alias uniqueness, and no alias colliding with the base table name;
    * fromAlias chains reference an EARLIER join only (no cycles, no
      forward references);
    * direction is required iff the relation is self-referential
      (from.table == to.table), and rejected otherwise ONLY if it
      contradicts the inferred direction;
    * cardinality: walking from the source side (base or fromAlias),
      the effective cardinality must be 1:1 or n:1. Joining to the
      "many" side of a 1:n relation is rejected. ANY many-to-many
      relation is rejected as a join target — junction m:n relations
      exist in listRelations for navigation, and must produce the
      clearest error of all: name the alias, the relation, and say
      row-multiplying joins need aggregations (not yet supported).
  Error type: a dedicated JoinValidationError carrying { alias, viaId,
  reason } so the UI (3.5) can surface it inline later.
- The resolved output carries, per join: target schema/table, the ON
  column pairs (source-side columns ↔ target-side columns, compound
  FKs as ordered tuples), join type, and the optional join filter.

In packages/adapter-postgres (compiler.ts):
- Remove the joins ValidationError. Compile resolved joins as
  LEFT/INNER JOIN with quoted aliases; ON clauses AND every column
  pair (compound FKs!). Join filters compile into the ON clause for
  left joins, into WHERE for inner joins (per the JoinDef docstring).
- Remove the sort-by-joined-column and join-qualified-filter-column
  rejections: qualified references compile as "alias"."column".
- Base-table columns keep compiling unqualified? NO — once joins are
  present, qualify EVERYTHING with the base alias to avoid ambiguous
  column errors. Pick a stable base alias (the quoted table name or
  "base") and document the choice in the adapter README.
- Keyset pagination over joined plans: the cursor tuple must remain
  unique. When the sort references joined columns, append the base
  table's PK columns as tiebreakers (the Phase 1 keyset shape doc
  covers the tuple form). paginateKeyset must work unchanged from the
  caller's point of view.

Tests (unit fixtures + testcontainers against seed.sql):
- resolveJoins unit tests with hand-built RelationDef fixtures: unknown
  via; duplicate alias; forward-referencing fromAlias; self-referential
  without direction (employees.manager_id); m:n rejection
  (customer_tags relation id); 1:n wrong-side rejection
  (customers -> orders from the customers side).
- Integration: the Appendix B shape from docs/plan.md —
  order_items + order (inner) + product (left) + customer (left via
  fromAlias "order") returns one row per order item with joined
  columns populated; row count equals the unjoined count.
- Compound-FK join: inventory joined to warehouses via the compound
  relation produces an ON with BOTH column pairs.
- Self-referential: employees joined to their manager (direction
  "forward") returns the manager's name; direction "reverse" is
  rejected as row-multiplying (a manager has many reports).
- Keyset pagination across a joined plan sorted by
  order.placed_at: two pages, no duplicates, no gaps (the tiebreaker
  test).
- Left-join NULL semantics: a row whose left-joined target is missing
  still appears, with NULLs in the joined columns.
```

**Verify:** `pnpm typecheck && pnpm test` green. The compiler snapshot tests show qualified identifiers everywhere once a join is present. The m:n rejection error message names the alias and the relation and mentions aggregations.

---

## Prompt 3.2 — Perspective execution: def → plan, params, trustedSql enforcement

```
Give the engine a path that runs a PerspectiveDef. Still no UI.

In packages/engine:
- perspectiveToQueryPlan(def, opts) — PURE. Maps PerspectiveDef to
  QueryPlan: base (table or sql), joins passed through for resolveJoins,
  columns (base / joinAlias / computed), filters, sort, page size.
  Hidden columns (ColumnDef.hidden) are EXCLUDED from the plan's select
  list — hidden means "not fetched", not "fetched and concealed".
- Parameter resolution. opts.params is a Record<string, LiteralValue>.
  A FilterLeaf whose value is { kind: "param", name } resolves from
  opts.params; ParamDef.default fills gaps; a missing required param is
  a typed error (the UI will render it as an empty-state, not a toast);
  a missing optional param DROPS that leaf from the filter tree (a
  blank filter-bar input means "don't filter on this").
  Type coercion follows ParamDef.type (text/number/boolean/date/
  datetime); a value that doesn't coerce is a typed error naming the
  param.
- Dynamic values: "today" already compiles. Add "interval" (compiles to
  now() - interval '<expression>' — the expression is validated against
  a strict grammar: /^\d+ (minutes?|hours?|days?|weeks?|months?|years?)$/,
  NOT passed through raw). "currentUser" is rejected with an error
  naming shared mode / Phase 6.
- trustedSql enforcement AT COMPILE TIME: perspectiveToQueryPlan
  refuses computed column sources and base.kind "sql" unless
  def.trustedSql === true. The error names the column alias or says
  "SQL base". This is in addition to (not instead of) any UI gating.
- SQL bases: compile base.kind "sql" as a subquery:
  SELECT <columns> FROM (<query>) AS base [WHERE ...] [ORDER BY ...].
  ParamDefs bind as $1..$n in the user's query — positional order is
  the ParamDef array order. Document that ORDER BY inside the user's
  SQL is allowed but the perspective's sort wins (it wraps outside).
  Remove the compiler's SQL-base ValidationError. Keyset pagination
  over SQL bases: fall back to LIMIT/OFFSET pagination (no reliable
  key), and mark the PageResult so the UI can show offset-style paging.
  Document this trade-off in the adapter README.
- EngineService method:
    runPerspective(connectionId, def, opts: { params?, cursor?, pageSize? })
      -> PageResult
  Pipeline: validatePerspective(def) → resolveJoins → 
  perspectiveToQueryPlan → paginateKeyset (or offset path for SQL
  bases). Read-only: reuse the session/connection guards that
  runReadOnlyQuery relies on so a perspective can never mutate.

tRPC: perspectives.run({connectionId, def, params?, cursor?}).
(Runs an UNSAVED def too — the editor needs live preview in 3.5.)

Tests:
- Param resolution: default applied; required-missing typed error;
  optional-missing drops the leaf; number coercion "42" -> 42; bad
  coercion errors name the param.
- trustedSql: an untrusted def with a computed column is rejected by
  perspectiveToQueryPlan (unit) AND by the compiler if reached
  (defense in depth — both layers test independently).
- interval grammar: "7 days" compiles; "7 days); DROP TABLE" is
  rejected by the grammar, never reaching SQL.
- SQL base integration: a raw query with $1 bound from a ParamDef
  returns filtered rows; the perspective's outer sort overrides the
  inner ORDER BY; pagination pages without error.
- The Appendix A sample perspective (packages/dsl/examples/
  active-eu-customers.json) runs against the seed DB end to end.
```

**Verify:** The Appendix A example runs. An untrusted perspective with a computed column fails with the trust error from both layers. `'7 days); DROP TABLE students;--'` as an interval expression is rejected by grammar validation.

---

## Prompt 3.3 — Perspective persistence: scoped store + CRUD + round-trip validation

```
Persist perspectives under the same (host, port, database) scope as
relations, with validation on every write.

metadata-sqlite:
- Migration 0004_perspectives_scope.sql: add the scope column to the
  perspectives table, backfill existing rows (there shouldn't be any in
  the wild, but the migration must not assume), index on scope.
- PerspectivesStore gains the same scope-aware API shape as
  RelationsStore: listForScope(scope), create(scope, def),
  update/delete by id. Keep CRUDStore compatibility if other code
  depends on it, but the engine talks scope-aware.

packages/engine (EngineService):
- savePerspective(connectionId, def) — round-trips through
  validatePerspective BEFORE persisting (per the DSL file's rule 4:
  strip unknown fields, reject invalid). Refreshes updatedAt. If the
  def has joins, resolveJoins runs against the CURRENT relations index
  so a perspective referencing a deleted relation can't be saved.
  trustedSql handling: the SERVER SIDE decides. savePerspective takes
  the def without trusting its trustedSql field; an explicit
  `trusted: boolean` argument (from the tRPC layer, which knows the
  call came from the interactive renderer) is what's persisted.
  No path may launder trust from an imported payload.
- listPerspectives(connectionId) -> PerspectiveDef[] (scope-resolved)
- getPerspective(connectionId, id) -> PerspectiveDef | null
- deletePerspective(connectionId, id)

tRPC router perspectives.*: list, get, save, delete, plus run from 3.2.
Input schemas reuse the DSL Zod schemas via the exported `schemas`
object — do NOT redefine PerspectiveDef shapes in inputs.ts (the
FilterGroupShape export exists precisely for this).

Tests:
- Save → list → get round-trip preserves every field including joins,
  filterBar, formats, ParamDefs.
- A def that fails validatePerspective is rejected and NOT persisted.
- A def whose JoinDef.via references a nonexistent relation is
  rejected at save time with the JoinValidationError from 3.1.
- Scope: two connection profiles pointing at the same
  (host, port, database) see the same perspectives; renaming a profile
  changes nothing.
- trustedSql: a save with trusted=false persists trustedSql=false even
  if the payload claimed true.
```

**Verify:** Save a perspective through tRPC, rename the connection profile, relaunch — the perspective is still there. Attempt to save a perspective with a bogus `via` id — clean rejection, nothing persisted.

---

## Prompt 3.4 — "Save as perspective" + sidebar + perspective tabs

```
The first user-visible perspective feature: save the current table view
state, see it in the sidebar, reopen it with one click.

Renderer:
- OpenTab union gains { kind: "perspective"; perspectiveId: string }.
  Update tabs-storage's discriminated-union Zod schema + a round-trip
  test. The tab persists the ID ONLY — the def is loaded on mount so
  edits elsewhere are picked up. A perspective tab whose id no longer
  resolves renders a "Perspective was deleted" placeholder, not a
  crash.
- "Save as perspective" action in TableView's toolbar: snapshots the
  CURRENT state (visible columns in their order, active sort, active
  filters — the FilterGroup that filteredTable tabs already carry) into
  a PerspectiveDef with a generated ULID, createdBy from a local-user
  constant (single-user mode), filterBar initially empty, and prompts
  for a name (shadcn dialog: name + optional description). Saves via
  perspectives.save with trusted=true (interactive path).
- PerspectiveView component: loads the def by id, runs it through
  perspectives.run with useTablePage-style pagination, renders through
  the SAME DataGrid. Column headers use ColumnDef.alias when set.
  Reuse the existing grid/count plumbing — a perspective view is a
  TableView variant, not a fork. Extract shared logic rather than
  copy-pasting (a usePerspectivePage hook mirroring useTablePage is
  acceptable; duplicated pagination logic is not).
- Sidebar: a "Perspectives" section above the schema tree in
  SchemaSidebar, listing perspectives for the active connection
  (perspectives.list), alphabetical, with a context menu: open,
  rename, duplicate, delete (confirm dialog). Click opens the
  perspective tab (focus existing tab if already open).
- Default page size + default sort from the def apply on open.

Tests:
- tabs-storage round-trip with the new variant.
- A renderer test for the state-snapshot mapper: given the TableView
  state (columns, sort, filter), the produced PerspectiveDef validates
  through validatePerspective and contains exactly the visible columns
  in order.
- PerspectiveView with a mocked run endpoint renders rows and applies
  the def's sort/pageSize.
```

**Verify:** Open `orders`, hide two columns, sort by `placed_at` desc, filter to `status = 'paid'`, save as "Paid orders". The sidebar shows it; closing and reopening the tab restores the exact state; relaunching the app restores the tab. Deleting the perspective from the sidebar turns an open tab into the deleted-placeholder.

---

## Prompt 3.5 — Perspective editor: columns, sort, formatting, computed columns

```
The editor is the surface that will accrete features for months — keep
the data model strict and the components composable.

Renderer (a PerspectiveEditor, opened from PerspectiveView's toolbar
"Edit perspective" and from the save-as dialog's "Save and edit"):
- Layout: left panel = editing controls in sections; right panel = live
  preview running the DRAFT def through perspectives.run (debounced;
  unsaved draft state in React state — never persisted until Save).
- Columns section: checkbox list of base-table columns (from the
  schema snapshot) plus joined-table columns per join alias; drag to
  reorder (the selected set defines ColumnDef order); per-column
  controls: alias (display name), width, hidden toggle, format
  dropdown.
- Formats: implement renderers for the ColumnFormat enum in the grid's
  cell layer (presentational, prop-driven, like ForwardLink):
    * json — pretty-printed, collapsed to first line, CellDetail on click
    * code — monospace
    * currency — Intl.NumberFormat, locale-aware
    * datetime / date / time — Intl.DateTimeFormat with timezone
    * boolean — check/cross icon
    * url — clickable (opens externally via shell, NOT in-app)
    * markdown / image — placeholder rendering is fine this phase
      (markdown as plain text, image as a link); note it in the code.
- Sort section: ordered list of SortDef rows (column picker including
  joined aliases, asc/desc, nulls first/last), drag to reorder.
- Computed columns: an "Add computed column" affordance — SQL
  expression + alias + format. Saving a def containing computed
  columns from the editor sets trustedSql=true (interactive path,
  3.3's server-side trust argument). Show a subtle "runs raw SQL"
  hint on computed columns.
- Joins section (editor part — the semantics landed in 3.1):
  add/remove joins. Add = pick a relation from listRelations filtered
  to those whose source side matches the base table or an existing
  alias (chains), pick inner/left, auto-suggest an alias from the
  relation label. The m:n and wrong-side relations appear DISABLED
  with the 3.1 rejection reason as a tooltip — showing them greyed
  out teaches the model; hiding them would look like a bug.
- Editor-level validation: run the draft through validatePerspective
  on every change; render field-level errors inline. The Save button
  is disabled while invalid. JoinValidationErrors from the preview
  surface on the joins section.

Tests:
- Column reorder produces the right ColumnDef order (renderer unit).
- Format renderers: currency/datetime/boolean/json snapshot tests.
- The joins picker disables an m:n relation and a wrong-side 1:n
  (mocked relations index).
- A draft with a duplicate join alias shows an inline error and
  disables Save.
```

**Verify:** Build the docs/plan.md Appendix B shape in the editor against the seed DB: order_items + order + product + customer (chained via order). The preview shows product names and customer emails; trying to add the reverse orders join (customer side) is disabled with the cardinality tooltip. Set `unit_price` to currency — it renders formatted. Save, reopen: everything persists.

---

## Prompt 3.6 — Filter builder + filter bar with bound parameters

```
Two related surfaces: the EDITOR's filter tree (baked-in filters +
filter bar config) and the VIEWER's filter bar (runtime inputs).

Editor — filters section:
- A recursive AND/OR group builder over FilterGroup: add leaf, add
  nested group, toggle and/or, remove. Column picker includes joined
  aliases.
- Type-aware operator menus, derived from the schema snapshot's column
  types:
    * text: eq, neq, ilike, like, not_ilike, in, is_null, is_not_null
    * numeric: eq, neq, lt, gt, lte, gte, between, in
    * date/timestamp: same as numeric plus dynamic values
    * boolean: eq, is_null
    * enum: eq, neq, in, nin (values from pg introspection if the
      snapshot has them; free-text fallback otherwise)
    * array/jsonb: contains, contained_by
- Value editors per op: single input, list builder for in/nin, two
  inputs for between, none for is_null/is_not_null.
- Dynamic date values: a value-mode toggle on date columns —
  literal | "today ± N days" ({ kind: "today", offset }) |
  interval ({ kind: "interval", expression } constrained to the 3.2
  grammar via a number + unit picker, NOT a free-text field).
- Parameter binding: a value-mode "parameter" that creates/links a
  ParamDef (name, type inferred from the column, optional default,
  required toggle) and sets the leaf's value to
  { kind: "param", name }. Editor lists all params with usage counts;
  deleting a param that's still referenced is blocked with a pointer
  to the referencing leaves.

Editor — filter bar section:
- Configure FilterBarConfig: which fields are visible, which collapsed
  (behind a "more filters" expander), per-field label and defaultOp.
  Reorder by drag. A param-bound leaf's field shows its param binding.

Viewer — the filter bar (PerspectiveView, above the grid):
- Renders visible fields as inputs (type-aware: text, number, date
  picker, boolean select, enum select); collapsed fields behind an
  expander chip showing the count of active collapsed filters.
- Param-bound fields feed perspectives.run's params record. Non-param
  fields contribute session-only FilterLeaf entries ANDed onto the
  def's baked-in filters (they never mutate the def).
- A required param without a value renders the grid's empty state
  with "Provide <param>" — the 3.2 typed error mapped to UX, not a
  toast.
- "Reset filters" clears runtime state back to defaults.

Tests:
- Filter tree editing round-trips through the FilterGroup schema
  (renderer unit).
- Operator menus per column type (unit, mocked snapshot).
- Param lifecycle: binding creates the ParamDef; unbinding the last
  usage offers deletion; blocked delete when referenced.
- Viewer: param input feeds params; blank optional param drops the
  leaf (asserts against the 3.2 semantics through a mocked run).
```

**Verify:** On "Paid orders", bake in `status = 'paid'`, add a filter-bar field `placed_at >= {since}` with `since` defaulting to today−30. Open the perspective: the bar shows a date input pre-filled; clearing it shows all paid orders; the def on disk never contains the typed value. A required param with no default renders the "provide a value" empty state on open.

---

## Prompt 3.7 — SQL perspectives: save parameterized queries from the console

```
Make the Phase 1 SQL console a source of perspectives.

Renderer (SqlConsoleView):
- "Save as perspective" in the console toolbar, enabled after a
  successful run. Detects positional parameters ($1..$n) in the query
  text; for each, the save dialog asks for name + type + optional
  default + required (prefilled param names p1..pn, editable). The
  console itself gains the ability to RUN parameterized queries: when
  the query contains $n placeholders, prompt for values before
  executing (this also fixes the Phase 1 gap where $n queries just
  errored).
- The saved def: base.kind "sql" with the query text and ParamDef
  array; columns default to { computed: ... }? NO — columns for SQL
  bases come from the result-set shape: save them as
  { column: <output name> } entries in result order (the subquery
  compilation in 3.2 makes output names addressable). Sort empty,
  filters empty, filterBar listing every param as a visible field.
  trustedSql=true (interactive path).
- SQL perspectives open in the same PerspectiveView; the filter bar
  renders the params; the grid renders the result through the same
  formatting pipeline. The editor (3.5) opens for SQL perspectives
  with the joins/columns sections replaced by a read-only SQL panel +
  an "Edit in console" escape hatch (full SQL editing inside the
  editor is future work; don't build two SQL editors).

Engine:
- Nothing new — 3.2 built SQL-base compilation and offset pagination.
  Confirm the read-only guard: a saved SQL perspective containing a
  mutation statement fails at run time exactly like it does in the
  console today (same guard, same error type). Add the test.

Tests:
- Param detection: "$1 ... $2" produces two ParamDef slots; "$1 used
  twice" produces one; no params produces none.
- Round-trip: saved SQL perspective validates, lists, opens, runs
  with param values from the filter bar.
- A SQL perspective with an INSERT is rejected at run (engine test).
```

**Verify:** In the console, run `SELECT * FROM orders WHERE status = $1 AND placed_at > $2` (prompted for values), save it as "Orders by status since". It appears in the sidebar; opening it shows two filter-bar inputs; running it with `'paid'` and a date returns the same rows as the console did.

---

## Prompt 3.8 — Export / import as JSON files

```
Perspectives are portable long before sync exists. Export bundles what
a perspective needs; import validates and distrusts.

Bundle format (new, in packages/dsl — it's a persisted shape, so it
lives with the schemas):
- PerspectiveBundle = {
    kind: "perspective-bundle", formatVersion: 1,
    perspective: PerspectiveDef,
    relations: RelationDef[],   // every RelationDef reachable from
                                // the perspective's joins, and ONLY those
    displayConfigs?: DisplayConfig[]  // optional, for referenced tables
  }
  Zod schema + validateBundle(). NOTHING connection-related is ever in
  a bundle — no ConnectionProfile, no host, no credentials. Add the
  test that a bundle round-trip never contains those key names.

Export (renderer context menu on a sidebar perspective + editor
toolbar):
- Electron save dialog → writes pretty-printed JSON. The engine
  assembles the bundle (it owns the relations index); tRPC:
  perspectives.exportBundle({connectionId, id}) -> bundle. The FILE
  write happens in the main process (dialog + fs), not the renderer.

Import (sidebar "Import perspective…"):
- Open dialog → validateBundle → resolution steps, each with clear UX:
    * Relations: for each bundled RelationDef, if a relation with the
      same deterministic id exists in the target scope, use it. If
      not, and it's source "schema", re-derive from the CURRENT scope's
      snapshot (same FK = same id, per 2.1) — if absent, the import
      dialog lists it as missing. Custom relations get created in the
      target scope (source stays "custom").
    * Id collision: an incoming perspective whose ULID already exists
      in scope imports as a COPY with a fresh ULID and "(imported)"
      suffix — never overwrite silently.
    * TRUST: imported perspectives persist with trustedSql=false,
      ALWAYS — regardless of the bundle's flag (3.3's server-side
      trust argument does this for free; the test proves it). If the
      def contains computed columns or a SQL base, the import
      succeeds but opening it shows the trust-gate error state with
      an explicit "Review & trust" action: a dialog showing EVERY
      computed expression and the full SQL, requiring an explicit
      confirmation, which re-saves with trusted=true.
- Schema mismatch (missing tables/columns) does NOT block import —
  the perspective imports and lands in the 3.10 broken state, which
  explains exactly what's missing.

Tests:
- Bundle round-trip: export → import into an EMPTY scope (fresh
  metadata store) recreates the perspective + custom relations;
  schema-derived relations re-resolve by deterministic id.
- Import of a trusted-flagged bundle persists trustedSql=false.
- Id collision imports as a copy.
- The no-credentials key-name test.
- Review-&-trust flow: after confirmation the perspective runs.
```

**Verify:** Export the Appendix-B-style joined perspective, wipe the metadata DB (fresh profile against the same seed DB), import the file: joins resolve via re-derived relation ids and the perspective runs. Import a bundle with a computed column: it opens in the trust-gate state; "Review & trust" shows the expression; confirming makes it run.

---

## Prompt 3.9 — Custom m:n relations (the 2.4 deferral comes home)

```
Extend the custom-relations editor with many-to-many via an explicit
junction table. Powers NAVIGATION (inspector counts, collapsed jumps).
Stays REJECTED as a join target (3.1 already enforces that — the test
exists; do not weaken it).

UI (the Relations view from 2.4):
- Cardinality gains "many-to-many". Selecting it reveals a junction
  section: junction schema + table, fromCols (junction → source
  mapping), toCols (junction → target mapping); column multi-selects
  with count-match validation against the source/target column
  selections.
- Validation (renderer UX + engine authority, same split as 2.4):
    * fromCols/toCols column counts match their respective ends;
    * the junction pairs are FK-like: engine verifies the mapped
      columns exist and their types are compatible (an actual FK
      constraint is NOT required — that's the point of custom);
    * duplicate detection includes junction-derived m:n RelationDefs
      from 2.3 (same junction + same ends = duplicate, refuse).
- Labels: forward/reverse strings, same as 2.4.

Engine:
- createCustomRelation accepts cardinality "many-to-many" with the
  junction field populated (the RelationDef schema has supported this
  shape since Phase 0; only the 2.4 scope cut blocked it). Server-side
  validation per the above.
- getReferencingCounts and the inspector's collapsed two-hop jump
  treat a custom m:n exactly like a detected junction m:n — the
  Phase 2 code paths key off RelationDef.cardinality + junction, so
  verify this is true rather than assuming; if 2.3 special-cased
  detected junctions, generalize now.

Tests:
- Create a custom m:n over a junction WITHOUT FK constraints (stage
  via a test fixture table, or reuse customer_tags with its policy
  set to "never" so detection is out of the way — which also proves
  custom m:n and junction policy compose).
- Inspector counts for the custom m:n match the detected-junction
  ground truth from 2.3's tests.
- resolveJoins still rejects the custom m:n as a join target.
- Duplicate-of-detected-junction refused.
```

**Verify:** Set junction policy "never" on `customer_tags` (the m:n vanishes), then define the same relation manually as a custom m:n. The customer inspector shows "3 tags" again, the collapsed jump works, and the perspective editor's join picker shows the custom m:n greyed out with the cardinality tooltip.

---

## Prompt 3.10 — Schema drift: broken perspectives fail gracefully

```
A perspective references tables/columns/relations by name and id. When
the database moves underneath it, the perspective must degrade into an
explanation, never a crash or a raw pg error.

packages/engine:
- checkPerspective(def, snapshot, relations) -> DriftReport — PURE.
  Verifies: base table exists; every base/joined column referenced by
  columns, sort, filters, and filterBar exists; every JoinDef.via
  resolves and still passes resolveJoins; every ParamDef referenced by
  a param leaf exists (and vice versa). SQL bases: the query itself
  can't be statically checked — report only the def-level issues and
  let run-time errors surface through the existing error mapping.
  DriftReport = { ok: true } | { ok: false, problems: Problem[] }
  where Problem carries { kind, where, missing } — machine-readable
  enough for a future re-bind UI (Phase 4+), human-readable now.
- runPerspective consults checkPerspective before compiling; a drifted
  def returns a typed DriftError carrying the report (NOT a generic
  ValidationError — the UI needs to distinguish).
tRPC: perspectives.check({connectionId, id}) for the sidebar; run
already carries the DriftError.

Renderer:
- PerspectiveView renders DriftError as a full-pane state: perspective
  name, the problem list ("column `orders.staus` no longer exists",
  "relation for join `customer` was deleted"), and a "Re-check" button
  (refreshes the schema snapshot and re-runs). No toast, no crash.
- Sidebar: perspectives with a failed check get a warning glyph.
  Checks run lazily (on section expand / connection open), batched,
  cached per schema snapshot — do NOT hammer checkPerspective per
  perspective per render.
- The editor opens fine on a broken perspective (that's how the user
  fixes it): missing columns/joins show inline as errors using the
  3.5 validation surfaces, and removing the offending piece heals it.

Tests:
- checkPerspective unit matrix: dropped base table; dropped base
  column referenced only in filterBar; dropped joined column in sort;
  deleted relation; param leaf without ParamDef; healthy def -> ok.
- Integration: save a perspective, ALTER TABLE ... RENAME COLUMN in
  the container, refresh schema — run returns DriftError naming the
  column; renaming it back heals without any metadata change.
- Renderer: DriftError pane renders problems; sidebar glyph appears.
```

**Verify:** Save a perspective on `orders` using `status` in a filter. In psql: `ALTER TABLE orders RENAME COLUMN status TO order_status`. Refresh — the perspective opens into the drift pane naming exactly `orders.status`, the sidebar shows the warning glyph, the app never crashes. Open the editor, remove/replace the column, save — healed.

---

## Definition of done for Phase 3

- A user opens a frequently-used table, customizes columns/sort/filters once, saves it as a perspective, and reopens it with one click in exactly that state — across relaunches.
- The docs/plan.md Appendix B shape works end to end: order_items joined to order (inner), product (left), and customer (chained via order), with formatted columns, built entirely in the editor against the seed DB.
- The engine rejects joining to the "many" side of a 1:n relation and any m:n relation with an error naming the join alias and relation — and the editor's join picker communicates the same rule *before* the user hits the error.
- Filter bar with bound parameters: `{since}` in a filter is an input in the bar; typed values are session state and never persisted into the def; required-without-value renders an explanatory empty state.
- A parameterized SQL query saved from the console behaves like any other perspective: sidebar, filter bar with `$n` params, formatting — and mutations through it are impossible.
- Export/import round-trips through a fresh metadata store: joins re-resolve via deterministic relation ids, credentials never appear in bundles, imports are untrusted until explicitly reviewed.
- `trustedSql` holds as a boundary: no untrusted def with computed columns or a SQL base compiles; no import or save path launders trust; both the engine and adapter layers enforce it independently.
- Custom m:n relations work for navigation exactly like detected junctions, and are still refused as join targets.
- A renamed or dropped column turns a perspective into a precise, recoverable error state — never a crash — and the editor is the repair tool.
- Every persisted perspective survives `validatePerspective()` round-trips on save AND load; `packages/dsl/examples/` gains at least: a joined perspective, a parameterized SQL perspective, and a filter-bar-heavy perspective (tests-as-documentation, per docs/plan.md §8).
- `pnpm typecheck && pnpm lint && pnpm test` green; integration tests pass against testcontainers; still zero mutation paths to the target DB.

**The Phase 3 screencast:** "I set up this view once — columns, joins, filters, formatting — and saved it. Now it's one click. This one's a raw SQL query with parameters — same thing. And here's the same perspective imported on a fresh machine." If a viewer says "I never have to set up that view again", Phase 3 is done.

---

## Common failure modes specific to Phase 3

- **Trust laundering.** The single most important invariant this phase: `trustedSql` is decided server-side per save path (interactive = true, import = false), never copied from a payload. If any tRPC input schema lets the renderer set it directly and the router persists it verbatim, an imported bundle becomes arbitrary SQL execution. The 3.3 and 3.8 tests exist to catch exactly this; keep them.
- **Injection through the "safe" dynamic values.** `{ kind: "interval", expression }` compiles into SQL. The strict grammar (number + unit) is the defense; a free-text passthrough reintroduces injection through a field that looks harmless. Same alertness for anything else that compiles user text into SQL outside the computed/SQL-base trust gate.
- **Keyset pagination breaking under joined sorts.** A sort on `order.placed_at` alone is not a unique cursor — page 2 skips or repeats rows nondeterministically (only under load, naturally). Always append the base PK as tiebreaker; the two-page integration test is the guard.
- **Ambiguous column references after the first join.** Unqualified base columns compile fine until a joined table has a column with the same name, then every query breaks. Qualify everything the moment joins exist — retrofitting qualification later touches every compiler path.
- **The editor mutating the saved def during preview.** Draft state lives in React state and hits `perspectives.run` as an unsaved def. If preview "temporarily" saves, canceling the editor leaves corrupted perspectives. One-way data flow: def → draft → (Save) → def.
- **Filter-bar values leaking into the def.** The symptom: user types into the bar, closes the tab, and the perspective now permanently filters on it. Runtime state and definition state must have different types in the renderer so the compiler catches accidental crossings.
- **Hidden columns still fetched.** `hidden: true` must exclude the column from the QueryPlan select list. "Fetch and hide" ships megabytes of invisible JSONB and, in Phase 6, becomes a data-exposure bug when hidden means "not allowed to see".
- **SQL-base perspectives pretending to keyset-paginate.** There's no reliable key inside arbitrary SQL. Offset pagination is correct there — but it must be explicit in the PageResult so the UI doesn't render keyset affordances that silently skip rows.
- **Import overwriting by ULID.** Two machines, same exported file, re-imported after edits — silent overwrite loses work. Collision → copy with fresh ULID, always.
- **Bundles accidentally including connection material.** Nobody puts credentials in a bundle on purpose. It happens through "just serialize the whole context object". The key-name test (no `host`, `password`, `connection` keys anywhere in a bundle) is cheap and catches refactoring accidents.
- **Drift checks on the hot path.** `checkPerspective` per perspective per sidebar render will hammer introspection. Check against the cached snapshot, invalidate on schema refresh, batch the sidebar pass.
- **Param name drift.** Renaming a param in the editor must update every referencing leaf atomically, or the def validates (schema-wise) but every run fails with "missing param". The 3.6 usage-count machinery is what prevents orphaned references — wire rename through it too.

---

## After Phase 3

Phase 4 (editing, audit, safety) makes perspectives writable: inline editing with the base-table-only rule for joined perspectives (the read-only `joinAlias` columns from this phase become the enforced edit boundary), optimistic locking, the local audit log, and production-tag guardrails. The `DriftReport` machinery from 3.10 grows the re-bind UI. The trust-gate dialog pattern from 3.8 returns for confirming writes against production-tagged connections.

The shape stays: one prompt = one commit; verify each; the prompts get terser as the agent accumulates context.

