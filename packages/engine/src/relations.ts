/**
 * Schema-derived relations + deterministic id generation.
 *
 * Pure: in goes a `SchemaSnapshot` (already introspected by the adapter), out
 * comes a list of `RelationDef`s — one per foreign key. No I/O, no DB
 * dependency. Unit-testable with hand-built snapshot fixtures; also exercised
 * end-to-end through the seeded testcontainers integration tests.
 *
 * Conventions
 * ───────────
 * - `from` is the FK-bearing side (the child / many-side); `to` is the
 *   referenced side (the parent / 1-side). This matches the prompt's wording
 *   and means `from.columns` is exactly the FK's own column tuple, in
 *   declared order. Compound FKs preserve order across both sides.
 * - `cardinality` is `one-to-one` when the FK columns on the child side
 *   are themselves unique (PK or UNIQUE constraint covering exactly those
 *   columns); otherwise `one-to-many`. Schema-derived m:n is computed
 *   separately in 2.3 from junction-table detection.
 * - `source: "schema"` for everything this module emits.
 * - `displayDirection: "both"` — the user picks an FK and we let them
 *   navigate in either direction.
 *
 * Id format
 * ─────────
 * The DSL's `RelationDef.id` is the ULID regex `^[0-9A-HJKMNP-TV-Z]{26}$`
 * (Crockford base32, 26 chars = 130 bits). We hash the canonical
 * representation of (fromSchema, fromTable, fromColumns, toSchema, toTable,
 * toColumns) with SHA-256 and encode the top 130 bits as Crockford. The
 * leading byte is masked to satisfy the DSL regex (which accepts every
 * Crockford char in every position, so no extra masking is required —
 * but we still document the bit budget explicitly).
 *
 * Determinism: same FK in the same snapshot, on any machine, in any
 * process, produces the same id. The id survives reconnects, reseed-of-the-
 * same-schema, and Postgres OID churn — because we hash the *names*, not
 * any system-catalog identifier.
 */

import { createHash, randomBytes } from "node:crypto";

import type { RelationDef } from "@perspectives/dsl";

import type { SchemaSnapshot, TableInfo } from "./adapter";

/**
 * Crockford base32 alphabet (RFC-tagged). Note the absent I, L, O, U —
 * matches the DSL's ULID regex `[0-9A-HJKMNP-TV-Z]`.
 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Encode the top 130 bits of `input`'s SHA-256 digest as a 26-char Crockford
 * base32 string. Used for `RelationDef.id` so deterministic ids round-trip
 * through `validateRelation`.
 */
export function deterministicRelationId(input: string): string {
  const hash = createHash("sha256").update(input).digest();
  // We need 130 bits = 16.25 bytes. Take 17 bytes (136 bits) into a BigInt,
  // then shift right by 6 to land at 130 bits.
  let bits = 0n;
  for (let i = 0; i < 17; i++) {
    bits = (bits << 8n) | BigInt(hash[i] ?? 0);
  }
  bits = bits >> 6n;

  // Emit 26 base32 chars, high → low.
  let out = "";
  for (let i = 25; i >= 0; i--) {
    const idx = Number((bits >> BigInt(i * 5)) & 0x1fn);
    out += CROCKFORD[idx];
  }
  return out;
}

/**
 * Canonical input string for a FK's id. The input is JSON-shaped (not
 * literally JSON) so future fields can be added without invalidating
 * existing ids — but column order DOES matter (compound FKs in different
 * orders are different constraints).
 */
function relationIdInput(args: {
  fromSchema: string;
  fromTable: string;
  fromColumns: readonly string[];
  toSchema: string;
  toTable: string;
  toColumns: readonly string[];
}): string {
  return [
    "v1",
    args.fromSchema,
    args.fromTable,
    args.fromColumns.join(","),
    "->",
    args.toSchema,
    args.toTable,
    args.toColumns.join(","),
  ].join("|");
}

export interface DeriveOptions {
  /** ISO-8601 timestamp stamped on every emitted RelationDef. Injected so
   *  tests can pin a fixed timestamp (the DSL doesn't accept Date.now() at
   *  module load). */
  now: string;
}

/**
 * Derive `RelationDef`s from every foreign key in `snapshot`. Pure function:
 * given the same snapshot and `now`, returns the same list in the same order.
 */
export function deriveSchemaRelations(
  snapshot: SchemaSnapshot,
  options: DeriveOptions,
): RelationDef[] {
  const out: RelationDef[] = [];

  for (const schemaInfo of snapshot.schemas) {
    for (const table of schemaInfo.tables) {
      for (const fk of table.foreignKeys) {
        // fk.from = FK-bearing side (this child table); fk.to = referenced
        // side (the parent). The introspector populates fk.from with the
        // child's schema/table, so we can rely on it. Compound FK column
        // order is preserved by the introspector.

        const cardinality = areColumnsUniqueOnTable(table, fk.from.columns)
          ? "one-to-one"
          : "one-to-many";

        const id = deterministicRelationId(
          relationIdInput({
            fromSchema: fk.from.schema,
            fromTable: fk.from.table,
            fromColumns: fk.from.columns,
            toSchema: fk.to.schema,
            toTable: fk.to.table,
            toColumns: fk.to.columns,
          }),
        );

        out.push({
          id,
          from: {
            schema: fk.from.schema,
            table: fk.from.table,
            columns: [...fk.from.columns],
          },
          to: {
            schema: fk.to.schema,
            table: fk.to.table,
            columns: [...fk.to.columns],
          },
          cardinality,
          source: "schema",
          displayDirection: "both",
          updatedAt: options.now,
        });
      }
    }
  }

  // Stable sort by id so output is deterministic regardless of introspector
  // ordering. Callers can re-sort if they need a different view.
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return out;
}


/**
 * Build the canonical scope key for `(host, port, database)`. Used to scope
 * custom RelationDefs in the metadata store so renaming a connection
 * profile doesn't orphan them. Host is lowercased (DNS isn't
 * case-sensitive); dialect prefixes the key so two databases with the same
 * name on different engines don't collide.
 */
export function relationScopeKey(args: {
  dialect: string;
  host: string;
  port: number;
  database: string;
}): string {
  return `${args.dialect.toLowerCase()}://${args.host.toLowerCase()}:${args.port}/${args.database}`;
}

/**
 * Generate a fresh ULID-style 26-char Crockford base32 identifier for a
 * user-created `RelationDef`. Used by `createCustomRelation`; the
 * deterministic variant (`deterministicRelationId`) handles schema-derived
 * ids. Layout: 48 bits of millisecond timestamp + 80 bits of randomness,
 * packed into 130 bits of base32 (the top 2 bits are zero).
 */
export function generateRelationUlid(timestampMs: number = Date.now()): string {
  const time = BigInt(Math.max(0, Math.trunc(timestampMs)));
  // 48 bits of time + 80 bits of randomness = 128 bits total.
  const rand = randomBytes(10);
  let bits = time & ((1n << 48n) - 1n);
  for (const byte of rand) {
    bits = (bits << 8n) | BigInt(byte);
  }
  // We have 128 bits; pad to 130 by treating the leading 2 bits as zero so
  // the result fits exactly 26 Crockford chars (26 * 5 = 130).
  let out = "";
  for (let i = 25; i >= 0; i--) {
    const idx = Number((bits >> BigInt(i * 5)) & 0x1fn);
    out += CROCKFORD[idx];
  }
  return out;
}

/**
 * True if `columns` (in any permutation) are collectively unique on
 * `table` — exposed for the custom-relation validator so the engine's
 * server-side check and the renderer's UX check share semantics.
 */
export function areColumnsUniqueOnTable(
  table: TableInfo,
  columns: readonly string[],
): boolean {
  if (columns.length === 0) return false;
  const target = new Set(columns);
  if (table.primaryKey !== undefined && setsEqual(target, new Set(table.primaryKey))) {
    return true;
  }
  for (const index of table.indexes) {
    if (!index.unique) continue;
    if (setsEqual(target, new Set(index.columns))) return true;
  }
  return false;
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
