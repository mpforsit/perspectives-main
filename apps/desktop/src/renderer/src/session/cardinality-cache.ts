/**
 * Pure cache primitives for `useRowCardinalities`. Kept separate so the
 * cache-hit / cache-miss behaviour can be unit-tested without a React
 * runtime or a tRPC client.
 *
 *   - `tupleKey` — stable stringification of a PK tuple, tolerant to
 *     JS-number-vs-pg-string mismatches (mirrors `useFkLabels`).
 *   - `distinctPkTuples` — extract deduped PK tuples from a row list.
 *   - `missingForRelation` — which tuples still need fetching, given a
 *     cache and a requested tuple set.
 *   - `mergeResults` — fold engine results back into a cache.
 */

import type { DataGridRow } from "../grid/types";

export type Primitive = string | number | boolean | null;

export interface CardinalityEntry {
  count: number;
  estimated: boolean;
}

export type CardinalityCache = Map<string, Map<string, CardinalityEntry>>;

export function tupleKey(tuple: ReadonlyArray<Primitive>): string {
  return JSON.stringify(tuple.map((v) => (v === null ? null : String(v))));
}

export function distinctPkTuples(
  rows: readonly DataGridRow[],
  primaryKey: readonly string[],
): Primitive[][] {
  if (primaryKey.length === 0) return [];
  const seen = new Set<string>();
  const out: Primitive[][] = [];
  for (const row of rows) {
    const tuple = primaryKey.map((c) => (row[c] ?? null) as Primitive);
    const k = tupleKey(tuple);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(tuple);
  }
  return out;
}

export function missingForRelation(
  cache: CardinalityCache,
  relationId: string,
  tuples: ReadonlyArray<ReadonlyArray<Primitive>>,
): Primitive[][] {
  const inner = cache.get(relationId);
  if (inner === undefined) return tuples.map((t) => [...t]);
  const out: Primitive[][] = [];
  for (const t of tuples) {
    if (!inner.has(tupleKey(t))) out.push([...t]);
  }
  return out;
}

export function mergeResults(
  cache: CardinalityCache,
  relationId: string,
  results: ReadonlyArray<{
    pkTuple: ReadonlyArray<Primitive>;
    count: number;
    estimated: boolean;
  }>,
): CardinalityCache {
  const next = new Map(cache);
  const inner = new Map(next.get(relationId) ?? new Map<string, CardinalityEntry>());
  for (const r of results) {
    inner.set(tupleKey(r.pkTuple), { count: r.count, estimated: r.estimated });
  }
  next.set(relationId, inner);
  return next;
}
