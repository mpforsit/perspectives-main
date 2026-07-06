/**
 * Pure helpers for the row inspector.
 *
 * The inspector lists "Referenced by" entries for a focused row in
 * (schema, table). Each entry resolves a RelationDef + count into a
 * navigable target — for a 1:n that's the referencing child table filtered
 * by the FK; for an m:n that's the far-side participant filtered through
 * the junction.
 *
 * Engine-side: `getReferencingCounts` already suppresses the junction's
 * component 1:n relations. The renderer takes those counts at face value;
 * this module only handles the bookkeeping to turn a RelationDef into a
 * filteredTable tab payload.
 */

import type { FilterGroup, FilterLeaf, RelationDef } from "@perspectives/engine";

import type { BreadcrumbStep } from "./links";

/**
 * For the focused row in `(focusedSchema, focusedTable)` with PK values
 * `pkValues`, build the navigation target for a "Referenced by" relation
 * entry. Returns the schema/table to open, the filter to apply, and a
 * breadcrumb step suitable for prepending to the trail.
 *
 *   - 1:n / 1:1: focused appears as `to`; we navigate to `from` (the child)
 *     filtered by `from.columns = pkValues`.
 *   - m:n: focused appears as either `from` or `to`; we navigate to the
 *     opposite side, filtering via a SUBSELECT through the junction. For
 *     this phase we encode the junction lookup as the same equality
 *     filter on the junction columns — the engine compiler accepts it
 *     directly as an inbound filter against the junction, NOT against the
 *     far-side table.
 *
 * For m:n we DON'T yet open the far-side table directly (Phase 3 will
 * compile the junction sub-select into a single QueryPlan). Phase 2.3
 * navigates to the JUNCTION TABLE filtered by the focused row's PK,
 * which is enough for the verification flow ("3 tags via customer_tags")
 * — clicking opens the junction filtered to the matching rows, and the
 * user can follow the second FK to land at tags. Phase 2.5's display
 * labels will smooth this further.
 */
export interface ReferencingTarget {
  schema: string;
  table: string;
  filter: FilterGroup;
  /** A user-facing identifier for this entry: typically the target table
   *  name plus the relation's reverse label when set. */
  caption: string;
  /** A new breadcrumb step to append after the focused row's origin step. */
  crumb: BreadcrumbStep;
}

/** Subset of a focused row's primitive fields — what we ship to the
 *  engine + use to build per-relation filters. */
export type RowValueMap = Readonly<
  Record<string, string | number | boolean | null>
>;

export function buildReferencingTarget(
  relation: RelationDef,
  focusedSchema: string,
  focusedTable: string,
  rowValues: RowValueMap,
): ReferencingTarget | null {
  if (relation.cardinality === "many-to-many") {
    if (relation.junction === undefined) return null;
    // The junction's `fromCols` reference the m:n's `from` side; `toCols`
    // reference the `to` side. Pick whichever cols point at the focused
    // table and filter the junction with values pulled from the focused
    // row.
    let junctionCols: readonly string[];
    let referencedCols: readonly string[];
    if (
      relation.from.schema === focusedSchema &&
      relation.from.table === focusedTable
    ) {
      junctionCols = relation.junction.fromCols;
      referencedCols = relation.from.columns;
    } else if (
      relation.to.schema === focusedSchema &&
      relation.to.table === focusedTable
    ) {
      junctionCols = relation.junction.toCols;
      referencedCols = relation.to.columns;
    } else {
      return null;
    }
    const filter = mapFilter(junctionCols, referencedCols, rowValues);
    if (filter === null) return null;
    const farSideTable =
      relation.from.schema === focusedSchema && relation.from.table === focusedTable
        ? relation.to
        : relation.from;
    const caption =
      relation.label?.reverse ??
      `via ${relation.junction.schema}.${relation.junction.table} → ${farSideTable.schema}.${farSideTable.table}`;
    return {
      schema: relation.junction.schema,
      table: relation.junction.table,
      filter,
      caption,
      crumb: {
        schema: relation.junction.schema,
        table: relation.junction.table,
        label: `${relation.junction.table}[via ${focusedTable}]`,
        filter,
      },
    };
  }

  // 1:n / 1:1: focused must be on the `to` (parent) side. Filter the
  // child table by its FK columns.
  if (
    relation.to.schema !== focusedSchema ||
    relation.to.table !== focusedTable
  ) {
    return null;
  }
  const filter = mapFilter(relation.from.columns, relation.to.columns, rowValues);
  if (filter === null) return null;
  const caption =
    relation.label?.reverse ??
    `${relation.from.schema}.${relation.from.table}`;
  return {
    schema: relation.from.schema,
    table: relation.from.table,
    filter,
    caption,
    crumb: {
      schema: relation.from.schema,
      table: relation.from.table,
      label: `${relation.from.table}[via ${focusedTable}]`,
      filter,
    },
  };
}

/**
 * Pair `referencingCols` with `targetCols` positionally, then look up each
 * target column's value in `rowValues`. Returns `null` when a target
 * column is missing from the row (caller skips the relation).
 */
function mapFilter(
  referencingCols: readonly string[],
  targetCols: readonly string[],
  rowValues: RowValueMap,
): FilterGroup | null {
  if (referencingCols.length !== targetCols.length) return null;
  const leaves: FilterLeaf[] = [];
  for (let i = 0; i < referencingCols.length; i++) {
    const refCol = referencingCols[i];
    const targetCol = targetCols[i];
    if (refCol === undefined || targetCol === undefined) return null;
    if (!(targetCol in rowValues)) return null;
    leaves.push({
      column: refCol,
      op: "eq",
      value: rowValues[targetCol] as FilterLeaf["value"],
    });
  }
  return { op: "and", children: leaves };
}

/**
 * Pre-filter a row's entries to the JSON-safe primitives the engine
 * accepts. Drops Dates, Buffers, arrays, nested objects, bigints — they
 * never appear as FK targets in practice, and shipping them over the IPC
 * boundary would either fail Zod validation or waste bandwidth.
 */
export function pickRowValues(
  row: Readonly<Record<string, unknown>>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(row)) {
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean" ||
      v === null
    ) {
      out[k] = v;
    }
  }
  return out;
}
