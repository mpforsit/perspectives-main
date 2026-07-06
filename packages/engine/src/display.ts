/**
 * Pure helpers for the row-label / DisplayConfig pipeline.
 *
 * `formatRowLabel` turns a row + (optional) DisplayConfig into a
 * human-readable string. `extractTemplateColumns` discovers the column
 * names referenced by a `{column}` template, which the engine uses to
 * decide which projection columns it needs to fetch in `getRowLabels`.
 *
 * No I/O, no DB dependency — unit-testable with hand-built fixtures. The
 * engine wires them through `getRowLabels` + the per-table CRUD methods.
 */

import type { DisplayConfig } from "@perspectives/dsl";

import type { ResultRow } from "./adapter";

/**
 * Pull the bare column names out of a row-label template. The template
 * uses `{column_name}` placeholders; everything else passes through
 * literally. Escaped braces (`{{`, `}}`) are NOT supported — we don't
 * need them today and supporting them invites template-language scope
 * creep.
 *
 * Returns the set of column names referenced; deduplicated; order matches
 * first-appearance in the template.
 */
export function extractTemplateColumns(template: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const pattern = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(template)) !== null) {
    const col = match[1];
    if (col === undefined) continue;
    if (seen.has(col)) continue;
    seen.add(col);
    out.push(col);
  }
  return out;
}

/**
 * Render a row label for `row`.
 *
 *   - If `config?.rowLabelTemplate` is set, substitute every
 *     `{column}` with `row[column]`. Missing / null fields render as an
 *     empty string — `"x: {y}"` against `{y: null}` becomes `"x: "`.
 *   - Else if `config?.displayColumn` is set, the label is the value of
 *     that column (or empty if null / missing).
 *   - Else fall back to the PK values joined with `·` (or `?` if the PK
 *     tuple itself is missing values).
 *
 * The PK fallback is deterministic regardless of column types — bigint
 * strings, numeric strings, plain strings all stringify the same way.
 */
export function formatRowLabel(
  row: ResultRow,
  pkColumns: readonly string[],
  config: DisplayConfig | null,
): string {
  if (config !== null) {
    if (config.rowLabelTemplate !== undefined && config.rowLabelTemplate !== "") {
      return resolveTemplate(config.rowLabelTemplate, row);
    }
    if (config.displayColumn !== undefined && config.displayColumn !== "") {
      return formatScalar(row[config.displayColumn]);
    }
  }
  return formatPkFallback(row, pkColumns);
}

/**
 * Same as `formatRowLabel` but also returns the secondary line, when one
 * is configured. The secondary is always pulled from
 * `config.secondaryColumn` (it doesn't support templates today).
 */
export function formatRowLabelWithSecondary(
  row: ResultRow,
  pkColumns: readonly string[],
  config: DisplayConfig | null,
): { label: string; secondary: string | null } {
  const label = formatRowLabel(row, pkColumns, config);
  const secondary =
    config !== null && config.secondaryColumn !== undefined && config.secondaryColumn !== ""
      ? formatScalar(row[config.secondaryColumn])
      : null;
  return { label, secondary };
}

function resolveTemplate(template: string, row: ResultRow): string {
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, col: string) => {
    const value = row[col];
    if (value === undefined || value === null) return "";
    return formatScalar(value);
  });
}

function formatPkFallback(row: ResultRow, pkColumns: readonly string[]): string {
  if (pkColumns.length === 0) return "?";
  return pkColumns
    .map((col) => {
      const value = row[col];
      if (value === undefined || value === null) return "?";
      return formatScalar(value);
    })
    .join("·");
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  // Fallback for objects/arrays — JSON.stringify with a defensive catch.
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
