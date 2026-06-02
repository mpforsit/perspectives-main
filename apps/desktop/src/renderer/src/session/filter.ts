/**
 * Pure schema-tree filtering.
 *
 * The sidebar's search box passes a string through this function on every
 * keystroke. The result is a `SchemaSnapshot` shaped exactly like the input
 * with non-matching items removed; the sidebar then renders the filtered
 * tree without any further conditional logic.
 *
 * Match rules:
 *   - Case-insensitive substring.
 *   - Whitespace-only or empty queries return the snapshot unchanged.
 *   - If the schema *name* matches, every item under it is kept (so typing a
 *     schema name reveals all of its contents).
 *   - Otherwise, items (tables / views / functions) are filtered individually;
 *     schemas with zero matching items are dropped from the result.
 *
 * Pure: no React, no DOM, no IPC. Tested in isolation in `filter.test.ts`.
 */

import type {
  FunctionInfo,
  SchemaInfo,
  SchemaSnapshot,
  TableInfo,
  ViewInfo,
} from "@perspectives/engine";

export function filterSchema(
  snapshot: SchemaSnapshot,
  query: string,
): SchemaSnapshot {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return snapshot;

  const matches = (s: string): boolean => s.toLowerCase().includes(normalized);

  const filteredSchemas: SchemaInfo[] = [];
  for (const schema of snapshot.schemas) {
    if (matches(schema.name)) {
      filteredSchemas.push(schema);
      continue;
    }

    const tables: TableInfo[] = schema.tables.filter((t) => matches(t.name));
    const views: ViewInfo[] | undefined =
      schema.views !== undefined
        ? schema.views.filter((v) => matches(v.name))
        : undefined;
    const functions: FunctionInfo[] | undefined =
      schema.functions !== undefined
        ? schema.functions.filter((f) => matches(f.name))
        : undefined;

    const total =
      tables.length + (views?.length ?? 0) + (functions?.length ?? 0);
    if (total === 0) continue;

    const next: SchemaInfo = {
      name: schema.name,
      tables,
    };
    if (views !== undefined && views.length > 0) next.views = views;
    if (functions !== undefined && functions.length > 0) next.functions = functions;
    if (schema.comment !== undefined) next.comment = schema.comment;
    filteredSchemas.push(next);
  }

  return { ...snapshot, schemas: filteredSchemas };
}
