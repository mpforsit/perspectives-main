/**
 * `EngineService` is the orchestration layer between the UI / RPC surface and
 * the engine's pluggable interfaces. It owns:
 *
 *   - the `MetadataStore` (for persisted connections, perspectives, …)
 *   - the `CredentialStore` (for passwords; never persisted to the metadata
 *     store)
 *   - a map of *active* `DatabaseAdapter` instances keyed by connection id
 *   - a per-connection schema cache
 *
 * The service depends only on the engine's own interfaces. The composition
 * layer (`apps/desktop/src/main/index.ts`, or the future server entry point)
 * injects concrete implementations and an `adapterFactory` that turns a
 * `ConnectionProfile` into a live adapter.
 *
 * Renderer/RPC callers reach the database exclusively through this surface.
 * They never see an adapter directly, they never construct SQL, and they
 * never read or write the metadata store outside of these methods.
 */

import { randomUUID } from "node:crypto";

import type { SortDef } from "@perspectives/dsl";

import type {
  ConnectionInfo,
  Cursor,
  DatabaseAdapter,
  DatabaseAdapterFactory,
  PageResult,
  QueryPlan,
  ReadOnlySqlOpts,
  ResultSet,
  SchemaSnapshot,
} from "./adapter";
import type {
  ConnectionProfile,
  ConnectionProfileSummary,
  CredentialStore,
  MetadataStore,
} from "./metadata";
import type { AuditEvent } from "./audit";
import { NotFoundError, ValidationError } from "./errors";

export interface EngineServiceOptions {
  metadataStore: MetadataStore;
  credentialStore: CredentialStore;
  adapterFactory: DatabaseAdapterFactory;
}

export interface GetTablePageArgs {
  connectionId: string;
  schema: string;
  table: string;
  sort: SortDef[];
  cursor?: Cursor;
  pageSize?: number;
}

/**
 * Defaults the engine applies to SQL-console reads when the renderer
 * doesn't pass an explicit budget. Tuned for desktop interactive use:
 *
 *  - 30s statement timeout — long enough for real analytical queries on a
 *    well-indexed table, short enough that the user notices a runaway plan.
 *  - 35s idle-in-transaction timeout — small buffer over the statement
 *    timeout to clean up if the client never picks up the result.
 *  - 10k rows — the grid can render this comfortably; beyond is paging
 *    territory anyway.
 *  - 32 MiB total — caps the actual memory cost of a wide-row result.
 */
export const READ_ONLY_SQL_DEFAULTS = {
  statementTimeoutMs: 30_000,
  idleInTransactionTimeoutMs: 35_000,
  maxRows: 10_000,
  maxBytes: 32 * 1024 * 1024,
} as const;

export interface TableRef {
  connectionId: string;
  schema: string;
  table: string;
}

interface CachedSchema {
  snapshot: SchemaSnapshot;
  cachedAt: string;
}

export class EngineService {
  private readonly metadataStore: MetadataStore;
  /** The engine is the authoritative owner of credential lifecycle. It
   *  doesn't read from the store on `connect` — the metadata store assembles
   *  profiles with the password already attached — but it does delete here on
   *  `deleteConnection` so credentials don't outlive their owning profile,
   *  even when the metadata store doesn't manage them. */
  private readonly credentialStore: CredentialStore;
  private readonly adapterFactory: DatabaseAdapterFactory;

  private readonly activeAdapters = new Map<string, DatabaseAdapter>();
  private readonly schemaCache = new Map<string, CachedSchema>();

  constructor(options: EngineServiceOptions) {
    this.metadataStore = options.metadataStore;
    this.credentialStore = options.credentialStore;
    this.adapterFactory = options.adapterFactory;
  }

  // --------------------------------------------------------------------------
  // Connection lifecycle (CRUD)
  // --------------------------------------------------------------------------

  async listConnections(): Promise<ConnectionProfileSummary[]> {
    const profiles = await this.metadataStore.connections.list();
    return profiles.map(redactPassword);
  }

  async createConnection(profile: ConnectionProfile): Promise<ConnectionProfileSummary> {
    const created = await this.metadataStore.connections.create(profile);
    return redactPassword(created);
  }

  async updateConnection(
    id: string,
    profile: ConnectionProfile,
  ): Promise<ConnectionProfileSummary> {
    // An update may change credentials or the host/port — either invalidates
    // any cached adapter / schema for this connection.
    await this.disconnect(id);
    const updated = await this.metadataStore.connections.update(id, profile);
    return redactPassword(updated);
  }

  async deleteConnection(id: string): Promise<void> {
    await this.disconnect(id);
    await this.metadataStore.connections.delete(id);
    // Belt-and-braces: the metadata store's own credential-store hookup
    // would delete this entry too, but if a different `MetadataStore`
    // implementation didn't, the engine's own store is the safety net.
    // `CredentialStore.delete` is idempotent.
    await this.credentialStore.delete(id);
  }

  // --------------------------------------------------------------------------
  // testConnection — one-shot probe without persisting
  // --------------------------------------------------------------------------

  async testConnection(profile: ConnectionProfile): Promise<ConnectionInfo> {
    const adapter = this.adapterFactory(profile);
    try {
      return await adapter.testConnection();
    } finally {
      await adapter.close();
    }
  }

  // --------------------------------------------------------------------------
  // Active-adapter lifecycle
  // --------------------------------------------------------------------------

  /** Activate a persisted connection. Re-uses an existing adapter if one is
   *  already open for this id; otherwise loads the profile (the metadata
   *  store assembles it with the password from its credential store), runs
   *  it through the factory, probes the adapter, and caches it. */
  async connect(connectionId: string): Promise<ConnectionInfo> {
    const existing = this.activeAdapters.get(connectionId);
    if (existing !== undefined) {
      return existing.testConnection();
    }

    const profile = await this.metadataStore.connections.get(connectionId);
    if (profile === null) {
      throw new NotFoundError(
        `No connection profile with id "${connectionId}"`,
        { resource: "connection", id: connectionId },
      );
    }
    const adapter = this.adapterFactory(profile);

    let info: ConnectionInfo;
    try {
      info = await adapter.testConnection();
    } catch (cause) {
      // The probe failed — release the adapter, propagate.
      await adapter.close();
      throw cause;
    }
    this.activeAdapters.set(connectionId, adapter);
    return info;
  }

  async disconnect(connectionId: string): Promise<void> {
    const adapter = this.activeAdapters.get(connectionId);
    if (adapter === undefined) return;
    this.activeAdapters.delete(connectionId);
    this.schemaCache.delete(connectionId);
    await adapter.close();
  }

  /** Whether a given connection currently has a live adapter. */
  isConnected(connectionId: string): boolean {
    return this.activeAdapters.has(connectionId);
  }

  // --------------------------------------------------------------------------
  // Schema
  // --------------------------------------------------------------------------

  /** Return the cached schema for `connectionId`, fetching it if absent. */
  async getSchema(connectionId: string): Promise<SchemaSnapshot> {
    const cached = this.schemaCache.get(connectionId);
    if (cached !== undefined) return cached.snapshot;
    return this.refreshSchema(connectionId);
  }

  /** Invalidate the schema cache for `connectionId` and re-introspect. */
  async refreshSchema(connectionId: string): Promise<SchemaSnapshot> {
    const adapter = this.requireAdapter(connectionId);
    const snapshot = await adapter.introspect();
    this.schemaCache.set(connectionId, {
      snapshot,
      cachedAt: new Date().toISOString(),
    });
    return snapshot;
  }

  // --------------------------------------------------------------------------
  // Data
  // --------------------------------------------------------------------------

  async getTablePage(args: GetTablePageArgs): Promise<PageResult> {
    const adapter = this.requireAdapter(args.connectionId);
    const snapshot = await this.getSchema(args.connectionId);
    const tableInfo = findTable(snapshot, args.schema, args.table);
    if (tableInfo === undefined) {
      throw new NotFoundError(
        `Table "${args.schema}"."${args.table}" not found in connection "${args.connectionId}"`,
        { resource: "table" },
      );
    }
    const plan: QueryPlan = {
      planId: randomUUID(),
      base: { kind: "table", schema: args.schema, table: args.table },
      joins: [],
      columns: tableInfo.columns.map((col) => ({ source: { column: col.name } })),
      sort: args.sort,
    };
    if (args.pageSize !== undefined) plan.limit = args.pageSize;
    return adapter.paginateKeyset(plan, args.cursor);
  }

  async countTable(args: TableRef): Promise<number> {
    const adapter = this.requireAdapter(args.connectionId);
    return adapter.countRows(simpleTablePlan(args.schema, args.table));
  }

  async estimateTable(args: TableRef): Promise<number> {
    const adapter = this.requireAdapter(args.connectionId);
    return adapter.estimateCount(simpleTablePlan(args.schema, args.table));
  }

  /**
   * Execute raw user SQL inside a read-only transaction. The renderer's SQL
   * console is the only caller — every other read path goes through a typed
   * `QueryPlan`. Read-only is enforced at the database level (see the
   * adapter's `runReadOnlySql`), not by inspecting the SQL.
   *
   * If the caller omits any of the resource-limit fields, the engine fills
   * the SQL-console defaults (see `READ_ONLY_SQL_DEFAULTS`) so the renderer
   * can't accidentally execute an unbounded query just by dropping a field
   * from the input shape. See AUDIT-CODEX.md finding #4.
   */
  async runReadOnlyQuery(
    connectionId: string,
    sql: string,
    opts: ReadOnlySqlOpts = {},
  ): Promise<ResultSet> {
    const adapter = this.requireAdapter(connectionId);
    const effective: ReadOnlySqlOpts = {
      statementTimeoutMs:
        opts.statementTimeoutMs ?? READ_ONLY_SQL_DEFAULTS.statementTimeoutMs,
      idleInTransactionTimeoutMs:
        opts.idleInTransactionTimeoutMs ??
        READ_ONLY_SQL_DEFAULTS.idleInTransactionTimeoutMs,
      maxRows: opts.maxRows ?? READ_ONLY_SQL_DEFAULTS.maxRows,
      maxBytes: opts.maxBytes ?? READ_ONLY_SQL_DEFAULTS.maxBytes,
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    };
    return adapter.runReadOnlySql(sql, effective);
  }

  // --------------------------------------------------------------------------
  // Settings — thin pass-through to the metadata store's KV. Renderer-side
  // session UI persists open-tab state through here; the engine itself never
  // interprets the values.
  // --------------------------------------------------------------------------

  async getSetting<T>(key: string): Promise<T | null> {
    return this.metadataStore.settings.get<T>(key);
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    return this.metadataStore.settings.set<T>(key, value);
  }

  /** Delete a setting key. Idempotent — missing keys are a no-op. Used by
   *  the SQL console's history controls so an opt-out wipes the underlying
   *  row instead of leaving a stale empty payload. */
  async deleteSetting(key: string): Promise<void> {
    return this.metadataStore.settings.delete(key);
  }

  // --------------------------------------------------------------------------
  // Audit log
  //
  // The single funnel for write-path audit events. Mutation routes (Phase 4)
  // and permission-sensitive read paths (Phase 6) both call this — the
  // canonical Zod schema is enforced inside the metadata store's
  // `auditLog.append`, so a malformed event never reaches disk. See
  // AUDIT-CODEX.md long-term #4 + docs/security.md.
  //
  // The mutation path will compose an event in the engine (where it has
  // before/after row snapshots), call `recordAuditEvent`, then return to
  // the caller. Audit failure does NOT roll the mutation back — the audit
  // log is for forensics, not for transactional integrity — but it's
  // surfaced as a `ValidationError` so the caller (and the test suite)
  // notices.
  // --------------------------------------------------------------------------

  async recordAuditEvent(event: AuditEvent): Promise<void> {
    return this.metadataStore.auditLog.append(event);
  }

  /** Read audit events. Phase 6 shared mode will scope these by workspace
   *  in the middleware layer; today the engine just exposes the underlying
   *  AppendStore semantics. */
  async listAuditEvents(query?: { since?: string; until?: string; limit?: number; offset?: number }): Promise<AuditEvent[]> {
    return this.metadataStore.auditLog.list(query);
  }

  // --------------------------------------------------------------------------
  // Shutdown
  // --------------------------------------------------------------------------

  /** Tear down all active adapters. The metadata store is left open — the
   *  composition layer owns its lifecycle (different code path closes it). */
  async close(): Promise<void> {
    const adapters = [...this.activeAdapters.values()];
    this.activeAdapters.clear();
    this.schemaCache.clear();
    await Promise.all(adapters.map((a) => a.close()));
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private requireAdapter(connectionId: string): DatabaseAdapter {
    const adapter = this.activeAdapters.get(connectionId);
    if (adapter === undefined) {
      throw new ValidationError(
        `Connection "${connectionId}" is not active. Call connect() first.`,
      );
    }
    return adapter;
  }
}

function findTable(
  snapshot: SchemaSnapshot,
  schema: string,
  table: string,
): SchemaSnapshot["schemas"][number]["tables"][number] | undefined {
  const s = snapshot.schemas.find((entry) => entry.name === schema);
  if (s === undefined) return undefined;
  return s.tables.find((t) => t.name === table);
}

function simpleTablePlan(schema: string, table: string): QueryPlan {
  return {
    planId: randomUUID(),
    base: { kind: "table", schema, table },
    joins: [],
    columns: [{ source: { computed: "1" } }],
    sort: [],
  };
}

function redactPassword(profile: ConnectionProfile): ConnectionProfileSummary {
  // Destructure to strip the password rather than overwriting with "", so the
  // returned shape *structurally* lacks the field. Renderer callers can never
  // accidentally read `result.password`.
  const { password: _password, ...summary } = profile;
  return summary;
}
