/**
 * Build the `schema` object that `@codemirror/lang-sql` consumes for
 * autocomplete. The format is a flat record keyed by table name (optionally
 * `schema.table`) whose values are the column names.
 *
 * We emit BOTH the bare table name and the schema-qualified form so a query
 * that says `SELECT id FROM customers` completes the same as
 * `SELECT id FROM public.customers`.
 */

import type { SchemaSnapshot } from "@perspectives/engine";

export type SqlSchemaMap = Record<string, string[]>;

export function buildSqlSchemaMap(snapshot: SchemaSnapshot | undefined): SqlSchemaMap {
  if (snapshot === undefined) return {};
  const out: SqlSchemaMap = {};
  for (const schema of snapshot.schemas) {
    for (const table of schema.tables) {
      const cols = table.columns.map((c) => c.name);
      out[`${schema.name}.${table.name}`] = cols;
      // Only expose the bare name when it isn't ambiguous across schemas.
      if (!(table.name in out)) {
        out[table.name] = cols;
      } else {
        // Conflict: more than one schema has this table name. Drop the bare
        // form so the user is forced to disambiguate.
        delete out[table.name];
      }
    }
    if (schema.views !== undefined) {
      for (const view of schema.views) {
        const cols = view.columns.map((c) => c.name);
        out[`${schema.name}.${view.name}`] = cols;
        if (!(view.name in out)) {
          out[view.name] = cols;
        } else {
          delete out[view.name];
        }
      }
    }
  }
  return out;
}
