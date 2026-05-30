# Perspectives — Architecture

A stable reference for new contributors: what Perspectives is, the three-layer architecture, the core abstractions, the repository layout, and the cross-cutting concerns we hold to in every phase.

For the time-ordered build plan and product decisions still in motion, see [`plan.md`](./plan.md). For the DSL specifically, see [`dsl.md`](./dsl.md). For vocabulary, see [`glossary.md`](./glossary.md).

---

## 1. Positioning

**One-line positioning:** Perspectives is an open-source database client that turns rigid table-browsing into reusable, shareable, AI-steerable *perspectives*.

**Tagline candidates** (pick one before launch):

- "The database client that talks back."
- "TablePlus-ergonomic, phpMyAdmin-open, voice-native."
- "Your database, in perspective."

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

## 3. Three-layer architecture

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

## 4. Core abstractions

These types are the spine of the codebase. The schemas live in [`packages/dsl`](../packages/dsl/) and the interfaces in [`packages/engine`](../packages/engine/); this section is the prose version.

### 4.1 The Perspective DSL

The canonical, JSON-serializable definition of a perspective. This is what gets saved, synced, shared, and what AI generates. See [`docs/dsl.md`](./dsl.md) for the field-by-field walkthrough.

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

## 5. Repository layout

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

Every package has a `README.md` explaining what it is in two sentences. The seams in the architecture diagram map 1:1 to the package boundaries — that is by design.

---

## 6. Cross-cutting concerns

These never get a phase of their own; they belong in every phase.

- **Internationalization.** Externalize strings from day one even if there's only one language. Retrofitting is painful.
- **Accessibility.** Keyboard nav, focus management, screen-reader labels on actionable cells. The grid is the hardest part.
- **Error UX.** Database errors are scary and unhelpful by default. Translate `pg` error codes into messages with suggested actions.
- **Telemetry boundary.** OSS users should be able to disable all phone-home. Document it. Default to disabled in self-hosted; explicit opt-in in SaaS.
- **Schema drift.** A perspective references columns and tables by name. When the user renames or drops a column, the perspective needs to fail gracefully (mark the perspective as broken; offer to re-bind). Build this in around Phase 3 and maintain it.
- **Tests as documentation.** Every DSL feature gets a sample perspective JSON in `packages/dsl/examples/`. Every adapter behavior gets a fixture.

---

## Next reads

- [`docs/plan.md`](./plan.md) — the working build plan, phased.
- [`docs/dsl.md`](./dsl.md) — the DSL, field by field, with a sample.
- [`docs/glossary.md`](./glossary.md) — vocabulary in one place.
- [`packages/dsl/`](../packages/dsl/), [`packages/engine/`](../packages/engine/) — the abstractions in code.
