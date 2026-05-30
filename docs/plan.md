# Perspectives — Product & Build Plan

A modern, AI- and voice-steerable database client. Open source where TablePlus is closed, ergonomic where phpMyAdmin is clunky, collaborative where both are solo.

---

## 1. Positioning

**Tagline candidates** (pick one later):

- "The database client that talks back."
- "TablePlus-ergonomic, phpMyAdmin-open, voice-native."
- "Your database, in perspective."

**One-line positioning:** Perspectives is an open-source database client that turns rigid table-browsing into reusable, shareable, AI-steerable perspectives.

**Who it's for, by phase:**

- v1 audience: developers, data engineers, technical PMs — people who today use TablePlus, DataGrip, DBeaver, phpMyAdmin, or psql.
- v2 audience: non-technical operators who consume a curated set of perspectives built by their team, controlled via voice and natural language.

---

## 2. Product decisions already locked in

| Decision | Choice |
|---|---|
| Name | **Perspectives**. Saved presentations are called *perspectives* (never "views" — that word is reserved for SQL views). |
| License / distribution | Open source + freemium SaaS on top. |
| Free tier | Single-user, fully local. No sync, no sharing. |
| Paid tier | Sync across devices, sharing, collaboration, permissions. |
| Distribution modes | (1) Electron desktop app, (2) self-hostable server (Docker image), (3) managed SaaS. All three run the same engine. |
| v1 database | PostgreSQL only. Adapter pattern from day one so other engines plug in later. |
| Aggregated columns | Out of scope for v1. |
| Form views | Phase 4+. AI/voice-generated form views are a phase 7 goal. |
| Raw SQL perspectives | In scope from v1. |
| Structured joins | In scope from Phase 3. Joins reference `RelationDef`s by id, restricted to non-row-multiplying cardinalities (n:1 and 1:1) in v1. Row-multiplying joins (1:n, m:n) require aggregation, which is deferred. |
| Internal DSL | Yes — the canonical representation of a perspective is a typed JSON document. Voice/AI translates to this. |
| Competitive frame | "Tools like TablePlus and phpMyAdmin — but open, friendly, and steerable by AI and voice." |

---

## 3. Architecture

Three layers, with clean seams between them. The seams are what make local mode, self-hosted mode, and SaaS mode the same product.

```
                ┌──────────────────────────────────────────────┐
                │                   UI                         │
                │   (React app — no DB credentials, ever)      │
                └───────────────────┬──────────────────────────┘
                                    │  typed RPC (tRPC)
                ┌───────────────────▼──────────────────────────┐
                │                ENGINE                        │
                │  - DB adapter (Postgres in v1)               │
                │  - Perspective query planner                 │
                │  - Permission enforcement (shared mode)      │
                │  - Audit logger                              │
                └───────┬───────────────────────┬──────────────┘
                        │                       │
            ┌───────────▼─────────┐   ┌─────────▼────────────┐
            │  Target Database    │   │   Metadata Store     │
            │  (user's Postgres)  │   │   (pluggable)        │
            └─────────────────────┘   └──────────────────────┘
                                       SQLite (Electron)
                                       Postgres (server)
                                       Remote API (linked)
```

**Why these seams matter:**

- **UI ↔ Engine is RPC.** The UI never holds database credentials. In Electron the engine runs in the main process; in server mode the engine runs on a server. Same UI code either way.
- **Engine ↔ Metadata Store is an interface.** Single-user mode points at local SQLite. Linked mode (paid) points at a remote sync service. Self-hosters point at their own Postgres metadata DB. Switching modes is a config change.
- **Engine ↔ Target DB is an interface.** Postgres adapter is the only one in v1, but a `DatabaseAdapter` interface is defined from the start so MySQL etc. are real options later.

**No always-on server required for sync.** The paid sync layer can be a *lean metadata service* — just an authenticated key-value-ish store for perspectives, relations, and settings. It does not need to broker queries to the user's database. The user's engine still talks directly to their database. This keeps the SaaS cheap to run and makes self-hosting trivial.

**Permission enforcement only switches on in shared mode.** In single-user mode the engine treats the user as omnipotent — no policy evaluation, no overhead. The same code path branches on whether the connection is associated with a workspace.

---

## 4. Core abstractions to define in Phase 0

These types are the spine of the codebase. Lock them in early; refactor as needed but commit to the shapes.

### 4.1 The Perspective DSL

The canonical, JSON-serializable definition of a perspective. This is what gets saved, synced, shared, and what AI generates.

```ts
type PerspectiveDef = {
  id: string;                            // ULID
  name: string;
  description?: string;
  base:
    | { kind: "table"; schema: string; table: string }
    | { kind: "sql";   query: string;  parameters?: ParamDef[] };
  columns: ColumnDef[];                  // selected, in display order
  sort: SortDef[];
  filters: FilterGroup;                  // baked-in filters (always applied)
  filterBar: FilterBarConfig;            // which filter fields the user sees
  defaultPageSize?: number;
  rowActions?: RowActionDef[];           // e.g. "duplicate", "archive"
  formView?: FormViewDef;                // phase 4+
  permissions?: PermissionDef;           // shared mode only
  createdBy: string;                     // user id
  updatedAt: string;                     // ISO
  version: number;                       // for migrations
};

type PerspectiveBaseTable = {
  kind: "table";
  schema: string;
  table: string;
  joins?: JoinDef[];                         // structured joins via RelationDefs
};

type JoinDef = {
  alias: string;                             // local alias for this joined table
  via: string;                               // RelationDef id (ULID)
  direction?: "forward" | "reverse";         // required for self-referential rels
  fromAlias?: string;                        // chain joins; default = base table
  type: "inner" | "left";                    // defaults to "left"
  filter?: FilterGroup;                      // optional filter on the joined side
};
// Engine rule: effective cardinality from the source side MUST be 1:1 or n:1.
// Joining to the "many" side of a 1:n relation, or any m:n relation, is rejected.

type ColumnDef = {
  source:
    | { column: string }                     // base table
    | { joinAlias: string; column: string }  // joined table, by alias
    | { computed: string };                  // SQL expression (can reference any alias)
  alias?: string;
  readonly?: boolean;
  format?: ColumnFormat;
  width?: number;
};

type FilterGroup = {
  op: "and" | "or";
  children: (FilterLeaf | FilterGroup)[];
};

type FilterLeaf = {
  joinAlias?: string;                        // omit for base, set for joined column
  column: string;
  op: "eq"|"neq"|"in"|"nin"|"lt"|"gt"|"lte"|"gte"
    |"ilike"|"is_null"|"is_not_null"|"between";
  value:
    | LiteralValue
    | { kind: "param"; name: string }         // bound to filterBar input
    | { kind: "currentUser" }                 // shared mode only
    | { kind: "today"; offset?: number }      // dynamic dates
    | { kind: "interval"; expression: string };
};

type RelationDef = {
  id: string;
  from: { schema: string; table: string; columns: string[] };
  to:   { schema: string; table: string; columns: string[] };
  cardinality: "one-to-one" | "one-to-many" | "many-to-many";
  junction?: { schema: string; table: string; fromCols: string[]; toCols: string[] };
  source: "schema" | "custom";               // FK-derived or user-defined
  displayDirection: "forward" | "reverse" | "both";
  label?: { forward?: string; reverse?: string };
};

type PermissionDef = {
  // What logged-in users can do *through this perspective*.
  read:   "allow" | "rule";
  insert: "allow" | "deny" | "rule";
  update: "allow" | "deny" | "rule" | "columns";
  delete: "allow" | "deny" | "rule";
  rowFilter?: FilterGroup;                   // ANDed with perspective filters
  columnRules?: Record<string, { read: boolean; write: boolean }>;
};

type DisplayConfig = {                       // per-table, in metadata
  schema: string;
  table: string;
  displayColumn: string;                     // for FK pickers, breadcrumbs
  secondaryColumn?: string;
  rowLabelTemplate?: string;                 // "{first_name} {last_name}"
};
```

### 4.2 The DatabaseAdapter interface

Everything the engine needs from a target database. The Postgres adapter implements this in v1. MySQL, MSSQL, etc. become projects of "implement this interface".

```ts
interface DatabaseAdapter {
  introspect(): Promise<SchemaSnapshot>;     // schemas, tables, columns, FKs, indexes
  runQuery(plan: QueryPlan): Promise<ResultSet>;
  runMutation(plan: MutationPlan): Promise<MutationResult>;
  countRows(plan: QueryPlan): Promise<number>;
  estimateCount(plan: QueryPlan): Promise<number>;   // pg_class.reltuples in PG
  paginateKeyset(plan: QueryPlan, cursor?: Cursor): Promise<PageResult>;
  testConnection(): Promise<ConnectionInfo>;
  dialect: DialectMetadata;                  // operators, quoting rules, etc.
}
```

`QueryPlan` is a structured query — never raw SQL strings passed from the UI. The adapter compiles the plan into dialect-specific SQL. This is what makes second-database support feasible.

### 4.3 The MetadataStore interface

Persistence for perspectives, relations, display configs, settings, audit logs.

```ts
interface MetadataStore {
  perspectives: CRUDStore<PerspectiveDef>;
  relations:    CRUDStore<RelationDef>;
  displayConfig: CRUDStore<DisplayConfig>;
  connections: CRUDStore<ConnectionProfile>;
  auditLog:    AppendStore<AuditEvent>;
  settings:    KVStore;
  // Sync-mode-only:
  workspaces?: CRUDStore<Workspace>;
  members?:    CRUDStore<Membership>;
  shares?:     CRUDStore<Share>;
}
```

Implementations: `SqliteMetadataStore`, `PostgresMetadataStore`, `RemoteMetadataStore`. The engine doesn't know or care which one it's wired to.

---

## 5. Suggested tech stack

Recommendations are explicit so AI-assisted coding has clear targets. Swap based on taste, but pick *something* before Phase 0.

| Layer | Recommendation | Why |
|---|---|---|
| Language | TypeScript everywhere | Single language across UI, engine, server; huge AI training surface. |
| Frontend framework | React + Vite | Most AI-codable UI surface. |
| UI components | shadcn/ui + Tailwind | Composable, customizable, very AI-friendly. |
| Grid | TanStack Table + TanStack Virtual | Headless, fast, virtualized rows. |
| RPC | tRPC | Typed end-to-end. Works in Electron and over HTTP. |
| Desktop shell | Electron | More AI tooling support than Tauri today. Revisit later. |
| Engine runtime | Node 20+ | Mature `pg` driver, native SSH tunneling via `ssh2`. |
| Postgres driver | `pg` (node-postgres) | Standard. |
| Local metadata | SQLite via `better-sqlite3` | Sync API, fast, bundles cleanly with Electron. |
| Server metadata | Postgres | Same shapes via Drizzle or Kysely. |
| ORM / query builder | Kysely | Typed SQL builder; works against both SQLite and Postgres without ORM bloat. |
| Auth (server) | Better Auth or Lucia | Self-hostable, no vendor lock-in. |
| Voice (later) | Web Speech API + Whisper (server fallback) | Free local for short utterances; high-quality fallback. |
| AI (later) | Anthropic API | DSL is the target; structured outputs work well. |
| Packaging | electron-builder | Cross-platform installers. |
| Monorepo | pnpm workspaces + Turborepo | Clean separation of `engine`, `ui`, `desktop`, `server`. |

---

## 6. Repository layout (proposed)

```
perspectives/
├── apps/
│   ├── desktop/          # Electron shell, bundles engine + ui
│   └── server/           # Self-hostable server (engine + sync API)
├── packages/
│   ├── engine/           # Core engine: adapters, planner, permissions, audit
│   ├── ui/               # React app (build target for desktop & server)
│   ├── dsl/              # Perspective DSL types + zod schemas + validators
│   ├── adapter-postgres/ # Postgres DatabaseAdapter
│   ├── metadata-sqlite/  # SqliteMetadataStore
│   ├── metadata-postgres/# PostgresMetadataStore
│   ├── metadata-remote/  # RemoteMetadataStore (HTTP client)
│   └── shared/           # Cross-package utilities, error types
├── docs/
└── tools/
```

---

## 7. Phased build plan

Each phase below is sized for solo, AI-assisted work and ships something usable. Skip nothing in a phase without thinking about it first — most items earn their place.

---

### Phase 0 — Foundation (≈ 1–2 weeks)

**Goal:** Have a runnable, empty shell. No user-visible features. Locked-in abstractions.

**Deliverables:**

- Monorepo with the structure above scaffolded.
- TypeScript, ESLint, Prettier, Vitest configured.
- `packages/dsl` written: the types from §4.1, plus Zod schemas, plus a `validatePerspective()` function with a complete test suite.
- `DatabaseAdapter` and `MetadataStore` interfaces defined as types in `packages/engine`.
- Electron app that opens a window showing "Hello, Perspectives" — proving the desktop shell builds and runs the React UI.
- tRPC wired between UI and main process with one no-op procedure.
- CI: type-check, lint, test on every PR.
- `docs/architecture.md` written from this document.

**Definition of done:** `pnpm dev` launches the desktop app. The DSL types compile and validate sample perspectives. There are zero features.

**Common pitfalls to dodge:**

- Don't pull in a state management library yet — start with React state + tRPC queries.
- Don't decide on a styling token system this week. Use shadcn defaults.
- Don't write a single SQL string outside `adapter-postgres`. Ever.

---

### Phase 1 — Read-only DB browser (≈ 3–4 weeks)

**Goal:** Reach the TablePlus floor: connect to Postgres, browse the schema, open tables, see paginated rows, see column metadata. Read-only, local-only.

**Deliverables:**

- Connection manager UI: add/edit/delete connection profiles. Stored in local SQLite metadata.
- Connection profile supports: host, port, database, user, password, SSL mode, application name.
- Postgres adapter: `introspect()` returns full schema snapshot (schemas, tables, columns with types/nullability/defaults, primary keys, foreign keys including compound, indexes, comments).
- Schema sidebar: tree of databases → schemas → tables/views/functions.
- Table view: virtualized grid with column headers (with type), keyset pagination, "Refresh" button.
- Row count strategy: show estimated count immediately (`pg_class.reltuples`), offer "exact count" as a separate click.
- Read-only SQL console with syntax highlighting, run shortcut, results in the same grid component.
- Per-cell expansion modal for long text, JSON, arrays.
- Search across schema tree.

**Definition of done:** A user can open a fresh install, connect to their own Postgres, browse to any table, and scroll through millions of rows without lag. They can run a SQL query and see results. Nothing is editable.

**Notes:**

- This phase is mostly UI polish. Spend time on the grid. The grid is the product. Everything else hangs off it.
- Decide your keyset pagination shape now: typically `(orderColumn, primaryKey)` tuples. Document it.

---

### Phase 2 — Smart navigation (≈ 2–3 weeks)

**Goal:** The first thing that makes Perspectives *better* than TablePlus, not just equivalent.

**Deliverables:**

- **Forward FK navigation.** Click any FK cell → open the referenced row in a new tab. Works for compound FKs.
- **Reverse FK navigation.** On any row, show a "Referenced by" panel listing every table that has an FK pointing here, with cardinality badges showing how many rows. One click opens that table filtered to those rows. Compound FKs handled.
- **Many-to-many auto-detection.** A junction table is detected when: table has exactly two outbound FKs forming its full primary key (or unique constraint), and no other meaningful columns. Surfaced as a single jump on the source side ("→ Orders" rather than "→ OrderItems → Orders").
- **Cardinality preview.** Hover or persistent badge: "47 orders", "12 items". For large tables, show an estimated count with `~`. Cached per row for the session.
- **Custom relations.** UI to define a relation between two tables when no FK exists. Stored as `RelationDef` with `source: "custom"`. Treated identically to schema-derived relations in navigation. Persisted in metadata, so survives reconnects.
- **Display config.** Per-table setting for "display column" (e.g. `users.full_name`) and an optional row-label template. Used for FK navigation labels and breadcrumbs.
- **Breadcrumb navigation.** When you've jumped through three relations, the breadcrumb shows the path and lets you step back.

**Definition of done:** A user opens a customer row, sees badges for orders/addresses/notes, clicks "47 orders", and is inside the orders table filtered to that customer. From there they jump into order items, and from there to a single product, and the breadcrumb shows the full path back. They define a custom relation between two tables with no FK, and it behaves identically.

**Notes:**

- This is the demo. This is what you'll show people. Polish it.
- Many-to-many detection should be conservative — false positives are worse than false negatives. A toggle to manually mark a table as a junction is fine.

---

### Phase 3 — Perspectives v1 (≈ 3–4 weeks)

**Goal:** The feature the product is named after. Saveable, reusable presentations of data.

**Deliverables:**

- "Save as perspective" from any open table or SQL result.
- Perspective editor: column selection + reordering (drag), sorting, filter builder, filter bar configuration (which filters are visible by default, which are collapsed, which are hidden).
- Filter operators per type: text (`eq`, `ilike`, `is_null`, etc.), numeric (`<`, `>`, `between`), date (with dynamic values like "today − 7 days"), boolean, enum, array containment.
- Filter bar with bound parameters: the user defines a filter as `created_at > {since}`, and `{since}` becomes an input in the filter bar.
- Perspective tabs in the sidebar grouped by connection.
- SQL perspectives: save a raw SQL query as a perspective, with `$1, $2, ...` parameters surfaced in the filter bar.
- **Structured joins.** A perspective with a table base can declare one or more `joins` that reference `RelationDef`s by id. Columns, filters, sort fields, and filter-bar fields can reference joined tables by alias. Multi-hop join chains supported via `fromAlias`. Cardinality enforcement (engine, not schema): the effective cardinality from each source must be 1:1 or n:1 — joining to the "many" side of a 1:n relation or any m:n relation is rejected with a clear error. Row-multiplying joins remain out of scope until aggregations land.
- Perspective export/import as JSON files (useful long before sync exists).
- Computed columns (SQL expression as a column).
- Per-column formatting: default, JSON pretty-print, code, currency, datetime with timezone, boolean as icon.
- Default-page-size and default-sort persisted per perspective.

**Definition of done:** A user opens a frequently-used table, customizes it once, saves it as a perspective, and from then on opens it with one click in the desired state. Filter bar pre-populated, irrelevant columns hidden, custom sort applied. They write a complex SQL query, parameterize it, save it as a perspective, and use it like any other. They build a perspective that joins customers to their company, displaying the company name as a read-only column, and the engine refuses with a clear error if they accidentally try to join to the "many" side of a 1:n relation.

**Notes:**

- The perspective editor will accrete features for months. Keep the data model strict — it'll save you later.
- Validate that every saved perspective survives a round trip through `validatePerspective()` before persisting. This catches drift early.

---

### Phase 4 — Editing, audit, safety (≈ 2–3 weeks)

**Goal:** Make Perspectives usable as a daily driver, including on real, production-adjacent data. Even single-user, an undo log saves careers.

**Edit semantics for joined perspectives (rule):** When a perspective has joins, the *base* table is the editable one. Joined columns are read-only — they're displayed, filterable, and sortable, but not editable through this perspective. To edit a row of a joined table, open a perspective whose base *is* that table. This rule keeps the mental model simple, makes optimistic locking unambiguous, and avoids the multi-table write traps that bite tools like django-admin and Forest.

**Deliverables:**

- **Inline editing** in the grid. Per-cell edit with type-aware input. Cancel/commit per row.
- **Insert row** as a dedicated dialog or an "add row" trail at the bottom of the grid.
- **Delete row** with confirmation showing the row's display label.
- **Bulk edit / bulk delete** with confirmation showing affected count.
- **Inline FK pickers.** When editing a foreign key column, present a searchable dropdown showing the referenced table's display column. No raw IDs unless the user toggles to ID mode.
- **Form view per row.** Side panel or modal that lays the row out as a form with sections, instead of a horizontal scroll through 50 cells. Auto-generated from schema; later versions of the perspective can override layout.
- **Optimistic locking.** Track the row's last-known state when editing; on save, refuse if the row changed underneath and offer to view the diff.
- **Local audit log.** Every write to the target DB is recorded in metadata storage with: timestamp, perspective id, table, primary key, action, before/after values, user. Browsable. Searchable.
- **Connection environment tag.** Each connection has a `production | staging | development | other` tag, with a prominent color band and a confirmation step on write operations in `production`.
- **Export.** CSV and JSON export from any grid (table view, perspective, SQL result). Streamed for large exports.
- **SSH tunneling** for connections. Bastion host, key file, password.
- **SSL options.** Verify-full, verify-ca, require, prefer, disable. CA certificate upload.

**Definition of done:** A user can perform full CRUD against their database through a perspective, including via the form view; bulk-edit with confidence; recover from a mistake using the audit log; and connect to a production DB through an SSH tunnel with appropriate warning.

---

### Phase 5 — Sync backend and account model (≈ 3–4 weeks)

**Goal:** Make the paid SaaS possible by extracting the metadata store interface into a remote implementation. The local app keeps working unchanged.

**Deliverables:**

- `apps/server`: a self-hostable Node server exposing the `MetadataStore` interface over HTTP, with authentication.
- `PostgresMetadataStore` implementation for the server.
- Authentication: email + password and OAuth (GitHub, Google). Sessions via Better Auth or Lucia. Magic links optional.
- Workspace concept: a user has zero or more workspaces; a workspace owns perspectives, relations, display configs, members.
- `RemoteMetadataStore` in the desktop app: HTTP client that implements `MetadataStore` against the server.
- "Link workspace" flow: user signs in from the desktop app, picks/creates a workspace, and from then on perspectives etc. are persisted to the workspace (with local caching for offline use).
- Conflict policy on sync: last-write-wins on whole-document updates, with a server-side append-only history kept for the audit trail.
- Connection profiles stay local-only and are never synced (credentials must not leave the user's machine).
- Per-workspace settings: workspace name, default environment, branding (later).
- Migration path: "promote local perspective to workspace" as an explicit user action.

**Definition of done:** A user installs the app on two machines, signs into the same workspace on both, edits a perspective on one, and sees the change on the other after a refresh. Self-hosters can run `docker compose up` and get the same backend.

**Notes:**

- Spend time on the credentials boundary. State explicitly in code, comments, and docs: *connection credentials are local-only.* Have a test that fails if a `ConnectionProfile` ever appears in a remote-bound payload.
- Decide your sync model: pull-on-open is simplest; long-poll or SSE for live updates is a Phase 6+ nice-to-have.

---

### Phase 6 — Sharing, permissions, collaboration (≈ 3–4 weeks)

**Goal:** Turn workspaces into actual collaboration spaces with the permission model from your spec.

**Deliverables:**

- **Membership and roles.** Each workspace has members with a base role: `owner`, `admin`, `editor`, `viewer`. Roles affect what's editable in the workspace itself (perspectives, relations), not raw DB access.
- **Connection scoping.** A connection profile can be marked as workspace-shared. Shared connections live on the server with credentials encrypted at rest; non-owners use them only through the engine, never directly. (This is the bridge that lets an admin let collaborators see data without giving them DB credentials.)
- **Perspective permissions.** The `PermissionDef` from §4.1 becomes real. Owners set per-perspective: who can view, who can edit data through it, which columns are read-only, what row filter is applied.
- **Row-level permissions.** A perspective's `rowFilter` can use `{ kind: "currentUser" }` to constrain to rows owned by the requesting user — e.g. `assignee_id = currentUser`.
- **Column-level permissions.** Within an editable perspective, individual columns can be marked read-only or fully hidden per role.
- **Server-side enforcement.** The engine, when running with a workspace context, runs every query through a permission compiler that injects row filters and rejects forbidden operations. The UI's permission state is for UX hints only — the server is the source of truth.
- **Audit log surfaced.** Workspace admins can view the audit log filtered by user, table, time window, action.
- **Row comments / annotations.** Threaded comments attached to `(table, primary key)` pairs. Visible across perspectives that touch that row. Mentions notify members (basic in-app notification list; email optional).
- **"Promote to workspace" and "fork perspective"** as first-class actions.

**Definition of done:** A workspace owner connects to a shared Postgres, defines a perspective on the `customers` table with `assignee_id = currentUser` as a row filter, marks the `notes` column writable and everything else read-only, and invites a colleague as a viewer. The colleague signs in, opens the perspective, sees only their assigned customers, can edit `notes` on those rows, and cannot edit anything else or see raw tables.

**Notes:**

- Write a permission-evaluation test suite *first*. This module is where a security bug would cost the most. Tests should cover: row filter ANDing, column-level overrides, operation denials, and unauthorized-relation traversal (a user shouldn't be able to use a relation to reach a table they don't have a perspective for).
- The permission compiler is a good target for fuzz testing.

---

### Phase 7 — AI and voice (≈ 3–5 weeks)

**Goal:** Make the DSL feel like a target a non-technical user never has to see.

**Deliverables:**

- **Natural-language perspective generation.** "Show me customers from Germany who placed an order in the last 7 days, with their order count" → an LLM emits a candidate `PerspectiveDef` JSON validated against the Zod schema. User reviews, accepts, edits visually, saves. For requests that need data from related tables, the LLM emits structured joins (referencing existing `RelationDef`s) rather than raw SQL — far higher success rate, far easier to refine visually after.
- **Natural-language filtering on existing perspectives.** "Just the ones with overdue invoices" → modify the active `FilterGroup` of the current perspective.
- **Voice input.** Push-to-talk in the UI; uses Web Speech API where available, falls back to Whisper via the server. Transcription routed through the same NL → DSL pipeline.
- **AI-assisted SQL.** "Write me a query that…" → SQL surfaced in the editor with explanation. The user reviews before running.
- **Schema-aware suggestions.** The LLM is grounded with the schema snapshot of the active connection so it picks real columns and respects types.
- **Form view auto-layout.** "Generate a form view for this perspective grouping personal info, address, and order history" → a generated `FormViewDef`.
- **Safety rails.** Generated mutations require explicit confirmation. Generated SQL never auto-runs against `production`-tagged connections.

**Definition of done:** A non-technical workspace member opens a workspace, says "show me customers who haven't logged in in 30 days", and gets a working perspective they can refine by voice. A developer asks for a complex SQL query and gets one that runs, with the original prompt saved alongside as documentation.

**Notes:**

- Prompt engineering for DSL generation: give the LLM the schema, the DSL Zod definition, two or three exemplars, and instructions to output JSON only. Validate against Zod and re-prompt with the error on failure.
- Cache schema snapshots aggressively. Re-introspecting on every prompt is slow and expensive.

---

### Phase 8 — Second database engine + performance pass (≈ 3–4 weeks)

**Goal:** Prove the adapter pattern by adding one more engine, and address whatever has gotten slow in real use.

**Deliverables:**

- MySQL/MariaDB adapter implementing `DatabaseAdapter`.
- Adapter test suite that any adapter must pass (introspection round-trips, basic query plans, keyset pagination, error mapping).
- Performance pass on the grid: virtual scrolling sanity check, query batching, FK preview caching, audit log query indexes.
- Telemetry (opt-in only, off by default in OSS): error rates, slow-query logs.

**Definition of done:** A user with both Postgres and MySQL connects to each, and the experience is indistinguishable except where dialects genuinely differ. Performance on a 100M-row table is acceptable.

---

### Phase 9 — SaaS launch (variable)

**Goal:** Run the freemium SaaS.

**Deliverables:**

- Multi-tenant deployment of the server with workspace isolation.
- Billing integration (Stripe). Free vs paid feature gating in the server.
- Marketing site with docs, examples, screencasts.
- Onboarding flow for new accounts.
- Support and feedback channels.
- Status page, uptime monitoring.

This phase is mostly business and ops, not engineering. Budget accordingly.

---

## 8. Cross-cutting concerns to keep in mind every phase

These never get a phase of their own; they belong in every phase.

- **Internationalization.** Externalize strings from day one even if there's only one language. Retrofitting is painful.
- **Accessibility.** Keyboard nav, focus management, screen-reader labels on actionable cells. The grid is the hardest part.
- **Error UX.** Database errors are scary and unhelpful by default. Translate `pg` error codes into messages with suggested actions.
- **Telemetry boundary.** OSS users should be able to disable all phone-home. Document it. Default to disabled in self-hosted; explicit opt-in in SaaS.
- **Schema drift.** A perspective references columns and tables by name. When the user renames or drops a column, the perspective needs to fail gracefully (mark the perspective as broken; offer to re-bind). Build this in around Phase 3 and maintain it.
- **Tests as documentation.** Every DSL feature gets a sample perspective JSON in `packages/dsl/examples/`. Every adapter behavior gets a fixture.

---

## 9. Decisions still to make (don't ship without picking)

- **Pricing.** Per-seat, per-workspace, or per-active-connection? Decide before Phase 5 so the data model matches.
- **Workspace vs. project.** Single tier of grouping (workspace) or two tiers (workspace → project)? Single is simpler; teams will eventually want the second.
- **Custom roles.** Phase 6 ships with fixed roles. Do you want custom roles in v1? Recommendation: no. Add when a paying customer asks.
- **Database connection limits.** Per workspace? Per user? Free tier caps?
- **Branding / white-labeling for self-hosters.** Out of scope, or product hook?
- **Mobile.** Almost certainly skip. State publicly that Perspectives is a desktop tool.

---

## 10. What good progress looks like

After each phase, you should be able to record a 60-second screencast that makes a viewer say "I'd use that." If you can't, the phase isn't done — even if the checklist is.

- After Phase 1: "Smooth Postgres browser."
- After Phase 2: "Wait, I can jump *backwards* through a relation? And define my own?"
- After Phase 3: "I never have to set up that view again."
- After Phase 4: "I'd trust this on prod."
- After Phase 5: "I can use it from anywhere."
- After Phase 6: "I can let my whole team into the database without giving them the database."
- After Phase 7: "It listened to me."

That's the product.

---

## Appendix A — A first sample perspective (use this to sanity-check the DSL)

```json
{
  "id": "01J9X2KZQ5N7P3VCM8B4ETRGYH",
  "name": "Active EU customers — last 30d",
  "description": "Customers in EU countries who placed at least one order in the last 30 days.",
  "base": { "kind": "table", "schema": "public", "table": "customers" },
  "columns": [
    { "source": { "column": "id" }, "readonly": true, "width": 80 },
    { "source": { "column": "full_name" } },
    { "source": { "column": "email" } },
    { "source": { "column": "country_code" }, "alias": "country" },
    { "source": { "computed": "EXTRACT(DAY FROM now() - last_login_at)::int" }, "alias": "days_since_login" }
  ],
  "sort": [{ "column": "days_since_login", "direction": "asc" }],
  "filters": {
    "op": "and",
    "children": [
      { "column": "country_code", "op": "in", "value": ["DE","FR","NL","IT","ES","PL"] },
      { "column": "last_order_at", "op": "gte", "value": { "kind": "today", "offset": -30 } }
    ]
  },
  "filterBar": {
    "visible": [
      { "column": "country_code", "label": "Country" },
      { "column": "email", "label": "Email contains", "defaultOp": "ilike" }
    ]
  },
  "defaultPageSize": 100,
  "createdBy": "user_01J9X...",
  "updatedAt": "2026-05-27T09:00:00Z",
  "version": 1
}
```

If you can write a perspective like this by hand and the engine renders it correctly, the DSL is doing its job — and AI can target the same shape.

---

## Appendix B — A joined perspective

A more realistic shape: order items showing product name and customer email, two hops away.

```json
{
  "id": "01J9X2KZQ5N7P3VCM8B4ETRGYK",
  "name": "Order items — recent, with product and customer",
  "base": {
    "kind": "table",
    "schema": "public",
    "table": "order_items",
    "joins": [
      { "alias": "order",    "via": "01JBC1M0ZK0M0M0M0M0M0M0M0M", "type": "inner" },
      { "alias": "product",  "via": "01JBC2M0ZK0M0M0M0M0M0M0M0M", "type": "left" },
      { "alias": "customer", "via": "01JBC3M0ZK0M0M0M0M0M0M0M0M",
        "fromAlias": "order", "type": "left" }
    ]
  },
  "columns": [
    { "source": { "column": "id" }, "readonly": true, "width": 80 },
    { "source": { "column": "quantity" } },
    { "source": { "column": "unit_price" }, "format": "currency" },
    { "source": { "joinAlias": "product",  "column": "name"  }, "alias": "product_name"  },
    { "source": { "joinAlias": "customer", "column": "email" }, "alias": "customer_email" },
    { "source": { "joinAlias": "order",    "column": "placed_at" }, "format": "datetime" }
  ],
  "sort": [
    { "joinAlias": "order", "column": "placed_at", "direction": "desc" }
  ],
  "filters": {
    "op": "and",
    "children": [
      { "joinAlias": "order", "column": "status", "op": "neq", "value": "cancelled" },
      { "joinAlias": "order", "column": "placed_at", "op": "gte",
        "value": { "kind": "today", "offset": -90 } }
    ]
  },
  "filterBar": {
    "visible": [
      { "joinAlias": "customer", "column": "email", "label": "Customer email", "defaultOp": "ilike" },
      { "joinAlias": "product",  "column": "category", "label": "Category" }
    ],
    "collapsed": []
  },
  "createdBy": "user_01J9X...",
  "updatedAt": "2026-05-27T09:00:00Z",
  "version": 1
}
```

Read the joins as: start at `order_items`; pull in `order` via the order_items→order relation (inner); pull in `product` via the order_items→product relation (left); from the `order` alias, pull in `customer` via the order→customer relation (left). All three joins are non-row-multiplying (n:1 or 1:1 from the source side), so the result is one row per order item. Edits go to `order_items`; everything else is read-only.
