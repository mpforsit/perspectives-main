/**
 * Compile a `QueryPlan` into parameterised PostgreSQL.
 *
 * Every value the user supplied (filter operands, sort cursor tuples) becomes
 * a $n parameter. Identifiers come straight from the plan and are quoted via
 * `quoteIdentifier`. The only place raw SQL is interpolated is in
 * `computed` column expressions — that's the explicit DSL escape hatch and
 * the trust boundary is the perspective itself, not this compiler.
 */

import { ValidationError } from "@perspectives/engine";
import type {
  ColumnDef,
  FilterGroup,
  FilterLeaf,
  QueryPlan,
  SortDef,
} from "@perspectives/engine";

// ============================================================================
// Identifier quoting
// ============================================================================

export function quoteIdentifier(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

export function quoteQualified(schema: string, name: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

// ============================================================================
// Top-level SELECT compiler
// ============================================================================

export interface KeysetPredicate {
  /** Effective sort columns the cursor's `values` align with. */
  sort: SortDef[];
  /** Tuple of values from the previous page's last row, in `sort` order. */
  values: ReadonlyArray<unknown>;
}

export interface CompileSelectOptions {
  /** Replace `plan.sort` with this (used by `paginateKeyset` to append the
   *  PK tiebreaker without mutating the caller's plan). */
  sortOverride?: SortDef[];
  /** Replace `plan.limit` with this. */
  limitOverride?: number | undefined;
  /** Optional keyset predicate ANDed with the plan's filters. */
  keysetPredicate?: KeysetPredicate;
}

export function compileSelectQuery(
  plan: QueryPlan,
  params: unknown[],
  options: CompileSelectOptions = {},
): string {
  if (plan.base.kind !== "table") {
    throw new ValidationError("SQL-base perspectives are not supported in this phase");
  }
  if (plan.joins.length > 0) {
    throw new ValidationError("Joins are not supported in this phase");
  }
  if (plan.columns.length === 0) {
    throw new ValidationError("QueryPlan.columns must not be empty");
  }

  const select = plan.columns.map(compileColumn).join(", ");
  const from = quoteQualified(plan.base.schema, plan.base.table);

  const whereParts: string[] = [];
  if (plan.filters !== undefined) {
    const compiled = compileFilterGroup(plan.filters, params);
    if (compiled !== "TRUE") {
      whereParts.push(compiled);
    }
  }
  if (options.keysetPredicate !== undefined) {
    whereParts.push(compileKeysetPredicate(options.keysetPredicate, params));
  }
  const where = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  const sortDefs = options.sortOverride ?? plan.sort;
  const orderBy = sortDefs.length > 0 ? `ORDER BY ${sortDefs.map(compileSort).join(", ")}` : "";

  const limit =
    options.limitOverride !== undefined
      ? options.limitOverride
      : plan.limit;
  const limitClause = typeof limit === "number" ? `LIMIT ${Math.max(0, Math.floor(limit))}` : "";

  const offsetClause =
    typeof plan.offset === "number" ? `OFFSET ${Math.max(0, Math.floor(plan.offset))}` : "";

  return [`SELECT ${select}`, `FROM ${from}`, where, orderBy, limitClause, offsetClause]
    .filter((part) => part.length > 0)
    .join(" ");
}

// ============================================================================
// Column compilation
// ============================================================================

function compileColumn(col: ColumnDef): string {
  const src = col.source;
  let expr: string;
  if ("joinAlias" in src) {
    throw new ValidationError(
      "Join-qualified column references are not supported in this phase",
    );
  } else if ("column" in src) {
    expr = quoteIdentifier(src.column);
  } else {
    // `computed` is raw SQL straight from the DSL. The perspective storage
    // layer is the trust boundary — by the time the plan reaches the
    // compiler, the engine has authorised the perspective. See README.
    expr = `(${src.computed})`;
  }
  if (col.alias !== undefined) {
    expr += ` AS ${quoteIdentifier(col.alias)}`;
  }
  return expr;
}

// ============================================================================
// Sort
// ============================================================================

function compileSort(sort: SortDef): string {
  if (sort.joinAlias !== undefined) {
    throw new ValidationError("Sort by joined column not supported in this phase");
  }
  const dir = sort.direction === "asc" ? "ASC" : "DESC";
  const nulls = sort.nulls === "first" ? " NULLS FIRST" : sort.nulls === "last" ? " NULLS LAST" : "";
  return `${quoteIdentifier(sort.column)} ${dir}${nulls}`;
}

// ============================================================================
// Filter compilation
// ============================================================================

type FilterChild = FilterGroup["children"][number];

export function compileFilterGroup(group: FilterGroup, params: unknown[]): string {
  if (group.children.length === 0) return "TRUE";
  const parts = group.children.map((child: FilterChild) => {
    if (isFilterLeaf(child)) {
      return compileFilterLeaf(child, params);
    }
    return compileFilterGroup(child, params);
  });
  const op = group.op === "and" ? "AND" : "OR";
  return `(${parts.join(` ${op} `)})`;
}

function isFilterLeaf(child: FilterChild): child is FilterLeaf {
  return "column" in child;
}

function compileFilterLeaf(leaf: FilterLeaf, params: unknown[]): string {
  if (leaf.joinAlias !== undefined) {
    throw new ValidationError("Join-qualified filter columns not supported in this phase");
  }
  const col = quoteIdentifier(leaf.column);

  switch (leaf.op) {
    case "eq":
      return `${col} = ${pushValue(leaf, params)}`;
    case "neq":
      return `${col} <> ${pushValue(leaf, params)}`;
    case "lt":
      return `${col} < ${pushValue(leaf, params)}`;
    case "gt":
      return `${col} > ${pushValue(leaf, params)}`;
    case "lte":
      return `${col} <= ${pushValue(leaf, params)}`;
    case "gte":
      return `${col} >= ${pushValue(leaf, params)}`;
    case "ilike":
      return `${col} ILIKE ${pushValue(leaf, params)}`;
    case "like":
      return `${col} LIKE ${pushValue(leaf, params)}`;
    case "not_ilike":
      return `${col} NOT ILIKE ${pushValue(leaf, params)}`;
    case "is_null":
      return `${col} IS NULL`;
    case "is_not_null":
      return `${col} IS NOT NULL`;
    case "in":
      return `${col} = ANY(${pushArrayValue(leaf, params)})`;
    case "nin":
      return `${col} <> ALL(${pushArrayValue(leaf, params)})`;
    case "between":
      return compileBetween(col, leaf, params);
    case "contains":
      return `${col} @> ${pushValue(leaf, params)}`;
    case "contained_by":
      return `${col} <@ ${pushValue(leaf, params)}`;
    default: {
      // Exhaustiveness check — adding a new filter op anywhere in the DSL
      // forces this branch to fail to compile until the compiler catches up.
      const exhaustive: never = leaf.op;
      throw new ValidationError(`Unsupported filter op: ${String(exhaustive)}`);
    }
  }
}

function compileBetween(col: string, leaf: FilterLeaf, params: unknown[]): string {
  if (!Array.isArray(leaf.value) || leaf.value.length !== 2) {
    throw new ValidationError(
      `Filter op "between" expects a [low, high] tuple, got: ${JSON.stringify(leaf.value)}`,
    );
  }
  const [low, high] = leaf.value;
  params.push(low);
  const lowPlaceholder = `$${params.length}`;
  params.push(high);
  const highPlaceholder = `$${params.length}`;
  return `${col} BETWEEN ${lowPlaceholder} AND ${highPlaceholder}`;
}

function pushValue(leaf: FilterLeaf, params: unknown[]): string {
  if (leaf.value === undefined) {
    throw new ValidationError(`Filter op "${leaf.op}" requires a value`);
  }
  if (isDynamicValue(leaf.value)) {
    return compileDynamicValue(leaf.value);
  }
  params.push(leaf.value);
  return `$${params.length}`;
}

function pushArrayValue(leaf: FilterLeaf, params: unknown[]): string {
  if (!Array.isArray(leaf.value)) {
    throw new ValidationError(
      `Filter op "${leaf.op}" expects an array value, got: ${JSON.stringify(leaf.value)}`,
    );
  }
  params.push(leaf.value);
  return `$${params.length}`;
}

// ============================================================================
// Dynamic values
// ============================================================================

interface DynamicValue {
  kind: string;
  [k: string]: unknown;
}

function isDynamicValue(value: unknown): value is DynamicValue {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "kind" in value &&
    typeof (value as { kind: unknown }).kind === "string"
  );
}

function compileDynamicValue(value: DynamicValue): string {
  switch (value.kind) {
    case "today": {
      const offset = typeof value["offset"] === "number" ? value["offset"] : 0;
      // Render inline as an integer offset; no user input reaches the SQL.
      return `(CURRENT_DATE + ${Math.trunc(offset)})`;
    }
    case "param":
    case "currentUser":
    case "interval":
      throw new ValidationError(
        `Dynamic filter value "${value.kind}" is not supported in this phase`,
      );
    default:
      throw new ValidationError(`Unknown dynamic filter value kind: ${value.kind}`);
  }
}

// ============================================================================
// Keyset predicate
//
// Move past the tuple `(v1, ..., vN)` in the effective sort order. The
// classical formulation is the nested-OR expansion:
//
//   (c1 [>|<] v1)
//   OR (c1 = v1 AND c2 [>|<] v2)
//   OR (c1 = v1 AND c2 = v2 AND c3 [>|<] v3)
//   ...
//
// Per-column ASC/DESC directions can differ here; row-tuple comparison
// `(c1, c2) > (v1, v2)` would be tighter but only works when every column
// shares a direction.
//
// Nullable columns get null-aware variants because `NULL > x` is `NULL`
// (unknown), which silently drops rows. AUDIT-CODEX.md finding #10. The
// equality and "strict greater" predicates branch on whether the cursor
// value and/or the row value can be null, and respect each column's
// effective NULLS FIRST / NULLS LAST treatment (defaulting to the
// PostgreSQL standard: ASC = NULLS LAST, DESC = NULLS FIRST).
// ============================================================================

function compileKeysetPredicate(
  predicate: KeysetPredicate,
  params: unknown[],
): string {
  if (predicate.values.length !== predicate.sort.length) {
    throw new ValidationError(
      `Keyset cursor has ${predicate.values.length} values for ${predicate.sort.length} sort columns`,
    );
  }
  const branches: string[] = [];
  for (let i = 0; i < predicate.sort.length; i++) {
    const sortI = predicate.sort[i];
    if (sortI === undefined) continue;
    const valueI = predicate.values[i];
    const strict = compileKeysetStrict(sortI, valueI, params);
    if (strict === null) continue;

    const parts: string[] = [];
    for (let j = 0; j < i; j++) {
      const sortJ = predicate.sort[j];
      if (sortJ === undefined) continue;
      parts.push(compileKeysetEquality(sortJ, predicate.values[j], params));
    }
    parts.push(strict);
    branches.push(`(${parts.join(" AND ")})`);
  }
  // No movable column at all (every column's cursor value sat at the
  // ordering's terminal NULL slot). Returning FALSE rather than an empty
  // string keeps the surrounding WHERE valid.
  if (branches.length === 0) return "FALSE";
  return `(${branches.join(" OR ")})`;
}

/**
 * `column = value` semantics aligned with the cursor: a NULL cursor value
 * must compare equal to a NULL row value (SQL `=` is `NULL` in that case),
 * so we substitute `IS NOT DISTINCT FROM` semantics by hand.
 */
function compileKeysetEquality(
  sort: SortDef,
  value: unknown,
  params: unknown[],
): string {
  const col = quoteIdentifier(sort.column);
  if (value === null) {
    return `${col} IS NULL`;
  }
  params.push(value);
  return `${col} = $${params.length}`;
}

/**
 * Strict "past `value`" predicate for one column under its effective sort
 * direction + nulls placement. Returns `null` when `value` already sits at
 * the ordering's terminal slot — that column can no longer advance the
 * iteration on its own, so the branch is dropped.
 */
function compileKeysetStrict(
  sort: SortDef,
  value: unknown,
  params: unknown[],
): string | null {
  const col = quoteIdentifier(sort.column);
  const ascending = sort.direction === "asc";
  const nullsLast = effectiveNullsLast(sort);

  if (value === null) {
    // Cursor sits at a NULL value. Whether the iteration can move further
    // on this column depends on where NULLs are placed in the order:
    //   NULLS FIRST → NULL is at the start, everything non-NULL is past it
    //   NULLS LAST  → NULL is at the end, nothing is past it
    return nullsLast ? null : `${col} IS NOT NULL`;
  }

  const op = ascending ? ">" : "<";
  params.push(value);
  const strict = `${col} ${op} $${params.length}`;

  // For NULLS LAST under either direction, NULL rows sit *after* every
  // non-null value, so they are "past" the cursor's non-null value too —
  // include them via OR. For NULLS FIRST, NULLs come *before* the cursor's
  // value, so they are already covered by an earlier iteration step and
  // must be excluded (`col > $n` already does so — SQL filters them out).
  return nullsLast ? `(${strict} OR ${col} IS NULL)` : strict;
}

function effectiveNullsLast(sort: SortDef): boolean {
  if (sort.nulls === "last") return true;
  if (sort.nulls === "first") return false;
  // PostgreSQL defaults: ASC → NULLS LAST, DESC → NULLS FIRST.
  return sort.direction === "asc";
}
