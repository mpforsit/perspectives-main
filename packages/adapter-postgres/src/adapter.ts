import { Pool, type FieldDef, type PoolConfig, type PoolClient } from "pg";

import {
  ValidationError,
  type ConnectionInfo,
  type ConnectionProfile,
  type Cursor,
  type DialectMetadata,
  type FilterOpCapability,
  type JsTypeHint,
  type MutationPlan,
  type MutationResult,
  type PageResult,
  type QueryPlan,
  type ReadOnlySqlOpts,
  type ResultColumn,
  type ResultSet,
  type SchemaSnapshot,
  type SslOptions,
  type TruncationReason,
} from "@perspectives/engine";

import { compileSelectQuery, type KeysetPredicate } from "./compiler";
import { mapPgError } from "./errors";
import { introspect } from "./introspect";
import {
  buildEffectiveSort,
  extractCursorValues,
  PrimaryKeyCache,
} from "./pagination";

interface PostgresAdapterOptions {
  /** How long pg.Pool waits to establish a TCP connection before failing.
   *  Tests override this so connection-refused cases surface quickly. */
  connectionTimeoutMillis?: number;
  /** Override pool size. Defaults to pg's default of 10. */
  max?: number;
}

const DEFAULT_PAGE_SIZE = 100;

/**
 * PostgreSQL implementation of the engine's `DatabaseAdapter`.
 *
 * Owns a single `pg.Pool`. Errors at the pool boundary are wrapped as engine
 * errors via `mapPgError` so callers never see a raw `pg.DatabaseError`.
 */
export class PostgresAdapter {
  private readonly pool: Pool;
  private readonly primaryKeys: PrimaryKeyCache;
  readonly dialect: DialectMetadata;

  constructor(profile: ConnectionProfile, options: PostgresAdapterOptions = {}) {
    const config: PoolConfig = {
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.user,
      password: profile.password,
      application_name: profile.applicationName ?? "perspectives",
      connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000,
    };
    const sslConfig = resolveSslConfig(profile.ssl);
    if (sslConfig !== undefined) config.ssl = sslConfig;
    if (options.max !== undefined) config.max = options.max;

    this.pool = new Pool(config);
    this.pool.on("error", () => {
      /* idle-disconnect noise; real failures surface on the next query */
    });
    this.primaryKeys = new PrimaryKeyCache(this.pool);
    this.dialect = makeDialect();
  }

  // --------------------------------------------------------------------------
  // testConnection
  // --------------------------------------------------------------------------

  async testConnection(): Promise<ConnectionInfo> {
    const start = performance.now();
    let row: TestConnectionRow;
    try {
      const result = await this.pool.query<TestConnectionRow>(
        `SELECT
           current_database()      AS database,
           current_user            AS "user",
           version()               AS version_string,
           pg_backend_pid()::text  AS connection_id`,
      );
      const first = result.rows[0];
      if (first === undefined) {
        throw mapPgError(new Error("Connection probe returned no rows"), "");
      }
      row = first;
    } catch (cause) {
      throw mapPgError(cause, "Unable to connect to PostgreSQL");
    }
    const latencyMs = performance.now() - start;

    const parsed = /^(?<name>\S+)\s+(?<version>[\d.]+)/.exec(row.version_string);
    const serverName = parsed?.groups?.["name"] ?? "PostgreSQL";
    const serverVersion = parsed?.groups?.["version"] ?? row.version_string;
    this.dialect.version = serverVersion;

    return {
      serverName,
      serverVersion,
      database: row.database,
      user: row.user,
      connectionId: row.connection_id,
      latencyMs,
    };
  }

  // --------------------------------------------------------------------------
  // introspect
  // --------------------------------------------------------------------------

  async introspect(): Promise<SchemaSnapshot> {
    try {
      return await introspect(this.pool);
    } catch (cause) {
      throw mapPgError(cause, "Unable to introspect schema");
    }
  }

  // --------------------------------------------------------------------------
  // runQuery
  // --------------------------------------------------------------------------

  async runQuery(plan: QueryPlan): Promise<ResultSet> {
    const params: unknown[] = [];
    const sql = compileSelectQuery(plan, params);
    const result = await this.withReadOnlyClient(
      (client) => client.query(sql, params),
      "Query failed",
    );
    return {
      columns: mapResultColumns(result.fields),
      rows: result.rows as Record<string, unknown>[],
      truncated:
        typeof plan.limit === "number" && result.rowCount === plan.limit,
    };
  }

  // --------------------------------------------------------------------------
  // withReadOnlyClient — every read path on the adapter funnels through this
  // helper so the target DB session is held to BEGIN TRANSACTION READ ONLY
  // for the duration of the call. AUDIT-CODEX.md finding #5 + #4:
  //
  //   - Defense in depth against an accidental write reaching `runQuery`
  //     or `paginateKeyset` (e.g. a hypothetical bug in the compiler).
  //   - Symmetric session-GUC behaviour: anything `SET LOCAL` does inside
  //     the txn rolls off on ROLLBACK.
  //
  // The cost is one extra BEGIN/ROLLBACK round trip per call. Acceptable
  // for a desktop client; revisit if the engine ever batches reads.
  // --------------------------------------------------------------------------
  private async withReadOnlyClient<T>(
    body: (client: PoolClient) => Promise<T>,
    fallbackMessage: string,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      let result: T;
      try {
        result = await body(client);
      } catch (cause) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* swallow — original error is what matters */
        }
        throw mapPgError(cause, fallbackMessage);
      }
      await client.query("ROLLBACK");
      return result;
    } finally {
      client.release();
    }
  }

  // --------------------------------------------------------------------------
  // runReadOnlySql
  // --------------------------------------------------------------------------

  /**
   * Execute raw SQL inside a read-only transaction. Acquires a dedicated
   * client so the BEGIN/ROLLBACK pair stays on the same session, applies
   * `statement_timeout` / `idle_in_transaction_session_timeout` so a runaway
   * `pg_sleep(...)` or unbounded scan can't hold a pool slot indefinitely,
   * wires the caller's `AbortSignal` to `pg_cancel_backend(pid)`, and
   * truncates the materialized result to `maxRows` / `maxBytes`. ROLLBACK is
   * unconditional — read-only doesn't need COMMIT and the symmetric
   * ROLLBACK reverts any incidental session GUC changes the user's SQL made.
   *
   * Write statements (INSERT, UPDATE, DELETE, DDL) raise SQLSTATE 25006 and
   * surface via `mapPgError` as a `ValidationError`. Cancellation surfaces
   * the same way (SQLSTATE 57014). See AUDIT-CODEX.md finding #4.
   *
   * **Memory note** (follow-up): rows are buffered in memory by pg before we
   * see them, so the *real* protection against a 10M-row blow-out today is
   * `statement_timeout`. True streaming with backpressure (via `pg-cursor`)
   * is a follow-up; bounded `maxRows` × `statement_timeout` is good enough
   * for the immediate threat model.
   */
  async runReadOnlySql(
    sql: string,
    opts: ReadOnlySqlOpts = {},
  ): Promise<ResultSet> {
    const client = await this.pool.connect();
    let cancelHook: (() => void) | undefined;
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");

      const statementTimeoutMs = sanitizeMs(opts.statementTimeoutMs);
      if (statementTimeoutMs !== null) {
        await client.query(`SET LOCAL statement_timeout = ${statementTimeoutMs}`);
      }
      const idleTimeoutMs = sanitizeMs(opts.idleInTransactionTimeoutMs);
      if (idleTimeoutMs !== null) {
        await client.query(
          `SET LOCAL idle_in_transaction_session_timeout = ${idleTimeoutMs}`,
        );
      }

      cancelHook = await this.installCancelHook(client, opts.signal);

      let result;
      try {
        result = await client.query(sql);
      } catch (cause) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* swallow — the original error is what matters */
        }
        throw mapPgError(cause, "Read-only query failed");
      }

      await client.query("ROLLBACK");

      const allRows = (result.rows ?? []) as Record<string, unknown>[];
      const { rows, truncationReason } = applyResultCaps(allRows, opts);
      return {
        columns: mapResultColumns(result.fields ?? []),
        rows,
        truncated: truncationReason !== undefined,
        ...(truncationReason !== undefined ? { truncationReason } : {}),
      };
    } finally {
      cancelHook?.();
      client.release();
    }
  }

  /**
   * Wire an `AbortSignal` to a backend-side `pg_cancel_backend(pid)` call.
   * Returns a cleanup function the caller invokes once the query is done,
   * whatever the outcome, so we don't leak the abort listener.
   *
   * `pg_cancel_backend` is the documented way to interrupt an in-flight
   * server query without dropping the TCP connection — preferred over
   * killing the socket because the server cleans up locks and temp work
   * cleanly afterward.
   */
  private async installCancelHook(
    client: PoolClient,
    signal: AbortSignal | undefined,
  ): Promise<(() => void) | undefined> {
    if (signal === undefined) return undefined;
    const pidResult = await client.query<{ pid: number }>(
      "SELECT pg_backend_pid()::int AS pid",
    );
    const pid = pidResult.rows[0]?.pid;
    if (pid === undefined) return undefined;

    const onAbort = () => {
      // Use the pool for the cancel call — we can't issue another query on
      // the held client while it's busy with the user's statement.
      void this.pool
        .query("SELECT pg_cancel_backend($1::int)", [pid])
        .catch(() => {
          /* the user's query may have already finished; nothing to do */
        });
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    return () => signal.removeEventListener("abort", onAbort);
  }

  // --------------------------------------------------------------------------
  // paginateKeyset
  // --------------------------------------------------------------------------

  async paginateKeyset(plan: QueryPlan, cursor?: Cursor): Promise<PageResult> {
    if (plan.base.kind !== "table") {
      throw new ValidationError("paginateKeyset requires a table-base plan");
    }

    const pageSize = typeof plan.limit === "number" ? plan.limit : DEFAULT_PAGE_SIZE;
    const primaryKey = await this.primaryKeys.get(plan.base.schema, plan.base.table);
    const effectiveSort = buildEffectiveSort(plan.sort, primaryKey);

    const params: unknown[] = [];
    const keysetPredicate = cursor !== undefined
      ? ({ sort: effectiveSort, values: cursor.values } satisfies KeysetPredicate)
      : undefined;

    const sql = compileSelectQuery(plan, params, {
      sortOverride: effectiveSort,
      limitOverride: pageSize + 1, // fetch one extra to detect "has more"
      ...(keysetPredicate !== undefined ? { keysetPredicate } : {}),
    });

    const result = await this.withReadOnlyClient(
      (client) => client.query(sql, params),
      "Paginated query failed",
    );

    const rows = result.rows as Record<string, unknown>[];
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const columns = mapResultColumns(result.fields);

    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor: Cursor | undefined =
      hasMore && lastRow !== undefined
        ? {
            values: extractCursorValues(lastRow, effectiveSort),
            direction: "forward",
          }
        : undefined;

    return {
      columns,
      rows: pageRows,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    };
  }

  // --------------------------------------------------------------------------
  // countRows
  // --------------------------------------------------------------------------

  async countRows(plan: QueryPlan): Promise<number> {
    if (plan.base.kind !== "table") {
      throw new ValidationError("countRows requires a table-base plan");
    }
    const params: unknown[] = [];
    // Compile the plan with COUNT(*) replacing the projection and stripping
    // sort/limit/offset, which have no effect on counts.
    const countPlan: QueryPlan = {
      ...plan,
      columns: [{ source: { computed: "1" } }],
      sort: [],
    };
    if ("limit" in countPlan) delete (countPlan as { limit?: number }).limit;
    if ("offset" in countPlan) delete (countPlan as { offset?: number }).offset;

    // Build the inner FROM/WHERE manually using the same compiler so filters
    // bind cleanly, then wrap in `SELECT COUNT(*) FROM (...) sub`.
    const inner = compileSelectQuery(countPlan, params);
    const sql = `SELECT COUNT(*)::text AS count FROM (${inner}) sub`;

    const result = await this.withReadOnlyClient(
      (client) => client.query<{ count: string }>(sql, params),
      "countRows failed",
    );
    const first = result.rows[0];
    return first ? Number(first.count) : 0;
  }

  // --------------------------------------------------------------------------
  // estimateCount
  // --------------------------------------------------------------------------

  async estimateCount(plan: QueryPlan): Promise<number> {
    if (plan.base.kind !== "table") {
      throw new ValidationError("estimateCount requires a table-base plan");
    }

    // Fast path: unfiltered, fall back to pg_class.reltuples.
    const filters = plan.filters;
    const filtersEmpty =
      filters === undefined ||
      (filters.children.length === 0);
    if (filtersEmpty) {
      // Pull schema/table out before the closure so TypeScript keeps the
      // `kind: "table"` narrowing — narrowing on `plan.base` doesn't reach
      // inside the inner arrow.
      const { schema, table } = plan.base;
      const result = await this.withReadOnlyClient(
        (client) =>
          client.query<{ reltuples: string | null }>(
            `SELECT c.reltuples::text AS reltuples
             FROM pg_class c
             JOIN pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = $1 AND c.relname = $2`,
            [schema, table],
          ),
        "estimateCount failed",
      );
      const raw = result.rows[0]?.reltuples;
      if (raw === null || raw === undefined) return 0;
      const n = Number(raw);
      return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    }

    // Slow path: ask the planner. `EXPLAIN (FORMAT JSON)` returns one row
    // whose `"QUERY PLAN"` column is a JSON array — pg-node may return it
    // pre-parsed or as a string depending on the version of pg in play.
    const params: unknown[] = [];
    const explainPlan: QueryPlan = {
      ...plan,
      columns: [{ source: { computed: "1" } }],
      sort: [],
    };
    if ("limit" in explainPlan) delete (explainPlan as { limit?: number }).limit;
    if ("offset" in explainPlan) delete (explainPlan as { offset?: number }).offset;
    const inner = compileSelectQuery(explainPlan, params);
    const sql = `EXPLAIN (FORMAT JSON) ${inner}`;

    const result = await this.withReadOnlyClient(
      (client) => client.query(sql, params),
      "estimateCount failed",
    );

    const raw = result.rows[0]?.["QUERY PLAN"];
    const planArray = parseExplainJson(raw);
    const planRows = planArray?.[0]?.Plan?.["Plan Rows"];
    return typeof planRows === "number"
      ? Math.max(0, Math.round(planRows))
      : 0;
  }

  // --------------------------------------------------------------------------
  // Not yet implemented (next prompts)
  // --------------------------------------------------------------------------

  runMutation(_plan: MutationPlan): Promise<MutationResult> {
    return Promise.reject(
      new ValidationError("runMutation is not implemented yet"),
    );
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /** Drain the pool. Not on the `DatabaseAdapter` interface — tests only. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ============================================================================
// Helpers
// ============================================================================

interface TestConnectionRow {
  database: string;
  user: string;
  version_string: string;
  connection_id: string;
}

function resolveSslConfig(ssl: SslOptions | undefined): PoolConfig["ssl"] {
  if (!ssl) return undefined;
  switch (ssl.mode) {
    case "disable":
      return false;
    case "prefer":
      return undefined;
    case "require":
      return { rejectUnauthorized: false };
    case "verify-ca":
    case "verify-full":
      return ssl.caCert
        ? { rejectUnauthorized: true, ca: ssl.caCert }
        : { rejectUnauthorized: true };
  }
}

function makeDialect(): DialectMetadata {
  const supportedOps = [
    "eq", "neq",
    "in", "nin",
    "lt", "gt", "lte", "gte",
    "ilike", "like", "not_ilike",
    "is_null", "is_not_null",
    "between",
  ] as const;

  const filterOps: Record<string, FilterOpCapability> = {};
  for (const op of supportedOps) {
    filterOps[op] = { supported: true };
  }
  filterOps["contains"] = {
    supported: true,
    note: "Array / jsonb containment via @>",
  };
  filterOps["contained_by"] = {
    supported: true,
    note: "Array / jsonb containment via <@",
  };

  return {
    name: "postgres",
    quoteIdentifier: (id) => `"${id.replace(/"/g, '""')}"`,
    quoteLiteral,
    supportsReturning: true,
    supportsKeysetPagination: true,
    supportsSchemas: true,
    filterOps,
  };
}

function quoteLiteral(value: string | number | boolean | null): string {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ValidationError(
        "Cannot quote non-finite number as a PostgreSQL literal",
      );
    }
    return value.toString();
  }
  return `'${value.replace(/'/g, "''")}'`;
}

// Minimal pg type OID → engine type mapping for ResultColumn metadata.
// Full coverage isn't worth it here — the UI gets dataType/jsType from the
// schema snapshot, not from runtime query result fields.
function pgOidToTypeName(oid: number): string {
  return PG_OID_TO_TYPE_NAME[oid] ?? "unknown";
}

function pgOidToJsType(oid: number): JsTypeHint {
  return PG_OID_TO_JS_TYPE[oid] ?? "unknown";
}

const PG_OID_TO_TYPE_NAME: Record<number, string> = {
  16: "bool",
  17: "bytea",
  20: "int8",
  21: "int2",
  23: "int4",
  25: "text",
  114: "json",
  142: "xml",
  700: "float4",
  701: "float8",
  1042: "bpchar",
  1043: "varchar",
  1082: "date",
  1083: "time",
  1114: "timestamp",
  1184: "timestamptz",
  1186: "interval",
  1266: "timetz",
  1700: "numeric",
  2950: "uuid",
  3802: "jsonb",
};

const PG_OID_TO_JS_TYPE: Record<number, JsTypeHint> = {
  16: "boolean",
  17: "bytes",
  20: "bigint",
  21: "number",
  23: "number",
  25: "string",
  114: "json",
  700: "number",
  701: "number",
  1042: "string",
  1043: "string",
  1082: "date",
  1083: "time",
  1114: "datetime",
  1184: "datetime",
  1186: "interval",
  1266: "time",
  1700: "number",
  2950: "uuid",
  3802: "json",
};

function mapResultColumns(fields: FieldDef[]): ResultColumn[] {
  return fields.map((field) => ({
    name: field.name,
    dataType: pgOidToTypeName(field.dataTypeID),
    jsType: pgOidToJsType(field.dataTypeID),
    nullable: true,
  }));
}

/**
 * Sanitize a milliseconds option: reject negative / non-finite / fractional
 * values, return `null` when the caller omitted the limit. Returning a
 * cleaned integer here means the SQL we render via interpolation can never
 * carry attacker-influenced characters even though `SET LOCAL <param> = N`
 * does not accept parameter binding.
 */
function sanitizeMs(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  const i = Math.trunc(value);
  if (i <= 0) return null;
  return i;
}

/** Approximate per-row byte size for the byte-cap check. Strings dominate
 *  size in normal usage; this is intentionally cheap rather than exact. */
function estimateRowBytes(row: Record<string, unknown>): number {
  let total = 0;
  for (const value of Object.values(row)) {
    if (typeof value === "string") {
      total += value.length;
    } else if (value === null || value === undefined) {
      total += 4;
    } else if (typeof value === "number" || typeof value === "boolean") {
      total += 8;
    } else if (value instanceof Date) {
      total += 24;
    } else if (typeof value === "bigint") {
      total += 16;
    } else if (Buffer.isBuffer(value)) {
      total += value.byteLength;
    } else {
      // Objects / arrays — fall back to JSON length.
      try {
        total += JSON.stringify(value).length;
      } catch {
        total += 64;
      }
    }
  }
  return total;
}

/**
 * Apply `maxRows` and `maxBytes` post-hoc to a fully-materialized result.
 * The caps fire in order: rows first (cheap), then bytes. Returns a marker
 * the caller surfaces back to the renderer so the UI can show a "results
 * truncated" banner.
 */
function applyResultCaps(
  allRows: Record<string, unknown>[],
  opts: ReadOnlySqlOpts,
): { rows: Record<string, unknown>[]; truncationReason: TruncationReason | undefined } {
  let rows = allRows;
  let truncationReason: TruncationReason | undefined;
  if (
    opts.maxRows !== undefined &&
    opts.maxRows >= 0 &&
    allRows.length > opts.maxRows
  ) {
    rows = allRows.slice(0, opts.maxRows);
    truncationReason = "row-cap";
  }
  if (opts.maxBytes !== undefined && opts.maxBytes >= 0) {
    let bytes = 0;
    let cutAt: number | undefined;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row === undefined) continue;
      bytes += estimateRowBytes(row);
      if (bytes > opts.maxBytes && i > 0) {
        cutAt = i;
        break;
      }
    }
    if (cutAt !== undefined) {
      rows = rows.slice(0, cutAt);
      truncationReason = "byte-cap";
    }
  }
  return { rows, truncationReason };
}

interface ExplainPlanNode {
  Plan?: { "Plan Rows"?: number };
}

function parseExplainJson(raw: unknown): ExplainPlanNode[] | null {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as ExplainPlanNode[]) : null;
    } catch {
      return null;
    }
  }
  return Array.isArray(raw) ? (raw as ExplainPlanNode[]) : null;
}

