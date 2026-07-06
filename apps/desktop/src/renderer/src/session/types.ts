/**
 * Tab identity for the session view's main panel.
 *
 * Four kinds today:
 *   - `table` / `view` are dedupable: opening the same (schema, name) twice
 *     focuses the existing tab.
 *   - `sql` consoles are NOT dedupable: a user might want several open with
 *     different drafts in flight, so they carry a stable per-tab `id` and
 *     are equal only by id, never by title.
 *   - `filteredTable` (Phase 2) is also NOT dedupable: every forward-FK
 *     click opens a fresh tab carrying its own filter + breadcrumb trail,
 *     so two clicks on the same target row from different sources don't
 *     collapse into one tab.
 */

import type { FilterGroup } from "@perspectives/engine";

import type { BreadcrumbStep } from "./links";

export type OpenTab =
  | { kind: "table"; schema: string; name: string }
  | { kind: "view"; schema: string; name: string }
  | { kind: "sql"; id: string; title: string }
  | {
      kind: "filteredTable";
      /** Stable per-tab id so persistence + tab focus work; multiple
       *  filtered tabs on the same target table coexist. */
      id: string;
      schema: string;
      name: string;
      /** Equality predicates on the target table — Phase 2.2 builds these
       *  from the relation the user clicked. */
      filter: FilterGroup;
      /** Navigation trail. Tail is the current step; head is the origin.
       *  Full UI lands in 2.7; for now the renderer shows a simple list. */
      crumbs: BreadcrumbStep[];
    };

export function tabKey(tab: OpenTab): string {
  switch (tab.kind) {
    case "table":
    case "view":
      return `${tab.kind}:${tab.schema}.${tab.name}`;
    case "sql":
      return `sql:${tab.id}`;
    case "filteredTable":
      return `filteredTable:${tab.id}`;
  }
}

export function findTab(tabs: OpenTab[], target: OpenTab): number {
  const key = tabKey(target);
  return tabs.findIndex((t) => tabKey(t) === key);
}
