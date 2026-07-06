/**
 * Batched FK-label resolution for the visible grid page.
 *
 * For every column on the current table that has a 1:n / 1:1 forward-FK
 * `link`, collect the distinct target-side PK tuples across the visible
 * rows, group by target `(schema, table)`, and fire one
 * `data.getRowLabels` round trip per target. The returned `linkLabelFor`
 * callback hands the cached label back to the DataGrid synchronously —
 * `null` while loading; the human-readable string when ready.
 *
 * Labels are kept in component-local state keyed by `(targetSchema,
 * targetTable, pkTuple)`. The cache survives row changes (so paginating
 * back-and-forth doesn't refetch known labels) and lives for the lifetime
 * of the hook (typically: the active table tab). Refresh of the page
 * doesn't invalidate; if labels go stale because a target row was edited
 * elsewhere, that's a Phase 4 concern.
 *
 * m:n relations don't surface labels here — Phase 2.2's grid annotation
 * only carries 1:n / 1:1 forward links anyway.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DataGridColumn, DataGridRow } from "../grid/types";
import { trpc } from "../trpc/client";

type Primitive = string | number | boolean | null;

/** Stable string key for a (schema, table) pair. */
function targetKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

/** Stable string key for a PK tuple — normalised so `1` matches `"1"` (pg
 *  int8 defaults to string), `true`/`false` match the boolean form, and
 *  `null` keeps its identity. */
function tupleKey(tuple: ReadonlyArray<Primitive>): string {
  return JSON.stringify(tuple.map((v) => (v === null ? null : String(v))));
}

interface PendingRequest {
  schema: string;
  table: string;
  /** Distinct PK tuples we need labels for. */
  pkTuples: Primitive[][];
}

export function useFkLabels(
  connectionId: string,
  columns: readonly DataGridColumn[],
  rows: readonly DataGridRow[],
): (column: DataGridColumn, row: DataGridRow) => string | null {
  const utils = trpc.useUtils();
  // labelMap[targetKey][tupleKey] = label
  const [labelMap, setLabelMap] = useState<Map<string, Map<string, string>>>(
    () => new Map(),
  );

  // Compute which (target, pkTuple) combinations are referenced by the
  // visible page. Deduped within each target.
  const required = useMemo<PendingRequest[]>(() => {
    const byTarget = new Map<string, PendingRequest>();
    for (const col of columns) {
      const link = col.link;
      if (link === undefined) continue;
      // Relations that reference unique non-PK columns (custom relations
      // like `orders.status → customers.email`) are still clickable, but
      // the engine's `getRowLabels` is PK-keyed — feeding it non-PK
      // values would type-fail on the target's PK column. Skip them here
      // and the cell falls back to the raw value.
      if (!link.targetIsPk) continue;
      const rel = link.relation;
      if (rel.cardinality === "many-to-many") continue;
      const tk = targetKey(rel.to.schema, rel.to.table);
      let entry = byTarget.get(tk);
      if (entry === undefined) {
        entry = { schema: rel.to.schema, table: rel.to.table, pkTuples: [] };
        byTarget.set(tk, entry);
      }
      // The target-side PK values come from the source row's FK columns
      // (paired positionally with `to.columns` per Phase 2.1 convention).
      // We need to send them in the TARGET table's PK column order — the
      // engine's getRowLabels keys results by that order. For typical FKs
      // (FK references the parent's PK in PK order), `rel.to.columns`
      // IS the PK order. For the edge case where they differ, we'd need a
      // permutation step — we don't have the target's TableInfo here, so
      // we accept the typical case and skip the edge for now.
      const seen = new Set<string>();
      for (const row of rows) {
        const tuple = rel.from.columns.map(
          (c) => (row[c] ?? null) as Primitive,
        );
        if (tuple.some((v) => v === undefined)) continue;
        const k = tupleKey(tuple);
        if (seen.has(k)) continue;
        seen.add(k);
        entry.pkTuples.push(tuple);
      }
    }
    return [...byTarget.values()].filter((r) => r.pkTuples.length > 0);
  }, [columns, rows]);

  // Ref to the latest map — used inside the effect so the effect doesn't
  // depend on labelMap (which would re-fire forever). NB: no in-flight ref
  // set. A previous draft used one to dedupe concurrent fetches, but it
  // outlived React StrictMode's dev-only mount/cleanup/remount cycle: the
  // first mount populated the set, the cleanup flipped `cancelled` (so its
  // setState was dropped), and the second mount saw every tuple as "in
  // flight" and never refetched. The `cancelled` closure already gives
  // race-correctness; an occasional duplicate fetch is fine.
  const labelMapRef = useRef(labelMap);
  labelMapRef.current = labelMap;

  useEffect(() => {
    let cancelled = false;

    async function fetchMissingLabels() {
      let next: Map<string, Map<string, string>> | null = null;
      const ensureNext = () => {
        if (next === null) next = new Map(labelMapRef.current);
        return next;
      };

      for (const req of required) {
        const tk = targetKey(req.schema, req.table);
        const existing = labelMapRef.current.get(tk) ?? new Map<string, string>();

        const missing: Primitive[][] = [];
        for (const tup of req.pkTuples) {
          const tkey = tupleKey(tup);
          if (existing.has(tkey)) continue;
          missing.push(tup);
        }
        if (missing.length === 0) continue;

        try {
          const labels = await utils.client.data.getRowLabels.query({
            connectionId,
            schema: req.schema,
            table: req.table,
            pkTuples: missing,
          });
          if (cancelled) return;
          const merged = new Map(existing);
          for (let i = 0; i < missing.length; i++) {
            const tup = missing[i];
            const lbl = labels[i];
            if (tup === undefined || lbl === undefined) continue;
            merged.set(tupleKey(tup), lbl);
          }
          ensureNext().set(tk, merged);
        } catch {
          /* Best-effort; the grid falls back to the raw value on missing
             label. */
        }
      }

      if (!cancelled && next !== null) {
        setLabelMap(next);
      }
    }

    void fetchMissingLabels();
    return () => {
      cancelled = true;
    };
  }, [required, connectionId, utils.client.data.getRowLabels]);

  return useCallback(
    (column: DataGridColumn, row: DataGridRow): string | null => {
      const link = column.link;
      if (link === undefined) return null;
      const rel = link.relation;
      if (rel.cardinality === "many-to-many") return null;
      const tk = targetKey(rel.to.schema, rel.to.table);
      const inner = labelMap.get(tk);
      if (inner === undefined) return null;
      const tuple = rel.from.columns.map(
        (c) => (row[c] ?? null) as Primitive,
      );
      const label = inner.get(tupleKey(tuple));
      // Empty string = "row exists but no display config" → return null
      // so the grid shows the raw FK value.
      return label !== undefined && label.length > 0 ? label : null;
    },
    [labelMap],
  );
}
