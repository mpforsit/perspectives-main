/**
 * Zod schemas for tRPC procedure inputs.
 *
 * The "shared" persisted shapes (`ConnectionProfile`, `AuditEvent`, etc.)
 * are re-exported from `@perspectives/dsl` — that package is the single
 * source of truth, and using its schemas here means the IPC boundary, the
 * SQLite store, and the engine all validate against the same definitions.
 * See AUDIT-CODEX.md finding #9.
 *
 * IPC-only shapes (`runReadOnlySqlInputSchema`, `getTablePageInputSchema`,
 * etc.) stay in this file — they describe RPC arguments, not persisted
 * objects.
 */

import { z } from "zod";

import {
  connectionProfileSchema as canonicalConnectionProfileSchema,
  dialectNameSchema,
  environmentSchema as canonicalEnvironmentSchema,
  schemas as dslSchemas,
  sshTunnelOptionsSchema as canonicalSshTunnelOptionsSchema,
  sslOptionsSchema as canonicalSslOptionsSchema,
} from "@perspectives/dsl";

// DSL-canonical FilterGroup (recursive AND/OR tree of equality / range /
// LIKE / array leaves). Phase 2 navigation passes filters through the
// existing QueryPlan filter path; keeping the schema reference here means
// renderer → IPC → engine all share the same definition.
const filterGroupSchema = dslSchemas.FilterGroup;

// ============================================================================
// Connection profile — re-exported from the canonical DSL schemas. The
// trailing "Schema" suffix is preserved so call sites stay unchanged.
// ============================================================================

export const dialectSchema = dialectNameSchema;
export const environmentSchema = canonicalEnvironmentSchema;
export const sslOptionsSchema = canonicalSslOptionsSchema;
export const sshTunnelOptionsSchema = canonicalSshTunnelOptionsSchema;
export const connectionProfileSchema = canonicalConnectionProfileSchema;

// ============================================================================
// Sort + Cursor (for data.getTablePage)
// ============================================================================

export const sortDefSchema = z.object({
  joinAlias: z.string().min(1).max(64).optional(),
  column: z.string().min(1).max(255),
  direction: z.enum(["asc", "desc"]),
  nulls: z.enum(["first", "last"]).optional(),
});

export const cursorSchema = z.object({
  values: z.array(
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
  direction: z.enum(["forward", "backward"]),
});

// ============================================================================
// Tagged inputs the sub-routers actually receive
// ============================================================================

export const connectionIdSchema = z.object({
  connectionId: z.string().min(1),
});

export const tableRefSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1),
  table: z.string().min(1),
});

/** Single-row lookup by primary key — used by Phase 2 forward FK navigation
 *  to fetch the target row of a click. Compound PKs pass multiple values. */
export const getRowByKeyInputSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1),
  table: z.string().min(1),
  pkValues: z
    .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .min(1)
    .max(16),
});

/** Inspector "Referenced by" counts — one entry per inbound 1:n + per
 *  detected m:n. Returns counts flagged `estimated: true` for tables above
 *  the engine's per-relation threshold.
 *
 *  `rowValues` is a column-name → primitive map from the focused row.
 *  Custom relations can reference any unique column (PK or unique
 *  constraint), so we ship the whole row's primitive entries and let the
 *  engine pick values per relation. Non-primitive values (Date, Buffer,
 *  arrays, nested objects) are pre-filtered out by the renderer — they
 *  wouldn't appear in a relation column anyway. */
export const getReferencingCountsInputSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1),
  table: z.string().min(1),
  rowValues: z.record(
    z.string().min(1).max(255),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
});

/** Per-table junction-policy update. `auto` clears any override; `always`
 *  and `never` persist. Scope is the connection's database identity. */
export const setJunctionPolicyInputSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1),
  table: z.string().min(1),
  policy: z.enum(["auto", "always", "never"]),
});

/**
 * Custom-relation input — the engine fills `id`, `updatedAt`, and
 * `source: "custom"`. Cardinality is `one-to-many` or `one-to-one`; m:n
 * with a custom junction is out of scope for Phase 2.4.
 */
const customRelationSideSchema = z.object({
  schema: z.string().min(1).max(255),
  table: z.string().min(1).max(255),
  columns: z.array(z.string().min(1).max(255)).min(1).max(16),
});

export const customRelationInputSchema = z.object({
  from: customRelationSideSchema,
  to: customRelationSideSchema,
  cardinality: z.enum(["one-to-many", "one-to-one"]),
  label: z
    .object({
      forward: z.string().max(255).optional(),
      reverse: z.string().max(255).optional(),
    })
    .optional(),
  displayDirection: z.enum(["forward", "reverse", "both"]).optional(),
});

export const createCustomRelationInputSchema = z.object({
  connectionId: z.string().min(1),
  relation: customRelationInputSchema,
});

export const updateCustomRelationInputSchema = z.object({
  connectionId: z.string().min(1),
  id: z.string().min(1).max(64),
  relation: customRelationInputSchema,
});

export const deleteCustomRelationInputSchema = z.object({
  connectionId: z.string().min(1),
  id: z.string().min(1).max(64),
});

// ============================================================================
// DisplayConfig (Phase 2.5)
// ============================================================================

/** Wire shape for `DisplayConfig`. The canonical Zod schema lives in
 *  `@perspectives/dsl`; we duplicate the input shape here so tRPC's
 *  output types stay readable (instead of leaking the DSL's recursive
 *  types into the router's generic). */
const displayConfigPayloadSchema = z.object({
  schema: z.string().min(1).max(255),
  table: z.string().min(1).max(255),
  displayColumn: z.string().min(1).max(255).optional(),
  secondaryColumn: z.string().min(1).max(255).optional(),
  rowLabelTemplate: z.string().max(1024).optional(),
  cardinalityRelations: z.array(z.string().min(1).max(64)).max(2).optional(),
  updatedAt: z.string().min(1).max(64),
});

export const getDisplayConfigInputSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1).max(255),
  table: z.string().min(1).max(255),
});

export const upsertDisplayConfigInputSchema = z.object({
  connectionId: z.string().min(1),
  displayConfig: displayConfigPayloadSchema,
});

export const deleteDisplayConfigInputSchema = getDisplayConfigInputSchema;

/** Batch row-label lookup — used by the grid to render FK cell labels and
 *  by the breadcrumb / inspector. */
export const getRowLabelsInputSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1).max(255),
  table: z.string().min(1).max(255),
  /** PK tuples in the table's `TableInfo.primaryKey` column order. Each
   *  inner tuple is at most 16 values; the outer batch caps at 200 so a
   *  single round trip stays under ~20 KB of compiled SQL. */
  pkTuples: z
    .array(
      z
        .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .min(1)
        .max(16),
    )
    .min(1)
    .max(200),
});

/** Batch cardinality preview — for every (visible source row, picked
 *  relation), return the count of "children" the source has under that
 *  relation. The cap of 200 rows × 2 relations keeps a single round trip
 *  under one grouped query per relation. */
export const getCountsForRowsInputSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1).max(255),
  table: z.string().min(1).max(255),
  pkTuples: z
    .array(
      z
        .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .min(1)
        .max(16),
    )
    .min(1)
    .max(200),
  relationIds: z.array(z.string().min(1).max(64)).min(1).max(2),
  /** When true, skip the estimate-vs-exact threshold and always use the
   *  grouped count path. The renderer uses this for the "click to escalate
   *  an estimate" affordance on the badge. */
  forceExact: z.boolean().optional(),
});

export const getTablePageInputSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1),
  table: z.string().min(1),
  sort: z.array(sortDefSchema).default([]),
  cursor: cursorSchema.optional(),
  pageSize: z.number().int().min(1).max(10_000).optional(),
  filters: filterGroupSchema.optional(),
});

/** Like `tableRefSchema` but with an optional filter — used by countTable
 *  and estimateTable when the renderer is viewing a filtered subset. */
export const filteredTableRefSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1),
  table: z.string().min(1),
  filters: filterGroupSchema.optional(),
});

export const runReadOnlySqlInputSchema = z.object({
  connectionId: z.string().min(1),
  // 1 MiB upper bound — well past anything a human would paste into the
  // console; mostly a defence against accidental file-drop.
  sql: z.string().min(1).max(1_048_576),
  /** Per-call override of the engine's SQL-console budget. The engine fills
   *  defaults from `READ_ONLY_SQL_DEFAULTS` so the renderer may omit any
   *  field. See AUDIT-CODEX.md finding #4. */
  limits: z
    .object({
      statementTimeoutMs: z.number().int().positive().max(600_000).optional(),
      idleInTransactionTimeoutMs: z
        .number()
        .int()
        .positive()
        .max(600_000)
        .optional(),
      maxRows: z.number().int().nonnegative().max(1_000_000).optional(),
      maxBytes: z.number().int().nonnegative().max(512 * 1024 * 1024).optional(),
    })
    .optional(),
  /** Opaque token identifying an in-flight cancellation request. The router
   *  registers an AbortController under this id so the renderer can call
   *  `cancelReadOnlySql` and reach the running query through `pg_cancel_backend`. */
  cancelToken: z.string().min(1).max(128).optional(),
});

export const cancelReadOnlySqlInputSchema = z.object({
  cancelToken: z.string().min(1).max(128),
});
