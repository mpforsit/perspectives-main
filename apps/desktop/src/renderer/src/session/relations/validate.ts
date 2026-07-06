/**
 * Pure validation for the custom-relation create/edit form.
 *
 * Same checks the engine's `createCustomRelation` enforces server-side,
 * surfaced here so the form can show inline errors and disable Save
 * before round-tripping. The engine is still the authority; this is a
 * UX shortcut, not a security boundary.
 */

import type { RelationDef, SchemaSnapshot, TableInfo } from "@perspectives/engine";

export type Cardinality = "one-to-one" | "one-to-many";
export type DisplayDirection = "forward" | "reverse" | "both";

export interface CustomRelationDraft {
  fromSchema: string;
  fromTable: string;
  fromColumns: readonly string[];
  toSchema: string;
  toTable: string;
  toColumns: readonly string[];
  cardinality: Cardinality;
  labelForward: string;
  labelReverse: string;
  displayDirection: DisplayDirection;
}

export type ValidationIssue =
  | { kind: "no-source-table" }
  | { kind: "no-target-table" }
  | { kind: "source-table-missing"; schema: string; table: string }
  | { kind: "target-table-missing"; schema: string; table: string }
  | { kind: "no-source-columns" }
  | { kind: "no-target-columns" }
  | { kind: "column-count-mismatch"; sourceCount: number; targetCount: number }
  | { kind: "target-not-unique"; columns: readonly string[] }
  | { kind: "source-not-unique-for-1to1"; columns: readonly string[] }
  | {
      kind: "duplicate-of-schema-derived";
      relationId: string;
    };

export function validateCustomRelationDraft(
  draft: CustomRelationDraft,
  snapshot: SchemaSnapshot | undefined,
  existingRelations: readonly RelationDef[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (draft.fromSchema === "" || draft.fromTable === "") {
    issues.push({ kind: "no-source-table" });
  }
  if (draft.toSchema === "" || draft.toTable === "") {
    issues.push({ kind: "no-target-table" });
  }
  if (draft.fromColumns.length === 0) issues.push({ kind: "no-source-columns" });
  if (draft.toColumns.length === 0) issues.push({ kind: "no-target-columns" });

  if (
    draft.fromColumns.length > 0 &&
    draft.toColumns.length > 0 &&
    draft.fromColumns.length !== draft.toColumns.length
  ) {
    issues.push({
      kind: "column-count-mismatch",
      sourceCount: draft.fromColumns.length,
      targetCount: draft.toColumns.length,
    });
  }

  if (snapshot === undefined) return issues;

  const sourceTable = findTable(snapshot, draft.fromSchema, draft.fromTable);
  if (
    draft.fromSchema !== "" &&
    draft.fromTable !== "" &&
    sourceTable === undefined
  ) {
    issues.push({
      kind: "source-table-missing",
      schema: draft.fromSchema,
      table: draft.fromTable,
    });
  }
  const targetTable = findTable(snapshot, draft.toSchema, draft.toTable);
  if (
    draft.toSchema !== "" &&
    draft.toTable !== "" &&
    targetTable === undefined
  ) {
    issues.push({
      kind: "target-table-missing",
      schema: draft.toSchema,
      table: draft.toTable,
    });
  }

  if (targetTable !== undefined && draft.toColumns.length > 0) {
    if (!areColumnsUnique(targetTable, draft.toColumns)) {
      issues.push({ kind: "target-not-unique", columns: draft.toColumns });
    }
  }

  if (
    draft.cardinality === "one-to-one" &&
    sourceTable !== undefined &&
    draft.fromColumns.length > 0
  ) {
    if (!areColumnsUnique(sourceTable, draft.fromColumns)) {
      issues.push({
        kind: "source-not-unique-for-1to1",
        columns: draft.fromColumns,
      });
    }
  }

  // Duplicate-of-schema-derived check. We only compare against
  // schema-derived 1:n / 1:1 relations (not m:n — those have a junction
  // shape that doesn't collide with a custom-relation draft).
  for (const r of existingRelations) {
    if (r.source !== "schema") continue;
    if (r.cardinality === "many-to-many") continue;
    if (
      r.from.schema === draft.fromSchema &&
      r.from.table === draft.fromTable &&
      r.to.schema === draft.toSchema &&
      r.to.table === draft.toTable &&
      arraysShallowEqual(r.from.columns, draft.fromColumns) &&
      arraysShallowEqual(r.to.columns, draft.toColumns)
    ) {
      issues.push({ kind: "duplicate-of-schema-derived", relationId: r.id });
      break;
    }
  }

  return issues;
}

/** Pluck a `TableInfo` by `(schema, table)` from a snapshot. */
export function findTableInSnapshot(
  snapshot: SchemaSnapshot,
  schema: string,
  table: string,
): TableInfo | undefined {
  return findTable(snapshot, schema, table);
}

function findTable(
  snapshot: SchemaSnapshot,
  schema: string,
  table: string,
): TableInfo | undefined {
  const s = snapshot.schemas.find((x) => x.name === schema);
  return s?.tables.find((t) => t.name === table);
}

function areColumnsUnique(
  table: TableInfo,
  columns: readonly string[],
): boolean {
  if (columns.length === 0) return false;
  const target = new Set(columns);
  if (
    table.primaryKey !== undefined &&
    setsEqual(target, new Set(table.primaryKey))
  ) {
    return true;
  }
  for (const idx of table.indexes) {
    if (!idx.unique) continue;
    if (setsEqual(target, new Set(idx.columns))) return true;
  }
  return false;
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function arraysShallowEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Convenience: true when the draft is submittable. Equivalent to
 * `validateCustomRelationDraft(...).length === 0` but reads better at
 * call sites that don't care about the issues.
 */
export function isDraftValid(
  draft: CustomRelationDraft,
  snapshot: SchemaSnapshot | undefined,
  existing: readonly RelationDef[],
): boolean {
  return validateCustomRelationDraft(draft, snapshot, existing).length === 0;
}
