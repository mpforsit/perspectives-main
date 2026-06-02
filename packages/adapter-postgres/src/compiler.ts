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
// Compile `(c1, c2, ..., cN) > (v1, v2, ..., vN)` as a nested-OR expansion so
// that per-column ASC/DESC directions can differ:
//
//   (c1 [>|<] v1)
//   OR (c1 = v1 AND c2 [>|<] v2)
//   OR (c1 = v1 AND c2 = v2 AND c3 [>|<] v3)
//   ...
//
// Row-tuple comparison `(c1, c2) > (v1, v2)` would be tighter SQL but only
// works when every column shares a direction.
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
    const parts: string[] = [];
    for (let j = 0; j < i; j++) {
      const sortJ = predicate.sort[j];
      if (sortJ === undefined) continue;
      params.push(predicate.values[j]);
      parts.push(`${quoteIdentifier(sortJ.column)} = $${params.length}`);
    }
    const sortI = predicate.sort[i];
    if (sortI === undefined) continue;
    const op = sortI.direction === "asc" ? ">" : "<";
    params.push(predicate.values[i]);
    parts.push(`${quoteIdentifier(sortI.column)} ${op} $${params.length}`);
    branches.push(`(${parts.join(" AND ")})`);
  }
  return `(${branches.join(" OR ")})`;
}
