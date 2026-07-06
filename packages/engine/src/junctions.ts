/**
 * Junction-table detection + m:n RelationDef emission.
 *
 * A "junction" (sometimes "join table") couples two tables in a many-to-many
 * relation through its own table. The canonical example: `customer_tags`
 * with `(customer_id, tag_id)` PK and exactly two outbound FKs.
 *
 * Heuristic (conservative — false positives are worse than false negatives):
 *   - The table has exactly two outbound foreign keys.
 *   - The union of those FK columns is the table's primary key OR a unique
 *     constraint covering exactly those columns.
 *   - No other non-FK / non-audit columns. We allow `created_at` and
 *     `updated_at` as audit columns (these don't disqualify); any other
 *     non-key column (`quantity`, `notes`, `unit_price`, etc.) makes the
 *     table a first-class entity, not a junction.
 *
 * Manual override (Phase 2.3): a per-table policy `auto | always | never`,
 * persisted alongside other database-scoped metadata.
 *   - `auto`   → use the heuristic (the default).
 *   - `always` → force junction treatment even if the heuristic disqualifies.
 *   - `never`  → suppress junction treatment even if the heuristic matches.
 *
 * For each effective junction we emit a single `RelationDef` with
 * `cardinality: "many-to-many"` and the `junction` field populated. Phase 3's
 * structured joins reference relations by id, so m:n MUST exist as a real
 * RelationDef — we never invent a synthetic `junction:<id>` namespace.
 *
 * Convention (matches Phase 2.1's derivation):
 *   - The m:n's `from`/`to` carry the EXTERNAL participants (parent tables),
 *     not the junction itself. The junction's role is captured by the
 *     `junction` field.
 *   - `junction.fromCols` = the junction columns pointing at the m:n's
 *     `from` table; `junction.toCols` = the junction columns pointing at
 *     the m:n's `to` table.
 *   - Component FK order (in `table.foreignKeys`) determines which side is
 *     `from`. FK introspection is deterministic, so the m:n id is stable
 *     across re-introspections.
 *
 * Id format: 26-char Crockford base32 via `deterministicRelationId` (same
 * format as 2.1), so every emitted m:n passes `validateRelation`.
 */

import type { RelationDef } from "@perspectives/dsl";

import type { SchemaSnapshot, TableInfo } from "./adapter";
import { deterministicRelationId } from "./relations";

/** Stable string key for a (schema, table) tuple. Used as Map key. */
export type TableKey = string;

export function tableKey(schema: string, table: string): TableKey {
  return `${schema}.${table}`;
}

export type JunctionPolicy = "auto" | "always" | "never";

export type JunctionPolicyMap = ReadonlyMap<TableKey, JunctionPolicy>;

export interface JunctionInfo {
  /** Where the junction lives (the table itself). */
  junction: { schema: string; table: string };
  /** Component A — the first FK in declaration order. Always a 1:n
   *  RelationDef whose `from` is the junction and whose `to` is the m:n's
   *  `from` side. */
  fromRel: RelationDef;
  /** Component B — the second FK in declaration order. `to` is the m:n's
   *  `to` side. */
  toRel: RelationDef;
  /** The emitted m:n RelationDef. */
  m2n: RelationDef;
  /** Why this junction was emitted: the heuristic matched, the policy was
   *  `always`, or both. Useful for the policy UI in Phase 2.5. */
  reason: "heuristic" | "policy-always" | "both";
}

/**
 * Audit columns that don't disqualify a table from being a junction. The
 * prompt lists `created_at` / `updated_at` explicitly; we extend the
 * allowlist to `added_at` (the seed's customer_tags timestamp column) and
 * `inserted_at` / `modified_at` (other common naming variants). Anything
 * outside this set — `quantity`, `unit_price`, `notes`, etc. — disqualifies.
 */
const AUDIT_COLUMN_NAMES = new Set([
  "created_at",
  "updated_at",
  "added_at",
  "inserted_at",
  "modified_at",
]);

export interface DetectJunctionsOptions {
  /** Per-(schema,table) overrides. Absent keys default to `auto`. */
  policies?: JunctionPolicyMap;
  /** Already-derived schema relations (from `deriveSchemaRelations`). Passed
   *  in so we don't recompute, and so the m:n's component relations share
   *  ids with the ones in `listRelations`. */
  schemaRelations: readonly RelationDef[];
  /** ISO-8601 timestamp stamped on every emitted m:n RelationDef. */
  now: string;
}

/**
 * Detect all junction tables in `snapshot`. Returns the m:n RelationDef
 * for each effective junction plus references to its two component 1:n
 * relations (so callers can suppress those at the navigation surface).
 *
 * Determinism: same snapshot + same policies + same `now` returns the same
 * output, including the same RelationDef ids.
 */
export function detectJunctions(
  snapshot: SchemaSnapshot,
  options: DetectJunctionsOptions,
): Map<TableKey, JunctionInfo> {
  const out = new Map<TableKey, JunctionInfo>();
  const policies = options.policies ?? new Map<TableKey, JunctionPolicy>();

  // Index schemaRelations by their junction-side table for fast component
  // lookup: for a candidate junction table T, its two FKs derive into
  // RelationDefs whose `from.table === T`.
  const relsByFromTable = new Map<TableKey, RelationDef[]>();
  for (const rel of options.schemaRelations) {
    const k = tableKey(rel.from.schema, rel.from.table);
    const list = relsByFromTable.get(k);
    if (list === undefined) relsByFromTable.set(k, [rel]);
    else list.push(rel);
  }

  for (const schemaInfo of snapshot.schemas) {
    for (const table of schemaInfo.tables) {
      const tk = tableKey(schemaInfo.name, table.name);
      const policy = policies.get(tk) ?? "auto";
      if (policy === "never") continue;

      const heuristic = matchesJunctionHeuristic(table);
      const allowedByPolicy = policy === "always" || heuristic;
      if (!allowedByPolicy) continue;

      // To emit an m:n we still need exactly two FKs — `always` can't
      // synthesise junction behaviour from a table that doesn't have the
      // shape. We log this as a no-op rather than throwing.
      if (table.foreignKeys.length !== 2) continue;

      // Find the two component 1:n relations among the already-derived
      // schemaRelations. They must exist (one per FK in the junction).
      const components = (relsByFromTable.get(tk) ?? []).filter(
        (r) => r.cardinality !== "many-to-many",
      );
      if (components.length !== 2) continue;

      // Sort components by FK declaration order in the snapshot. The
      // schemaRelations list is sorted by id (stable but not declaration
      // order), so we re-align here so the m:n's from/to choice mirrors
      // the FK declaration order.
      const fks = table.foreignKeys;
      const fromCols0 = fks[0]?.from.columns ?? [];
      const componentA = components.find(
        (r) => arraysEqual(r.from.columns, fromCols0),
      );
      const componentB = components.find((r) => r !== componentA);
      if (componentA === undefined || componentB === undefined) continue;

      const m2n = buildManyToManyRelation({
        junctionSchema: schemaInfo.name,
        junctionTable: table.name,
        componentA,
        componentB,
        now: options.now,
      });

      const reason: JunctionInfo["reason"] =
        heuristic && policy === "always"
          ? "both"
          : policy === "always"
            ? "policy-always"
            : "heuristic";

      out.set(tk, {
        junction: { schema: schemaInfo.name, table: table.name },
        fromRel: componentA,
        toRel: componentB,
        m2n,
        reason,
      });
    }
  }

  return out;
}

/**
 * The heuristic check, exposed for tests + the policy UI ("would the
 * default detection treat this table as a junction?"). Doesn't consult
 * policies.
 */
export function matchesJunctionHeuristic(table: TableInfo): boolean {
  if (table.foreignKeys.length !== 2) return false;

  const fkColumns = new Set<string>();
  for (const fk of table.foreignKeys) {
    for (const col of fk.from.columns) fkColumns.add(col);
  }
  if (fkColumns.size === 0) return false;

  const matchesPk =
    table.primaryKey !== undefined &&
    setsEqual(new Set(table.primaryKey), fkColumns);

  const matchesUnique = table.indexes.some(
    (idx) => idx.unique && setsEqual(new Set(idx.columns), fkColumns),
  );

  if (!matchesPk && !matchesUnique) return false;

  for (const col of table.columns) {
    if (fkColumns.has(col.name)) continue;
    if (AUDIT_COLUMN_NAMES.has(col.name)) continue;
    return false; // unexpected non-key, non-audit column — disqualifies
  }
  return true;
}

function buildManyToManyRelation(args: {
  junctionSchema: string;
  junctionTable: string;
  componentA: RelationDef;
  componentB: RelationDef;
  now: string;
}): RelationDef {
  const id = deterministicRelationId(
    [
      "m2n:v1",
      args.junctionSchema,
      args.junctionTable,
      args.componentA.id,
      args.componentB.id,
    ].join("|"),
  );
  return {
    id,
    from: {
      schema: args.componentA.to.schema,
      table: args.componentA.to.table,
      columns: [...args.componentA.to.columns],
    },
    to: {
      schema: args.componentB.to.schema,
      table: args.componentB.to.table,
      columns: [...args.componentB.to.columns],
    },
    junction: {
      schema: args.junctionSchema,
      table: args.junctionTable,
      fromCols: [...args.componentA.from.columns],
      toCols: [...args.componentB.from.columns],
    },
    cardinality: "many-to-many",
    source: "schema",
    displayDirection: "both",
    updatedAt: args.now,
  };
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
