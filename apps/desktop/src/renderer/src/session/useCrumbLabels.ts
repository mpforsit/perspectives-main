/**
 * Resolve human-readable labels for every step in a breadcrumb trail.
 *
 * Each crumb persists the label rendered at navigation time (a PK-based
 * fallback like `customers[42]` in the pre-DisplayConfig case). The hook
 * groups crumbs by target `(schema, table)`, extracts a PK tuple per
 * crumb, and issues one batched `data.getRowLabels` per distinct target.
 * The returned `Map<crumbIndex, string>` overrides the persisted label
 * with the fresh one; if resolution isn't possible (custom relation
 * targets a non-PK unique column, snapshot missing, empty result), the
 * caller falls back to the persisted label.
 *
 * Batching mirrors `useFkLabels`: one round trip per distinct target
 * table containing every deduped tuple, with a session-scoped cache so
 * scrolling breadcrumb trails doesn't cause repeated fetches.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { trpc } from "../trpc/client";
import { crumbTargetPk } from "./crumbs";
import type { BreadcrumbStep } from "./links";

type Primitive = string | number | boolean | null;

function tupleKey(tuple: ReadonlyArray<Primitive>): string {
  return JSON.stringify(tuple.map((v) => (v === null ? null : String(v))));
}

interface UseCrumbLabelsArgs {
  connectionId: string;
  crumbs: readonly BreadcrumbStep[];
  /** Snapshot table lookup — `${schema}.${table}` → `{ primaryKey }`. */
  tablesByKey: ReadonlyMap<string, { primaryKey: readonly string[] }>;
}

interface CrumbLookup {
  crumbIndex: number;
  schema: string;
  table: string;
  tuple: Primitive[];
}

export function useCrumbLabels(args: UseCrumbLabelsArgs): Map<number, string> {
  const { connectionId, crumbs, tablesByKey } = args;
  const utils = trpc.useUtils();

  // Local cache: `${schema}.${table}` → tupleKey → label.
  const [cache, setCache] = useState<Map<string, Map<string, string>>>(
    () => new Map(),
  );
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  // Extract every crumb's target (schema, table, tuple), skipping ones
  // whose filter doesn't cover the target's PK.
  const lookups = useMemo<CrumbLookup[]>(() => {
    const out: CrumbLookup[] = [];
    for (let i = 0; i < crumbs.length; i++) {
      const crumb = crumbs[i]!;
      const target = tablesByKey.get(`${crumb.schema}.${crumb.table}`);
      if (target === undefined) continue;
      const tuple = crumbTargetPk(crumb.filter, target.primaryKey);
      if (tuple === null) continue;
      out.push({
        crumbIndex: i,
        schema: crumb.schema,
        table: crumb.table,
        tuple,
      });
    }
    return out;
  }, [crumbs, tablesByKey]);

  useEffect(() => {
    if (lookups.length === 0) return;
    let cancelled = false;

    // Group by target table, deduplicating tuples.
    const byTarget = new Map<
      string,
      { schema: string; table: string; tuples: Primitive[][] }
    >();
    for (const l of lookups) {
      const key = `${l.schema}.${l.table}`;
      let entry = byTarget.get(key);
      if (entry === undefined) {
        entry = { schema: l.schema, table: l.table, tuples: [] };
        byTarget.set(key, entry);
      }
      const already = entry.tuples.some(
        (t) => tupleKey(t) === tupleKey(l.tuple),
      );
      if (!already) entry.tuples.push(l.tuple);
    }

    async function fetchMissing() {
      for (const [tk, entry] of byTarget) {
        const existing = cacheRef.current.get(tk) ?? new Map<string, string>();
        const missing = entry.tuples.filter(
          (t) => !existing.has(tupleKey(t)),
        );
        if (missing.length === 0) continue;

        try {
          const labels = await utils.client.data.getRowLabels.query({
            connectionId,
            schema: entry.schema,
            table: entry.table,
            pkTuples: missing,
          });
          if (cancelled) return;
          setCache((prev) => {
            const next = new Map(prev);
            const inner = new Map(next.get(tk) ?? new Map<string, string>());
            for (let i = 0; i < missing.length; i++) {
              const label = labels[i];
              const t = missing[i];
              if (label === undefined || t === undefined) continue;
              inner.set(tupleKey(t), label);
            }
            next.set(tk, inner);
            return next;
          });
        } catch {
          /* Best-effort; the caller falls back to the persisted label. */
        }
      }
    }

    void fetchMissing();
    return () => {
      cancelled = true;
    };
  }, [lookups, connectionId, utils.client.data.getRowLabels]);

  return useMemo(() => {
    const out = new Map<number, string>();
    for (const l of lookups) {
      const label = cache
        .get(`${l.schema}.${l.table}`)
        ?.get(tupleKey(l.tuple));
      // Empty string labels come back when the target row was deleted;
      // preserve the persisted PK-based label in that case.
      if (label !== undefined && label.length > 0) {
        out.set(l.crumbIndex, label);
      }
    }
    return out;
  }, [lookups, cache]);
}
