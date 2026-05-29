/**
 * The Engine ↔ Target-DB seam.
 *
 * Every database the engine talks to implements this interface. PostgreSQL is
 * the only adapter in v1, but the contract is dialect-neutral: the engine
 * sends structured `QueryPlan` / `MutationPlan` objects, and the adapter is
 * the ONLY code in the system allowed to render those into dialect-specific
 * SQL. Nothing in `@perspectives/engine` or higher constructs SQL strings.
 *
 * Concrete implementations live in dedicated packages —
 * `@perspectives/adapter-postgres` for v1; a hypothetical
 * `@perspectives/adapter-mysql` for phase 8 — and are wired in by the
 * bootstrapping layer (Electron main, server entry, test harness).
 */

import type { ColumnDef, FilterGroup, JoinDef, SortDef } from "@perspectives/dsl";

// ============================================================================
// Schema introspection
// ============================================================================

/** A point-in-time snapshot of the target database's schema. */
export interface SchemaSnapshot {
  /** ISO-8601 timestamp of when this snapshot was fetched. */
  fetchedAt: string;
  schemas: SchemaInfo[];
}

export interface SchemaInfo {
  name: string;
  tables: TableInfo[];
  views?: ViewInfo[];
  functions?: FunctionInfo[];
  comment?: string;
}

export interface TableInfo {
  schema: string;
  name: string;
  kind: "table" | "materialized_view";
  columns: ColumnInfo[];
  primaryKey?: string[];
  foreignKeys: ForeignKeyInfo[];
  indexes: IndexInfo[];
  /** Estimated row count surfaced by the dialect (e.g. `pg_class.reltuples`). */
  estimatedRowCount?: number;
  comment?: string;
}

export interface ViewInfo {
  schema: string;
  name: string;
  columns: ColumnInfo[];
  /** SQL body if the dialect exposes it. */
  definition?: string;
  comment?: string;
}

export interface FunctionInfo {
  schema: string;
  name: string;
  /** Dialect-specific argument signature, surfaced for documentation. */
  signature: string;
  returnType: string;
  comment?: string;
}

/**
 * A column as introspected from the database — distinct from
 * `@perspectives/dsl`'s `ColumnDef`, which describes a column's *projection*
 * inside a perspective.
 */
export interface ColumnInfo {
  name: string;
  /** Dialect-native data type string, e.g. "varchar(255)", "jsonb", "int8". */
  dataType: string;
  /** Coarse JS-side type the engine marshals to/from. */
  jsType: JsTypeHint;
  nullable: boolean;
  /** Default expression as the DB reports it (not yet evaluated). */
  default?: string;
  /** 1-based ordinal position, matching SQL conventions. */
  position: number;
  comment?: string;
}

export interface ForeignKeyInfo {
  /** Constraint name as reported by the DB; may be auto-generated. */
  name: string;
  from: { schema: string; table: string; columns: string[] };
  to: { schema: string; table: string; columns: string[] };
  onUpdate?: ReferentialAction;
  onDelete?: ReferentialAction;
}

export type ReferentialAction =
  | "no action"
  | "restrict"
  | "cascade"
  | "set null"
  | "set default";

export interface IndexInfo {
  name: string;
  schema: string;
  table: string;
  columns: string[];
  unique: boolean;
  /** True if this index backs the table's primary key. */
  isPrimary: boolean;
  /** Dialect-specific index method (e.g. "btree", "gin"). */
  method?: string;
}

/**
 * Coarse JS-side typing hint the engine uses to marshal values between the
 * UI and the database. Not a perfect mapping — JSON, BYTES, and INTERVAL are
 * passed through as wrapped values that the UI knows how to render.
 */
export type JsTypeHint =
  | "string"
  | "number"
  | "bigint"
  | "boolean"
  | "null"
  | "datetime"
  | "date"
  | "time"
  | "interval"
  | "json"
  | "array"
  | "bytes"
  | "uuid"
  | "unknown";

// ============================================================================
// Query plans — the engine's request to the adapter.
// ============================================================================

/**
 * A compiled, dialect-neutral query the adapter renders into SQL. The engine's
 * planner produces these from `PerspectiveDef` values; ad-hoc reads
 * (e.g. "show me this single row") also flow through this shape. Adapters
 * MUST NOT accept SQL strings outside the `kind: "sql"` base variant.
 */
export interface QueryPlan {
  /** Stable per-plan id, useful for tracing and log correlation. */
  planId: string;
  base: QueryBase;
  /** Structured joins resolved against the workspace's `RelationDef`s.
   *  Cardinality (n:1 / 1:1 only) is enforced by the engine before the plan
   *  reaches the adapter. */
  joins: JoinDef[];
  /** Selected columns, in display order. Re-uses `ColumnDef` from the DSL so
   *  presentation hints (format, width) flow through unchanged — the adapter
   *  reads only `source` and `alias` and ignores the rest. */
  columns: ColumnDef[];
  filters?: FilterGroup;
  sort: SortDef[];
  /** Hard upper bound the adapter MUST respect. */
  limit?: number;
  /** Offset-based pagination. Discouraged for large tables — prefer
   *  `paginateKeyset`. */
  offset?: number;
}

export type QueryBase =
  | { kind: "table"; schema: string; table: string }
  | { kind: "sql"; query: string; parameters: SqlParam[] };

/** A bound parameter for a SQL-base perspective. Adapters bind by position
 *  ($1, $2, …) or by name depending on dialect. */
export interface SqlParam {
  /** Optional name. When absent, positional binding is used in the order
   *  parameters appear in this list. */
  name?: string;
  value: unknown;
}

// ============================================================================
// Mutation plans.
// ============================================================================

export type MutationPlan = InsertPlan | UpdatePlan | DeletePlan;

export interface InsertPlan {
  kind: "insert";
  schema: string;
  table: string;
  /** Column → value map. The adapter quotes identifiers and binds values. */
  values: Record<string, unknown>;
  /** Columns to surface in the result (e.g. newly-generated PKs). */
  returning?: string[];
}

export interface UpdatePlan {
  kind: "update";
  schema: string;
  table: string;
  values: Record<string, unknown>;
  where: FilterGroup;
  /** Optimistic-locking guard. The engine fills this with the last-known
   *  values of the row's PK + version/updated_at columns; the adapter MUST
   *  raise `ConflictError` if the mutation's affected-row count is 0. */
  guard?: FilterGroup;
  returning?: string[];
}

export interface DeletePlan {
  kind: "delete";
  schema: string;
  table: string;
  where: FilterGroup;
  /** Same optimistic-locking guard semantics as `UpdatePlan`. */
  guard?: FilterGroup;
}

// ============================================================================
// Results.
// ============================================================================

export interface ResultSet {
  columns: ResultColumn[];
  /** Rows in the order the database returned them. Each row's keys match
   *  `columns[i].name`. */
  rows: ResultRow[];
  /** True if the adapter cut the result short to respect a row cap. */
  truncated: boolean;
}

export interface ResultColumn {
  /** Output name — the column's alias if set, otherwise the source column. */
  name: string;
  dataType: string;
  jsType: JsTypeHint;
  nullable: boolean;
}

export type ResultRow = Record<string, unknown>;

export interface MutationResult {
  /** Number of rows the database reported as affected. */
  affectedRows: number;
  /** Populated when the mutation plan asked for `returning` columns. */
  returnedRows?: ResultRow[];
}

// ============================================================================
// Keyset pagination.
// ============================================================================

/**
 * Opaque cursor encoding the trailing tuple of the previous page. By
 * convention adapters encode `(sort columns…, primary key…)` so pagination
 * remains stable when the sort key isn't unique. Engines treat the contents
 * as opaque — only the adapter that produced a cursor consumes it.
 */
export interface Cursor {
  /** Tuple of values matching the plan's `sort` columns plus a PK tiebreaker. */
  values: Array<string | number | boolean | null>;
  direction: "forward" | "backward";
}

export interface PageResult {
  columns: ResultColumn[];
  rows: ResultRow[];
  /** Cursor for the next page, or undefined if this is the last page. */
  nextCursor?: Cursor;
  /** Cursor for the previous page, or undefined if this is the first. */
  prevCursor?: Cursor;
}

// ============================================================================
// Connection probe + dialect metadata.
// ============================================================================

export interface ConnectionInfo {
  serverName: string;
  serverVersion: string;
  database: string;
  user: string;
  /** Connection / session id reported by the server, if any. */
  connectionId?: string;
  /** Round-trip latency of the probe in milliseconds. */
  latencyMs: number;
}

export type DialectName = "postgres" | "mysql" | "mssql" | "sqlite" | "other";

export interface DialectMetadata {
  name: DialectName;
  /** Negotiated server version. Populated after the first `testConnection()`. */
  version?: string;
  /** Identifier quoting (e.g. `"name"` for Postgres, `` `name` `` for MySQL). */
  quoteIdentifier: (id: string) => string;
  /** Literal quoting for the rare cases an adapter needs to render values
   *  inline (extension parameters, comment strings). Prefer parameter binding. */
  quoteLiteral: (value: string | number | boolean | null) => string;
  supportsReturning: boolean;
  supportsKeysetPagination: boolean;
  supportsSchemas: boolean;
  /** Per-operator capability map. The engine consults this before planning a
   *  filter — operators marked unsupported are surfaced as `ValidationError`s
   *  before any SQL is rendered. */
  filterOps: Record<string, FilterOpCapability>;
}

export interface FilterOpCapability {
  supported: boolean;
  /** Optional note explaining limitations (e.g. "ASCII only", "no index use"). */
  note?: string;
}

// ============================================================================
// The interface itself.
// ============================================================================

/**
 * The contract every database engine implements to be usable by Perspectives.
 * Concrete implementations live in their own packages; the engine receives an
 * adapter from the bootstrapping layer and never imports one directly.
 */
export interface DatabaseAdapter {
  /** Pull a fresh schema snapshot. Adapters may cache; the engine decides when
   *  to invalidate (e.g. on "Refresh schema"). */
  introspect(): Promise<SchemaSnapshot>;

  /** Run a read query. Used for table browsing, SQL perspectives, and any
   *  one-off engine read. */
  runQuery(plan: QueryPlan): Promise<ResultSet>;

  /** Execute a write. Returns the affected row count and (optionally) the
   *  RETURNING rows the plan requested. */
  runMutation(plan: MutationPlan): Promise<MutationResult>;

  /** Exact `COUNT(*)` for the plan. Slow on large tables — prefer
   *  `estimateCount` and only escalate to `countRows` on explicit user action. */
  countRows(plan: QueryPlan): Promise<number>;

  /** Cheap, possibly-stale row count (e.g. `pg_class.reltuples`). Surfaced with
   *  a "~" prefix in the UI. */
  estimateCount(plan: QueryPlan): Promise<number>;

  /** Pull one page of rows via keyset pagination. The first call passes no
   *  cursor; each subsequent call passes the cursor from the previous result. */
  paginateKeyset(plan: QueryPlan, cursor?: Cursor): Promise<PageResult>;

  /** Probe the connection and return identifying information. */
  testConnection(): Promise<ConnectionInfo>;

  /** Dialect-level capabilities. Synchronous — populated at adapter
   *  construction, then refined after the first successful `testConnection()`. */
  readonly dialect: DialectMetadata;
}
