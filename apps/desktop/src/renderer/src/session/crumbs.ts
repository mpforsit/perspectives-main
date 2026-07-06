/**
 * Pure helpers for the breadcrumb trail.
 *
 * `collapseCrumbs` computes the overflow layout: 4 or fewer hops render
 * inline; 5+ collapse the middle behind a "…" dropdown, showing only
 * the head and the last two.
 *
 * `crumbTargetPk` extracts the target-side PK tuple from a crumb's
 * `FilterGroup` when the filter is an AND of equalities that fully
 * cover the table's primary key. Used by `useCrumbLabels` to feed
 * `data.getRowLabels`.
 *
 * No I/O, no React — safe to unit-test with hand-built fixtures.
 */

import type { FilterGroup } from "@perspectives/engine";

import type { BreadcrumbStep } from "./links";

/** Below this length the trail renders every crumb; at or above, the
 *  middle is collapsed behind a dropdown. 5 was picked because 4 crumbs
 *  ("customers → orders → order 1 → item 3") reads comfortably in a
 *  single line; 5+ tends to wrap on narrower windows. */
export const CRUMB_COLLAPSE_THRESHOLD = 5;

export interface CollapsedCrumbs {
  /** Whether overflow collapse applies. When false, `head` is the first
   *  crumb and `hidden` is empty; the caller renders `[head, ...tail]`
   *  ignoring the middle marker. */
  collapsed: boolean;
  head: BreadcrumbStep & { index: number };
  hidden: Array<BreadcrumbStep & { index: number }>;
  tail: Array<BreadcrumbStep & { index: number }>;
}

/** Split the trail into `[head] [ …dropdown of hidden ] [ last two ]`.
 *  Trails shorter than `CRUMB_COLLAPSE_THRESHOLD` render every crumb
 *  (returned as `head + tail`, `hidden` empty, `collapsed = false`). */
export function collapseCrumbs(
  crumbs: readonly BreadcrumbStep[],
): CollapsedCrumbs {
  if (crumbs.length === 0) {
    // Sentinel — the caller should short-circuit before calling us,
    // but returning a valid shape is friendlier than throwing.
    return {
      collapsed: false,
      head: {
        index: 0,
        schema: "",
        table: "",
        label: "",
        filter: { op: "and", children: [] } as FilterGroup,
      },
      hidden: [],
      tail: [],
    };
  }
  const withIndex = crumbs.map((c, i) => ({ ...c, index: i }));
  const first = withIndex[0]!;
  if (crumbs.length < CRUMB_COLLAPSE_THRESHOLD) {
    return {
      collapsed: false,
      head: first,
      hidden: [],
      tail: withIndex.slice(1),
    };
  }
  return {
    collapsed: true,
    head: first,
    hidden: withIndex.slice(1, -2),
    tail: withIndex.slice(-2),
  };
}

/**
 * Extract the target-side PK tuple from a crumb whose filter is an AND
 * of equality leaves that fully cover the target table's primary key.
 * Returns `null` when the filter shape doesn't match — the caller should
 * fall back to the crumb's persisted label instead of a resolved one.
 *
 * The tuple is returned in the target's PK column order (as reported by
 * the schema snapshot), NOT in filter-child order, because that's what
 * `data.getRowLabels` expects.
 */
export function crumbTargetPk(
  filter: FilterGroup,
  primaryKey: readonly string[],
): Array<string | number | boolean | null> | null {
  if (primaryKey.length === 0) return null;
  if (filter.op !== "and") return null;

  const byCol = new Map<string, string | number | boolean | null>();
  for (const child of filter.children) {
    // Nested groups → give up (crumb filters from `buildLinkFilter` are
    // always flat AND-of-eq; anything else came from somewhere unexpected).
    if ("children" in child) return null;
    if (child.op !== "eq") return null;
    const v = child.value;
    // Filters accept arrays / dynamic values in Zod — reject those here;
    // `getRowLabels` only handles primitive PK tuples.
    if (
      v !== null &&
      typeof v !== "string" &&
      typeof v !== "number" &&
      typeof v !== "boolean"
    ) {
      return null;
    }
    byCol.set(child.column, v);
  }

  const tuple: Array<string | number | boolean | null> = [];
  for (const col of primaryKey) {
    if (!byCol.has(col)) return null;
    tuple.push(byCol.get(col) ?? null);
  }
  return tuple;
}
