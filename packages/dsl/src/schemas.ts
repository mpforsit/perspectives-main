/**
 * Perspectives DSL — Zod schemas.
 *
 * This file is the canonical, machine-checkable definition of every saved object
 * in Perspectives: PerspectiveDef, RelationDef, DisplayConfig.
 *
 * Rules of the road:
 *   1. The Zod schemas are the source of truth. TypeScript types are derived via z.infer.
 *      Do not maintain parallel type definitions.
 *   2. Every saved object includes a `version` field so we can evolve the schema
 *      with discriminated unions later. Never silently change v1 — add v2.
 *   3. Backward-compatible additions (new optional fields, new union variants
 *      that don't collide with existing ones) can be made to v1 in place.
 *      Anything that breaks an old payload requires a new version.
 *   4. The engine MUST round-trip every persisted object through these schemas
 *      before saving and after loading. If a field is not in the schema, it does
 *      not exist. Strip unknown fields rather than passing them through.
 *   5. AI-generated perspectives are validated against these schemas before being
 *      shown to the user. Re-prompt on validation failure with the Zod error.
 *
 * On joins:
 *   A perspective with `base.kind: "table"` may declare structured joins. Joins
 *   reference RelationDefs by id (a perspective is portable only with its
 *   relations). The schema validates structural correctness; the engine enforces
 *   semantic rules at query-plan time:
 *     - The relation referenced by `via` must exist.
 *     - The effective cardinality from the source side must be 1:1 or n:1 — i.e.
 *       no row multiplication. Joining to the "many" side of a 1:n relation, or
 *       any m:n relation, is rejected. Row-multiplying joins require aggregation
 *       (out of v1 scope).
 *     - For self-referential relations (from.table == to.table), `direction`
 *       must be specified.
 */

import { z } from "zod";

// ============================================================================
// Primitives
// ============================================================================

/** ULID — sortable, URL-safe, collision-resistant 26-char identifier. */
const ULID = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "invalid ULID");

const ISODateTime = z.string().datetime({ offset: true });

/** A SQL identifier (column, table, schema). We don't try to validate SQL syntax —
 *  just guard against empty strings and absurd lengths. The adapter quotes properly. */
const Identifier = z.string().min(1).max(255);
const SchemaName = Identifier;
const TableName = Identifier;
const ColumnName = Identifier;

/** Alias used inside a perspective to refer to a joined table.
 *  Must be unique within the perspective. The engine validates uniqueness. */
const JoinAlias = z.string().min(1).max(64);

// ============================================================================
// Values that can appear in filters
// ============================================================================

/** A literal value the user typed or the system stored. */
const LiteralValue: z.ZodType<
  | string | number | boolean | null
  | Array<string | number | boolean | null>
> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
]);

/** A value that's resolved at query time, not save time. */
const DynamicValue = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("param"), name: z.string().min(1) }),
  z.object({ kind: z.literal("currentUser") }),
  z.object({
    kind: z.literal("today"),
    offset: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal("interval"),
    expression: z.string().min(1),
  }),
]);

const FilterValue = z.union([LiteralValue, DynamicValue]);

// ============================================================================
// Filters (recursive AND/OR tree)
// ============================================================================

const FilterOp = z.enum([
  "eq", "neq",
  "in", "nin",
  "lt", "gt", "lte", "gte",
  "ilike", "like", "not_ilike",
  "is_null", "is_not_null",
  "between",
  "contains", "contained_by", // arrays / jsonb
]);

const FilterLeaf = z.object({
  /** If set, filter applies to a joined table's column rather than the base. */
  joinAlias: JoinAlias.optional(),
  column: ColumnName,
  op: FilterOp,
  /** is_null / is_not_null don't need a value. Engine validates value presence per op. */
  value: FilterValue.optional(),
});

// Exported so downstream packages (e.g. the desktop's tRPC input schemas)
// can reference the inferred Zod type without TS4023 — Zod's `z.lazy()`
// expansion otherwise leaks this name into return types.
export type FilterGroupShape = {
  op: "and" | "or";
  children: Array<z.infer<typeof FilterLeaf> | FilterGroupShape>;
};

const FilterGroup: z.ZodType<FilterGroupShape> = z.lazy(() =>
  z.object({
    op: z.enum(["and", "or"]),
    children: z.array(z.union([FilterLeaf, FilterGroup])),
  })
);

// ============================================================================
// Columns
// ============================================================================

const ColumnFormat = z.enum([
  "default",
  "json",
  "code",
  "currency",
  "datetime",
  "date",
  "time",
  "boolean",
  "markdown",
  "url",
  "image",
]);

/**
 * Three variants. Each is strict — unknown keys are rejected to prevent
 * silent data loss when a user accidentally mixes shapes (e.g. setting both
 * `column` and `computed` would be ambiguous, so we fail loudly).
 */
const ColumnSource = z.union([
  // From the perspective's base table.
  z.object({ column: ColumnName }).strict(),
  // From a joined table, referenced by the join's alias.
  z.object({ joinAlias: JoinAlias, column: ColumnName }).strict(),
  // SQL expression evaluated by the database. Can reference any aliased table
  // (e.g. `customers.id` or `company.name`).
  z.object({ computed: z.string().min(1) }).strict(),
]);

const ColumnDef = z.object({
  source: ColumnSource,
  alias: z.string().optional(),
  readonly: z.boolean().optional(),
  format: ColumnFormat.optional(),
  width: z.number().int().positive().optional(),
  hidden: z.boolean().optional(),
});

// ============================================================================
// Sort
// ============================================================================

const SortDef = z.object({
  joinAlias: JoinAlias.optional(),
  column: ColumnName,
  direction: z.enum(["asc", "desc"]),
  nulls: z.enum(["first", "last"]).optional(),
});

// ============================================================================
// Filter bar
// ============================================================================

const FilterBarField = z.object({
  joinAlias: JoinAlias.optional(),
  column: ColumnName,
  label: z.string().optional(),
  defaultOp: FilterOp.optional(),
  paramName: z.string().optional(),
});

const FilterBarConfig = z.object({
  visible: z.array(FilterBarField),
  collapsed: z.array(FilterBarField),
});

// ============================================================================
// Joins
// ============================================================================

/**
 * A structured join within a perspective. Each join brings one additional table
 * into the result set via a known RelationDef.
 *
 * Constraints (enforced by the engine, not by this schema):
 *   - `via` must reference an existing RelationDef the user has access to.
 *   - The effective cardinality from the source side (base, or `fromAlias`)
 *     must be 1:1 or n:1. Joining to the "many" side of a 1:n relation, or any
 *     m:n relation, is rejected.
 *   - `alias` must be unique within the perspective.
 *   - If chained (`fromAlias` set), `fromAlias` must reference an earlier join.
 *   - `direction` is required when the relation is self-referential
 *     (from.table == to.table); otherwise it's inferred from the source table.
 */
const JoinDef = z.object({
  /** Local alias used to reference this joined table from columns, filters, sort. */
  alias: JoinAlias,
  /** RelationDef id. */
  via: ULID,
  /** Required only for self-referential relations.
   *  "forward" = source is on the relation's `from` side, joining to `to`.
   *  "reverse" = source is on the relation's `to` side, joining to `from`. */
  direction: z.enum(["forward", "reverse"]).optional(),
  /** Source of this join. If omitted, joins from the perspective's base table.
   *  If set, must reference an earlier join's alias — enables join chains
   *  (base → A → B → ...). */
  fromAlias: JoinAlias.optional(),
  /** SQL join type. Default `left`. */
  type: z.enum(["inner", "left"]).default("left"),
  /** Optional filter applied to the joined side at join time (compiled to the
   *  join's ON clause for left joins, or merged into WHERE for inner joins).
   *  Inside this FilterGroup, unqualified column references implicitly refer
   *  to this join's target table. */
  filter: FilterGroup.optional(),
});

// ============================================================================
// Permissions
// ============================================================================

const PermissionMode = z.enum(["allow", "deny", "rule"]);
const UpdatePermissionMode = z.enum(["allow", "deny", "rule", "columns"]);

const ColumnPermission = z.object({
  read: z.boolean(),
  write: z.boolean(),
});

const PermissionDef = z.object({
  read: z.enum(["allow", "rule"]),
  insert: PermissionMode,
  update: UpdatePermissionMode,
  delete: PermissionMode,
  /** ANDed with the perspective's own filters when read/update/delete apply.
   *  Applies to the BASE table only. Joined columns are read-only by default. */
  rowFilter: FilterGroup.optional(),
  /** Keyed by column alias (or base column name if no alias). Joined columns
   *  default to read-only and ignore write rules unless explicitly mapped back
   *  in a future schema version. */
  columnRules: z.record(z.string(), ColumnPermission).optional(),
});

// ============================================================================
// Form view (phase 4+)
// ============================================================================

const FormFieldDef = z.object({
  joinAlias: JoinAlias.optional(),
  column: ColumnName,
  label: z.string().optional(),
  helpText: z.string().optional(),
  widget: z
    .enum([
      "text", "textarea", "number", "datetime", "date",
      "boolean", "select", "fk_picker", "json_editor", "markdown",
    ])
    .optional(),
  readonly: z.boolean().optional(),
});

const FormSectionDef = z.object({
  title: z.string(),
  description: z.string().optional(),
  fields: z.array(FormFieldDef),
  collapsed: z.boolean().optional(),
});

const FormViewDef = z.object({
  sections: z.array(FormSectionDef),
  width: z.enum(["narrow", "medium", "wide"]).optional(),
});

// ============================================================================
// Row actions
// ============================================================================

const RowActionDef = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  kind: z.enum(["sql", "mutation", "navigate"]),
  config: z.record(z.string(), z.unknown()),
  confirm: z.boolean().optional(),
  requireRole: z.array(z.string()).optional(),
});

// ============================================================================
// Base: what the perspective reads from
// ============================================================================

const ParamDef = z.object({
  name: z.string().min(1),
  type: z.enum(["text", "number", "boolean", "date", "datetime"]),
  default: LiteralValue.optional(),
  required: z.boolean().optional(),
});

const PerspectiveBase = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("table"),
    schema: SchemaName,
    table: TableName,
    /** Optional structured joins. See JoinDef for cardinality constraints. */
    joins: z.array(JoinDef).optional(),
  }),
  z.object({
    kind: z.literal("sql"),
    query: z.string().min(1),
    parameters: z.array(ParamDef).optional(),
    // No structured joins on SQL bases — the SQL already encodes them.
  }),
]);

// ============================================================================
// Top-level PerspectiveDef
// ============================================================================

const PerspectiveDefV1 = z.object({
  id: ULID,
  name: z.string().min(1),
  description: z.string().optional(),
  base: PerspectiveBase,
  columns: z.array(ColumnDef),
  sort: z.array(SortDef),
  filters: FilterGroup,
  filterBar: FilterBarConfig,
  defaultPageSize: z.number().int().positive().max(10000).optional(),
  rowActions: z.array(RowActionDef).optional(),
  formView: FormViewDef.optional(),
  permissions: PermissionDef.optional(),
  createdBy: z.string().min(1),
  updatedAt: ISODateTime,
  version: z.literal(1),
  /**
   * Whether the perspective's author was a trusted writer. Set to `true`
   * only by paths that have already verified the author's identity and
   * intent — e.g. interactive desktop edits by the local user, or an
   * authenticated workspace admin in shared mode. AI-generated perspectives
   * and perspectives imported from untrusted sources MUST stay `false`
   * (the default).
   *
   * Untrusted perspectives cannot carry `{ computed: <raw SQL> }` column
   * sources or `base.kind: "sql"` queries — both are arbitrary-SQL escape
   * hatches that would otherwise execute against the user's database with
   * the connection's privileges. Compilation rejects them; see
   * AUDIT-CODEX.md finding #5.
   */
  trustedSql: z.boolean().optional(),
});

/**
 * The exported PerspectiveDef. When schema migrations land, this becomes a
 * discriminated union on `version`:
 *
 *   export const PerspectiveDef = z.discriminatedUnion("version", [
 *     PerspectiveDefV1, PerspectiveDefV2, ...
 *   ]);
 */
export const PerspectiveDef = PerspectiveDefV1;
export type PerspectiveDef = z.infer<typeof PerspectiveDef>;

// ============================================================================
// RelationDef
// ============================================================================

const TableRef = z.object({
  schema: SchemaName,
  table: TableName,
  columns: z.array(ColumnName).min(1),
});

const JunctionRef = z.object({
  schema: SchemaName,
  table: TableName,
  fromCols: z.array(ColumnName).min(1),
  toCols: z.array(ColumnName).min(1),
});

export const RelationDef = z
  .object({
    id: ULID,
    from: TableRef,
    to: TableRef,
    cardinality: z.enum(["one-to-one", "one-to-many", "many-to-many"]),
    junction: JunctionRef.optional(),
    /** Where this relation came from: the DB schema (FK) or user-defined. */
    source: z.enum(["schema", "custom"]),
    displayDirection: z.enum(["forward", "reverse", "both"]),
    label: z
      .object({
        forward: z.string().optional(),
        reverse: z.string().optional(),
      })
      .optional(),
    createdBy: z.string().optional(),
    updatedAt: ISODateTime,
  })
  .refine(
    (r) => r.cardinality !== "many-to-many" || r.junction !== undefined,
    { message: "many-to-many relations must specify a junction table" }
  )
  .refine(
    (r) =>
      r.cardinality === "many-to-many" ||
      r.from.columns.length === r.to.columns.length,
    { message: "from.columns and to.columns must have the same length" }
  );

export type RelationDef = z.infer<typeof RelationDef>;

// ============================================================================
// DisplayConfig
// ============================================================================

export const DisplayConfig = z.object({
  schema: SchemaName,
  table: TableName,
  /** Primary label column for FK cells, breadcrumbs, and the inspector. Absent
   *  means "fall back to PK values joined by ·". Optional so a user can save
   *  a config that only sets cardinality preview. */
  displayColumn: ColumnName.optional(),
  secondaryColumn: ColumnName.optional(),
  rowLabelTemplate: z.string().optional(),
  /** 0–2 outbound-relation IDs whose counts the grid should show inline on
   *  each row of this table (e.g. customers' "47 orders · 3 tags" badges).
   *  Absent or empty means cardinality preview is off. */
  cardinalityRelations: z.array(z.string().min(1)).max(2).optional(),
  updatedAt: ISODateTime,
});

export type DisplayConfig = z.infer<typeof DisplayConfig>;

// ============================================================================
// Validation helpers
// ============================================================================

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: z.ZodError };

export function validatePerspective(
  input: unknown
): ValidationResult<PerspectiveDef> {
  const result = PerspectiveDef.safeParse(input);
  if (!result.success) {
    return { ok: false, errors: result.error };
  }
  const trustError = enforceTrustedSqlBoundary(result.data);
  if (trustError !== null) {
    return { ok: false, errors: trustError };
  }
  return { ok: true, value: result.data };
}

/**
 * Trust enforcement: untrusted perspectives must not carry raw-SQL escape
 * hatches. `computed` column sources and `kind: "sql"` bases both feed
 * arbitrary text into the compiled query; the only safe path for an
 * untrusted (or AI-generated, or imported) perspective is to keep both
 * shut. AUDIT-CODEX.md finding #5.
 *
 * Returns `null` when the perspective is acceptable, otherwise a
 * `ZodError` aligned with `validatePerspective`'s error shape so callers
 * don't branch on a second error type.
 */
function enforceTrustedSqlBoundary(p: PerspectiveDef): z.ZodError | null {
  if (p.trustedSql === true) return null;
  const issues: z.ZodIssue[] = [];
  if (p.base.kind === "sql") {
    issues.push({
      code: "custom",
      path: ["base", "kind"],
      message:
        "Untrusted perspectives cannot use a raw-SQL base. Set trustedSql=true on writers that have already verified the author's identity.",
    });
  }
  for (const [i, col] of p.columns.entries()) {
    if ("computed" in col.source) {
      issues.push({
        code: "custom",
        path: ["columns", i, "source", "computed"],
        message:
          "Untrusted perspectives cannot use `computed` raw-SQL column sources. Set trustedSql=true on writers that have already verified the author's identity.",
      });
    }
  }
  return issues.length > 0 ? new z.ZodError(issues) : null;
}

export function validateRelation(
  input: unknown
): ValidationResult<RelationDef> {
  const result = RelationDef.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, errors: result.error };
}

export function validateDisplayConfig(
  input: unknown
): ValidationResult<DisplayConfig> {
  const result = DisplayConfig.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, errors: result.error };
}

export const schemas = {
  PerspectiveDef,
  RelationDef,
  DisplayConfig,
  FilterGroup,
  FilterLeaf,
  ColumnDef,
  PermissionDef,
  PerspectiveBase,
  JoinDef,
};
