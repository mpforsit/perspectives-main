/**
 * Pure helpers for forward-FK navigation.
 *
 * Given a `RelationDef` and a source row (whatever the user clicked), build
 * the target-side filter, the pk-values array `getRowByKey` needs, and a
 * breadcrumb label. These are pure transforms — testable without a grid,
 * a tRPC client, or a database. The TableView wires them through the
 * appropriate engine calls.
 *
 * Convention (matches Phase 2.1's derivation module):
 *   - `relation.from` is the FK-bearing side (the row the user clicked).
 *   - `relation.to`   is the referenced side (the row we navigate to).
 *   - `relation.from.columns[i]` and `relation.to.columns[i]` are aligned
 *     by position; compound FKs preserve that alignment.
 */

import type { FilterGroup, FilterLeaf, RelationDef } from "@perspectives/engine";

import type { DataGridRow } from "../grid/types";

/** A breadcrumb step in a navigation trail. The full UI lands in 2.7. */
export interface BreadcrumbStep {
  schema: string;
  table: string;
  /** Human-readable identifier — typically the row's PK values formatted
   *  for display. Phase 2.5's DisplayConfig replaces this with a proper
   *  row label; for now we render the PK tuple. */
  label: string;
  /** The filter that selects this row in `schema.table`. */
  filter: FilterGroup;
}

/**
 * Build the target-side `FilterGroup` for a forward-FK click. An AND of
 * equality leaves — one per FK column pair. Throws when `relation.from`
 * and `relation.to` disagree on column count (which the DSL refuses, but
 * we guard at the JS level too because the caller's invariant is the only
 * thing standing between a bad relation and a malformed query).
 */
export function buildLinkFilter(
  relation: RelationDef,
  sourceRow: DataGridRow,
): FilterGroup {
  if (relation.from.columns.length !== relation.to.columns.length) {
    throw new Error(
      `buildLinkFilter: relation ${relation.id} has mismatched column counts (${relation.from.columns.length} vs ${relation.to.columns.length})`,
    );
  }
  const leaves: FilterLeaf[] = relation.from.columns.map((fromCol, i) => {
    const targetCol = relation.to.columns[i];
    if (targetCol === undefined) {
      throw new Error(`buildLinkFilter: missing target column at index ${i} in relation ${relation.id}`);
    }
    return {
      column: targetCol,
      op: "eq",
      value: sourceRow[fromCol] as FilterLeaf["value"],
    };
  });
  return { op: "and", children: leaves };
}

/**
 * Extract the target-side primary-key values for a forward-FK click. Used
 * by `data.getRowByKey` to confirm the row exists before opening a tab.
 * Order matches the *target* side's column order, which is what
 * `getRowByKey` requires for compound PKs.
 */
export function extractTargetPkValues(
  relation: RelationDef,
  sourceRow: DataGridRow,
): Array<string | number | boolean | null> {
  return relation.from.columns.map(
    (fromCol) => sourceRow[fromCol] as string | number | boolean | null,
  );
}

/**
 * Format a breadcrumb-step label for a row in the target table. For now
 * we render `<table>[<pk1>,<pk2>,…]`; Phase 2.5 will replace this with the
 * table's configured display column. Caller passes the target-side PK
 * tuple in column order.
 */
export function formatBreadcrumbLabel(
  table: string,
  pkValues: ReadonlyArray<string | number | boolean | null>,
): string {
  const formatted = pkValues
    .map((v) => (v === null ? "∅" : String(v)))
    .join(",");
  return `${table}[${formatted}]`;
}

/**
 * Build the per-column FK-link map for a table view. For every outbound FK
 * from `(schema, table)`, every column that participates in the FK gets a
 * `ForwardLink` pointing at the relation. Compound FKs share the same link
 * across member columns; clicking any of them follows the relation.
 *
 * When a single column participates in multiple FKs (rare but legal), the
 * first relation in `relations` wins. Phase 2 doesn't surface a picker yet.
 */
export function buildColumnLinkMap(
  relations: readonly RelationDef[],
  schema: string,
  table: string,
): Map<string, RelationDef> {
  const out = new Map<string, RelationDef>();
  for (const rel of relations) {
    if (rel.from.schema !== schema || rel.from.table !== table) continue;
    for (const col of rel.from.columns) {
      if (!out.has(col)) out.set(col, rel);
    }
  }
  return out;
}
