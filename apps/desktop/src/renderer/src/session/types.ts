/**
 * Tab identity for the session view's main panel.
 *
 * Three kinds today:
 *   - `table` / `view` are dedupable: opening the same (schema, name) twice
 *     focuses the existing tab.
 *   - `sql` consoles are NOT dedupable: a user might want several open with
 *     different drafts in flight, so they carry a stable per-tab `id` and
 *     are equal only by id, never by title.
 */
export type OpenTab =
  | { kind: "table"; schema: string; name: string }
  | { kind: "view"; schema: string; name: string }
  | { kind: "sql"; id: string; title: string };

export function tabKey(tab: OpenTab): string {
  switch (tab.kind) {
    case "table":
    case "view":
      return `${tab.kind}:${tab.schema}.${tab.name}`;
    case "sql":
      return `sql:${tab.id}`;
  }
}

export function findTab(tabs: OpenTab[], target: OpenTab): number {
  const key = tabKey(target);
  return tabs.findIndex((t) => tabKey(t) === key);
}
