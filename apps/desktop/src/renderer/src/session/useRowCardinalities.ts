/**
 * Batched cardinality-preview resolution for the visible grid page.
 *
 * For each (visible source row, picked relation) pair, fetch the count of
 * matching children via `data.getCountsForRows` (one grouped round-trip
 * per relation when the target is small; per-row estimate when it's
 * huge). Results are cached keyed by `(relationId, sourcePkTuple)` and
 * survive row changes — paginating doesn't refetch known counts.
 *
 * `countsFor(row)` returns the slice for one row in `relationIds` order;
 * entries with `count === null` are still loading. `escalate(row, relId)`
 * forces an exact recount for the (row, relation) pair — used when the
 * user clicks a `~`-flagged estimate badge to promote it.
 *
 * The cache primitives live in `./cardinality-cache.ts` so the cache-hit
 * / cache-miss semantics are unit-testable without React or tRPC.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DataGridRow } from "../grid/types";
import { trpc } from "../trpc/client";
import {
  distinctPkTuples,
  mergeResults,
  missingForRelation,
  tupleKey,
  type CardinalityCache,
  type Primitive,
} from "./cardinality-cache";

export interface CountSlot {
  relationId: string;
  /** `null` while the fetch is in flight (badge can render a dash / dim). */
  count: number | null;
  estimated: boolean;
}

interface UseRowCardinalitiesArgs {
  connectionId: string;
  schema: string;
  table: string;
  /** PK column names in PK order — used to extract tuples from rows. */
  primaryKey: readonly string[];
  /** Relation IDs to preview (0-2). Empty disables the hook entirely. */
  relationIds: readonly string[];
  /** Currently loaded rows — typically the page's row supply. The hook
   *  derives tuples from each row's PK columns. */
  rows: readonly DataGridRow[];
}

export interface UseRowCardinalitiesResult {
  countsFor: (row: DataGridRow) => CountSlot[];
  /** Recompute the count for one (row, relation) pair as an exact count,
   *  bypassing the engine's estimate threshold. */
  escalate: (row: DataGridRow, relationId: string) => Promise<void>;
  /** Drop every cached count — next render refetches. */
  refresh: () => void;
}

export function useRowCardinalities(
  args: UseRowCardinalitiesArgs,
): UseRowCardinalitiesResult {
  const { connectionId, schema, table, primaryKey, relationIds, rows } = args;
  const utils = trpc.useUtils();

  const [cache, setCache] = useState<CardinalityCache>(() => new Map());
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  const pkTuples = useMemo<Primitive[][]>(
    () => distinctPkTuples(rows, primaryKey),
    [rows, primaryKey],
  );

  useEffect(() => {
    if (pkTuples.length === 0 || relationIds.length === 0) return;
    let cancelled = false;

    async function fetchMissing() {
      for (const relId of relationIds) {
        const missing = missingForRelation(cacheRef.current, relId, pkTuples);
        if (missing.length === 0) continue;

        try {
          const results = await utils.client.data.getCountsForRows.query({
            connectionId,
            schema,
            table,
            pkTuples: missing,
            relationIds: [relId],
          });
          if (cancelled) return;
          setCache((prev) => mergeResults(prev, relId, results));
        } catch {
          /* Best-effort; the badge falls back to a dash on missing data. */
        }
      }
    }

    void fetchMissing();
    return () => {
      cancelled = true;
    };
  }, [
    pkTuples,
    relationIds,
    connectionId,
    schema,
    table,
    utils.client.data.getCountsForRows,
  ]);

  const countsFor = useCallback(
    (row: DataGridRow): CountSlot[] => {
      if (primaryKey.length === 0 || relationIds.length === 0) return [];
      const tuple = primaryKey.map((c) => (row[c] ?? null) as Primitive);
      const tk = tupleKey(tuple);
      return relationIds.map((relId) => {
        const entry = cache.get(relId)?.get(tk);
        if (entry === undefined) {
          return { relationId: relId, count: null, estimated: false };
        }
        return {
          relationId: relId,
          count: entry.count,
          estimated: entry.estimated,
        };
      });
    },
    [cache, primaryKey, relationIds],
  );

  const escalate = useCallback(
    async (row: DataGridRow, relationId: string): Promise<void> => {
      if (primaryKey.length === 0) return;
      const tuple = primaryKey.map((c) => (row[c] ?? null) as Primitive);
      try {
        const results = await utils.client.data.getCountsForRows.query({
          connectionId,
          schema,
          table,
          pkTuples: [tuple],
          relationIds: [relationId],
          forceExact: true,
        });
        setCache((prev) => mergeResults(prev, relationId, results));
      } catch {
        /* Best-effort; estimate badge stays. */
      }
    },
    [
      connectionId,
      schema,
      table,
      primaryKey,
      utils.client.data.getCountsForRows,
    ],
  );

  const refresh = useCallback(() => {
    setCache(new Map());
  }, []);

  return { countsFor, escalate, refresh };
}
