import { Pool, type FieldDef, type PoolConfig } from "pg";

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
  type ResultColumn,
  type ResultSet,
  type SchemaSnapshot,
  type SslOptions,
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
    let result;
    try {
      result = await this.pool.query(sql, params);
    } catch (cause) {
      throw mapPgError(cause, "Query failed");
    }
    return {
      columns: mapResultColumns(result.fields),
      rows: result.rows as Record<string, unknown>[],
      truncated:
        typeof plan.limit === "number" && result.rowCount === plan.limit,
    };
  }

  // --------------------------------------------------------------------------
  // runReadOnlySql
  // --------------------------------------------------------------------------

  /**
   * Execute raw SQL inside a read-only transaction. Acquires a dedicated
   * client so the BEGIN/ROLLBACK pair stays on the same session, runs the
   * user's SQL, then unconditionally ROLLBACKs. Any write statement (INSERT,
   * UPDATE, DELETE, DDL) raises SQLSTATE 25006 inside the transaction and we
   * surface it through `mapPgError` as a `ValidationError`.
   *
   * The rollback is wrapped in its own try/catch — once the session is in a
   * failed state, ROLLBACK is required to release it back to the pool, but
   * a second exception there would mask the original error.
   */
  async runReadOnlySql(sql: string): Promise<ResultSet> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      let result;
      try {
        result = await client.query(sql);
      } catch (cause) {
        // Roll back the txn so the connection is reusable, then surface the
        // mapped error to the caller.
        try {
          await client.query("ROLLBACK");
        } catch {
          /* swallow — the original error is what matters */
        }
        throw mapPgError(cause, "Read-only query failed");
      }
      // Read-only by definition — no need to COMMIT; ROLLBACK is symmetric
      // and protects against any accidental side effects from session GUCs.
      await client.query("ROLLBACK");
      return {
        columns: mapResultColumns(result.fields ?? []),
        rows: (result.rows ?? []) as Record<string, unknown>[],
        truncated: false,
      };
    } finally {
      client.release();
    }
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

    let result;
    try {
      result = await this.pool.query(sql, params);
    } catch (cause) {
      throw mapPgError(cause, "Paginated query failed");
    }

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

    let result;
    try {
      result = await this.pool.query<{ count: string }>(sql, params);
    } catch (cause) {
      throw mapPgError(cause, "countRows failed");
    }
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
      try {
        const result = await this.pool.query<{ reltuples: string | null }>(
          `SELECT c.reltuples::text AS reltuples
           FROM pg_class c
           JOIN pg_namespace ns ON ns.oid = c.relnamespace
           WHERE ns.nspname = $1 AND c.relname = $2`,
          [plan.base.schema, plan.base.table],
        );
        const raw = result.rows[0]?.reltuples;
        if (raw === null || raw === undefined) return 0;
        const n = Number(raw);
        return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
      } catch (cause) {
        throw mapPgError(cause, "estimateCount failed");
      }
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

    let result;
    try {
      result = await this.pool.query(sql, params);
    } catch (cause) {
      throw mapPgError(cause, "estimateCount failed");
    }

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

