# The Perspectives DSL

The canonical, machine-checkable definition of every saved object in Perspectives — `PerspectiveDef`, `RelationDef`, `DisplayConfig` — expressed as Zod schemas with TypeScript types derived via `z.infer`. Validation helpers (`validatePerspective`, `validateRelation`, `validateDisplayConfig`) wrap `safeParse` and return a discriminated `ValidationResult<T>` that the engine, the UI, and the AI generation pipeline all share.

## What lives where

- [`packages/dsl/src/schemas.ts`](../packages/dsl/src/schemas.ts) — the Zod schemas plus a handful of strict variants (e.g. `ColumnSource` is `.strict()` so unknown keys are rejected loudly rather than silently dropped).
- [`packages/dsl/src/index.ts`](../packages/dsl/src/index.ts) — re-exports everything public.
- [`packages/dsl/examples/`](../packages/dsl/examples/) — example perspective JSON documents. Every file is round-tripped through `validatePerspective()` by the test suite.

This package is **types and validators only**. No query planning, no SQL generation, no permission evaluation — those live in `@perspectives/engine` and the adapter packages. Anything that needs to interpret a `PerspectiveDef` consumes these types; this package never reaches back to them.

## The cardinal rule: schemas are the source of truth

Every persisted shape in Perspectives is defined exactly once, here, as a Zod schema. The TypeScript type is derived from the schema via `z.infer<typeof Schema>` — never written by hand alongside the schema. If you're tempted to maintain a parallel `interface` definition, don't: it will drift, and the runtime check and the compiler check will start disagreeing.

The engine MUST round-trip every persisted object through these schemas before saving and after loading. Fields not in the schema do not exist — they are stripped, not passed through.

---

## A sample perspective

The example below — `examples/active-eu-customers.json` — exercises every top-level field used in a typical single-table perspective. It is the canonical fixture the example test validates on every run.

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
    {
      "source": { "computed": "EXTRACT(DAY FROM now() - last_login_at)::int" },
      "alias": "days_since_login"
    }
  ],
  "sort": [{ "column": "days_since_login", "direction": "asc" }],
  "filters": {
    "op": "and",
    "children": [
      { "column": "country_code", "op": "in",
        "value": ["DE","FR","NL","IT","ES","PL"] },
      { "column": "last_order_at", "op": "gte",
        "value": { "kind": "today", "offset": -30 } }
    ]
  },
  "filterBar": {
    "visible": [
      { "column": "country_code", "label": "Country" },
      { "column": "email", "label": "Email contains", "defaultOp": "ilike" }
    ],
    "collapsed": []
  },
  "defaultPageSize": 100,
  "createdBy": "user_01J9X...",
  "updatedAt": "2026-05-27T09:00:00Z",
  "version": 1
}
```

### Field walkthrough

- **`id`** — a ULID. Stable across machines; metadata stores key on it; sync uses it to detect the same record on two devices.
- **`name`** — user-facing label shown in the sidebar, breadcrumbs, and share dialogs. Required, non-empty.
- **`description`** — optional prose shown in tooltips and the perspective settings panel. Treat as documentation, not metadata.
- **`base`** — the data source. A discriminated union: `kind: "table"` projects from a single table (with optional `joins`); `kind: "sql"` projects from a raw SQL statement (with positional `parameters`). The engine refuses to mix the two — you can't add structured joins to a SQL-base perspective; the SQL already encodes them.
- **`columns`** — the projection, in display order. Each entry has a `source` (one of three strict shapes: base-column, joined-alias column, or a SQL expression in `computed`) and optional presentation hints (`alias` for the output label, `readonly` to block editing through this perspective, `format` for the cell renderer, `width` for the grid's initial column width). The adapter reads only `source`/`alias`; everything else is for the UI.
- **`sort`** — default sort order. Each entry pairs a column reference (base or `joinAlias`-qualified) with `direction: "asc" | "desc"` and an optional `nulls: "first" | "last"`. The example above sorts ascending by the computed `days_since_login` column referenced by its alias.
- **`filters`** — the **baked-in** filters, applied to every row read through this perspective. A recursive `FilterGroup` with `op: "and" | "or"` and children that are either nested groups or `FilterLeaf` nodes (`column`, `op`, `value`). Distinguish baked-in filters (always applied) from filter-bar filters (user-driven, can be cleared).
- **`filterBar`** — which filters the user sees as inputs above the grid, split into `visible` (always shown) and `collapsed` (behind a "more filters" disclosure). Each entry is a column reference plus a user-facing `label` and a `defaultOp` that determines the operator the input starts in.
- **`defaultPageSize`** — how many rows the grid loads on first open. The keyset paginator paginates by this size regardless. Optional; the UI falls back to a global default if absent.
- **`createdBy`** — user id of the original author. Used for ownership UI and (in shared mode) as the default value for the `{ kind: "currentUser" }` dynamic filter.
- **`updatedAt`** — ISO-8601 timestamp with offset. The sync layer's last-write-wins policy compares this; the audit log records every change keyed off it.
- **`version`** — the schema version (always `1` today). See the migration story below.

### Dynamic filter values

The example uses `{ "kind": "today", "offset": -30 }` — that's a *dynamic value*. Dynamic values are resolved at query time, not save time, so the perspective stays correct as the calendar advances. The DSL supports four kinds:

- `{ kind: "param", name: "<paramName>" }` — bound to a `filterBar` input or a SQL parameter.
- `{ kind: "currentUser" }` — the requesting user's id; shared-mode only. The engine throws if used outside a workspace.
- `{ kind: "today", offset?: number }` — today's date plus an integer day offset.
- `{ kind: "interval", expression: "<dialect-specific>" }` — e.g. `"-7 days"`; the adapter parses against its own interval grammar.

### Optional fields not in this sample

The DSL also surfaces:

- **`base.joins`** — structured joins for table-base perspectives. Each join references a `RelationDef` by ULID; joins chain via `fromAlias`; cardinality is enforced engine-side (no joining to the "many" side of a 1:n). See `examples/joined-order-items.json` once it lands.
- **`base.parameters`** — for SQL-base perspectives, the typed input parameters surfaced in the filter bar.
- **`columns[].format`** — `"default" | "json" | "code" | "currency" | "datetime" | "date" | "time" | "boolean" | "markdown" | "url" | "image"`. Pure presentation; ignored by the adapter.
- **`columns[].hidden`** — column is in the projection but not shown in the grid (still available for filters and sort).
- **`rowActions`** — per-row buttons in the grid's actions column. Each action has a `kind` (`"sql" | "mutation" | "navigate"`) and a free-form `config`.
- **`formView`** — Phase 4+; defines a sectioned form layout for the per-row edit modal.
- **`permissions`** — Phase 6; shared-mode permissions on read/insert/update/delete with optional `rowFilter` and per-column `columnRules`.

---

## Versioning: how to add a new schema version

Every top-level saved object carries a numeric `version` field so the schema can evolve without breaking old payloads. The rules:

- **Backward-compatible additions** (new optional fields; new union variants that don't collide with existing ones) may be made to the current version *in place*. Old payloads still parse; new payloads carry the new field.
- **Breaking changes** — renames, type changes, removed fields, semantically incompatible re-shapings — require a new version. Never silently rewrite v1.

To add a new version of `PerspectiveDef`:

1. Keep the existing `PerspectiveDefV1` schema exactly as it is. Do not edit it.
2. Add a `PerspectiveDefV2` schema next to it, with `version: z.literal(2)`. Define all the new shapes in their own consts so they're easy to diff against v1.
3. Replace the exported `PerspectiveDef` with a discriminated union on `version`:

   ```ts
   export const PerspectiveDef = z.discriminatedUnion("version", [
     PerspectiveDefV1,
     PerspectiveDefV2,
   ]);
   export type PerspectiveDef = z.infer<typeof PerspectiveDef>;
   ```

4. Write a `migrateV1ToV2(input: PerspectiveDefV1): PerspectiveDefV2` function in a new file (`src/migrate.ts`) — pure, total, tested. The metadata stores call it lazily when loading.
5. Add fixtures for both versions under `examples/` so the example test exercises both. The validator accepts either shape going forward.

The same procedure applies to `RelationDef` and `DisplayConfig` when they need to evolve.

---

## Tests

```sh
pnpm --filter dsl test
```

The suite covers every top-level schema, the recursive filter group, the strict column-source variants, the join shape (including the multi-hop chain and the self-referential case), the `RelationDef` cardinality refinements, and a small loader that validates every JSON document in `examples/`.
