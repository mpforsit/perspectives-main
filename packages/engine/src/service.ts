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

import type { DisplayConfig, FilterGroup, FilterLeaf, RelationDef, SortDef } from "@perspectives/dsl";

import type {
  ConnectionInfo,
  Cursor,
  DatabaseAdapter,
  DatabaseAdapterFactory,
  PageResult,
  QueryPlan,
  ReadOnlySqlOpts,
  ResultRow,
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
import {
  extractTemplateColumns,
  formatRowLabel,
} from "./display";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import {
  detectJunctions,
  tableKey,
  type JunctionInfo,
  type JunctionPolicy,
  type JunctionPolicyMap,
  type TableKey,
} from "./junctions";
import {
  areColumnsUniqueOnTable,
  deriveSchemaRelations,
  generateRelationUlid,
  relationScopeKey,
} from "./relations";

/** Counts above this estimate fall back to estimateCount rather than
 *  exact countRows — the inspector surfaces them with a `~` and a
 *  "compute exact" affordance. Threshold lifted from prompt 2.3. */
const REFERENCING_COUNT_THRESHOLD = 100_000;

/** Settings KV key for the per-database junction-policy map. */
function junctionPoliciesSettingsKey(scope: string): string {
  return `junctionPolicies.v1:${scope}`;
}

/** Upper bound on a single `getRowLabels` batch. Tuned to keep the
 *  OR-of-AND-of-eq SQL under ~20 KB at 16-column PKs; FK previews on the
 *  visible page rarely exceed 100 distinct rows. */
const MAX_LABEL_BATCH = 200;

/** Upper bound on `getCountsForRows` per batch. Same rationale as
 *  MAX_LABEL_BATCH — cardinality preview only fetches for the rows
 *  currently visible in the virtualizer (≤100 typical). */
const MAX_COUNT_BATCH = 200;

/** Phase 2.6 ergonomics — the gear dialog caps the user to 1-2 relations
 *  per table so the gutter doesn't get noisy. The engine enforces the same
 *  cap defensively. */
const MAX_PREVIEW_RELATIONS = 2;

/**
 * Deterministic stringification of a PK tuple for in-memory keying. We
 * normalise primitives to their string form so `{id: 1}` (input number)
 * matches `{id: "1"}` (pg int8 default → string). Booleans coerce
 * consistently on both sides too. `null` keeps its identity so a missing
 * value can't collide with the string `"null"`.
 */
function stringifyPkTuple(
  tuple: ReadonlyArray<string | number | boolean | null>,
): string {
  return JSON.stringify(tuple.map((v) => (v === null ? null : String(v))));
}

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
  /** Optional row-set filter. Phase 2's forward-FK navigation populates
   *  this with an AND of equality predicates on the target table's PK. */
  filters?: FilterGroup;
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

export interface FilteredTableRef extends TableRef {
  /** Optional row-set filter — applied to both `countRows` and
   *  `estimateCount` so the count reflects what's actually visible. */
  filters?: FilterGroup;
}

/**
 * Shape for `createCustomRelation` and `updateCustomRelation`. Matches
 * `RelationDef` minus `id` / `updatedAt` / `source` (the engine stamps
 * those) and minus `junction` (Phase 2.4 only supports 1:1 / 1:n).
 */
export interface CustomRelationInput {
  from: { schema: string; table: string; columns: readonly string[] };
  to: { schema: string; table: string; columns: readonly string[] };
  cardinality: "one-to-one" | "one-to-many";
  label?: { forward?: string; reverse?: string };
  displayDirection?: "forward" | "reverse" | "both";
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
  // Junction-policy cache keyed by relationScopeKey. Cleared on
  // setJunctionPolicy so the next read sees fresh state.
  private readonly junctionPoliciesCache = new Map<string, JunctionPolicyMap>();

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
    if (args.filters !== undefined) plan.filters = args.filters;
    return adapter.paginateKeyset(plan, args.cursor);
  }

  async countTable(args: FilteredTableRef): Promise<number> {
    const adapter = this.requireAdapter(args.connectionId);
    const plan = simpleTablePlan(args.schema, args.table);
    if (args.filters !== undefined) plan.filters = args.filters;
    return adapter.countRows(plan);
  }

  async estimateTable(args: FilteredTableRef): Promise<number> {
    const adapter = this.requireAdapter(args.connectionId);
    const plan = simpleTablePlan(args.schema, args.table);
    if (args.filters !== undefined) plan.filters = args.filters;
    return adapter.estimateCount(plan);
  }

  /**
   * Fetch a single row identified by its primary-key tuple. The PK column
   * order in `pkValues` MUST match the order in the schema snapshot's
   * `TableInfo.primaryKey`. Returns `null` when no row matches — the
   * navigation path uses that signal to surface a "row not found" rather
   * than opening an empty filtered tab.
   *
   * Internally this composes a `QueryPlan` with an AND of equality leaves;
   * the adapter's existing `runQuery` path handles compound PKs natively.
   */
  async getRowByKey(
    connectionId: string,
    schema: string,
    table: string,
    pkValues: ReadonlyArray<string | number | boolean | null>,
  ): Promise<ResultRow | null> {
    const adapter = this.requireAdapter(connectionId);
    const snapshot = await this.getSchema(connectionId);
    const tableInfo = findTable(snapshot, schema, table);
    if (tableInfo === undefined) {
      throw new NotFoundError(
        `Table "${schema}"."${table}" not found in connection "${connectionId}"`,
        { resource: "table" },
      );
    }
    const pk = tableInfo.primaryKey;
    if (pk === undefined || pk.length === 0) {
      throw new ValidationError(
        `Table "${schema}"."${table}" has no primary key — getRowByKey requires one`,
      );
    }
    if (pkValues.length !== pk.length) {
      throw new ValidationError(
        `getRowByKey for "${schema}"."${table}" expected ${pk.length} key value${pk.length === 1 ? "" : "s"}, got ${pkValues.length}`,
      );
    }
    const leaves: FilterLeaf[] = pk.map((column, i) => ({
      column,
      op: "eq",
      value: pkValues[i] as FilterLeaf["value"],
    }));
    const filter: FilterGroup = { op: "and", children: leaves };
    const plan: QueryPlan = {
      planId: randomUUID(),
      base: { kind: "table", schema, table },
      joins: [],
      columns: tableInfo.columns.map((col) => ({ source: { column: col.name } })),
      sort: [],
      filters: filter,
      limit: 2, // > 1 so we can detect duplicate-row anomalies; expected = 0 or 1
    };
    const result = await adapter.runQuery(plan);
    if (result.rows.length === 0) return null;
    if (result.rows.length > 1) {
      throw new ValidationError(
        `getRowByKey for "${schema}"."${table}" returned ${result.rows.length} rows — primary-key uniqueness is violated`,
      );
    }
    return result.rows[0] ?? null;
  }

  /**
   * List every `RelationDef` available for a connection: schema-derived
   * (from the introspected foreign keys) merged with custom relations
   * scoped to the connection's `(dialect, host, port, database)`.
   *
   * Custom relations are merged AFTER schema-derived ones; the caller's
   * de-duplication rule (Phase 2.4 rejects exact-duplicate custom
   * relations at write time) keeps the list free of collisions in
   * practice, but if a deterministic id collision did happen the custom
   * row would shadow the schema one in `Map`-style consumers.
   */
  async listRelations(connectionId: string): Promise<RelationDef[]> {
    const profile = await this.requireProfile(connectionId);
    const snapshot = await this.getSchema(connectionId);
    const now = new Date().toISOString();
    const derived = deriveSchemaRelations(snapshot, { now });
    const scope = relationScopeKey({
      dialect: profile.dialect,
      host: profile.host,
      port: profile.port,
      database: profile.database,
    });
    const policies = await this.loadJunctionPolicies(scope);
    const junctions = detectJunctions(snapshot, {
      schemaRelations: derived,
      policies,
      now,
    });
    const m2nRels = [...junctions.values()].map((j) => j.m2n);
    const custom = await this.metadataStore.relations.listForScope(scope);
    return [...derived, ...m2nRels, ...custom];
  }

  /**
   * Surface the detected junction tables for a connection. Used by the
   * per-table junction-policy editor (Phase 2.5) and by the inspector to
   * suppress the m:n's component 1:n relations from "Referenced by".
   */
  async detectJunctions(connectionId: string): Promise<JunctionInfo[]> {
    const profile = await this.requireProfile(connectionId);
    const snapshot = await this.getSchema(connectionId);
    const now = new Date().toISOString();
    const derived = deriveSchemaRelations(snapshot, { now });
    const scope = relationScopeKey({
      dialect: profile.dialect,
      host: profile.host,
      port: profile.port,
      database: profile.database,
    });
    const policies = await this.loadJunctionPolicies(scope);
    const map = detectJunctions(snapshot, {
      schemaRelations: derived,
      policies,
      now,
    });
    return [...map.values()];
  }

  /**
   * Create a user-defined `RelationDef` between two tables that have no FK
   * between them. The shape passes through `validateRelation` on write
   * (via the metadata store) and through these server-side checks:
   *
   *   1. Source + target columns must exist on the snapshot.
   *   2. Source and target column counts must match.
   *   3. Target columns must be collectively unique (PK or unique
   *      constraint) — without that, cardinality on the target side is
   *      ambiguous.
   *   4. For `one-to-one`, source columns must also be collectively unique.
   *   5. No exact duplicate of a schema-derived relation (same
   *      source/target + same column tuples).
   *
   * Returns the persisted `RelationDef` (with a fresh ULID id + an
   * `updatedAt` stamp). Phase 2.4 scope cut: `many-to-many` with a custom
   * junction is rejected here — that case lands alongside Phase 3 joins.
   */
  async createCustomRelation(
    connectionId: string,
    input: CustomRelationInput,
  ): Promise<RelationDef> {
    const profile = await this.requireProfile(connectionId);
    const snapshot = await this.getSchema(connectionId);
    this.validateCustomRelation(snapshot, input);

    // Reject duplicates of schema-derived FKs.
    const derived = deriveSchemaRelations(snapshot, {
      now: new Date().toISOString(),
    });
    for (const d of derived) {
      if (
        d.from.schema === input.from.schema &&
        d.from.table === input.from.table &&
        d.to.schema === input.to.schema &&
        d.to.table === input.to.table &&
        arraysShallowEqual(d.from.columns, input.from.columns) &&
        arraysShallowEqual(d.to.columns, input.to.columns)
      ) {
        throw new ConflictError(
          `A schema-derived relation already covers ${input.from.schema}.${input.from.table} → ${input.to.schema}.${input.to.table}`,
        );
      }
    }

    const scope = relationScopeKey({
      dialect: profile.dialect,
      host: profile.host,
      port: profile.port,
      database: profile.database,
    });
    const now = new Date().toISOString();
    const relation: RelationDef = {
      id: generateRelationUlid(),
      from: {
        schema: input.from.schema,
        table: input.from.table,
        columns: [...input.from.columns],
      },
      to: {
        schema: input.to.schema,
        table: input.to.table,
        columns: [...input.to.columns],
      },
      cardinality: input.cardinality,
      source: "custom",
      displayDirection: input.displayDirection ?? "both",
      ...(input.label !== undefined ? { label: input.label } : {}),
      updatedAt: now,
    };
    return this.metadataStore.relations.create(scope, relation);
  }

  /**
   * Update an existing custom relation in place. The id is fixed; the
   * scope can't move (relations are scoped to the database). Same
   * validation as create, plus a guard that the target id refers to a
   * custom relation (schema-derived ones aren't editable).
   */
  async updateCustomRelation(
    connectionId: string,
    id: string,
    input: CustomRelationInput,
  ): Promise<RelationDef> {
    await this.requireProfile(connectionId);
    const existing = await this.metadataStore.relations.get(id);
    if (existing === null) {
      throw new NotFoundError(`No custom relation with id "${id}"`, {
        resource: "relation",
        id,
      });
    }
    if (existing.source !== "custom") {
      throw new ValidationError(
        `Relation "${id}" is schema-derived and cannot be edited`,
      );
    }
    const snapshot = await this.getSchema(connectionId);
    this.validateCustomRelation(snapshot, input);
    const now = new Date().toISOString();
    const relation: RelationDef = {
      id,
      from: {
        schema: input.from.schema,
        table: input.from.table,
        columns: [...input.from.columns],
      },
      to: {
        schema: input.to.schema,
        table: input.to.table,
        columns: [...input.to.columns],
      },
      cardinality: input.cardinality,
      source: "custom",
      displayDirection: input.displayDirection ?? "both",
      ...(input.label !== undefined ? { label: input.label } : {}),
      updatedAt: now,
    };
    return this.metadataStore.relations.update(id, relation);
  }

  /** Idempotent delete by id; schema-derived relations are refused. */
  async deleteCustomRelation(_connectionId: string, id: string): Promise<void> {
    const existing = await this.metadataStore.relations.get(id);
    if (existing === null) return;
    if (existing.source !== "custom") {
      throw new ValidationError(
        `Relation "${id}" is schema-derived and cannot be deleted`,
      );
    }
    await this.metadataStore.relations.delete(id);
  }

  // --------------------------------------------------------------------------
  // DisplayConfig — Phase 2.5
  // --------------------------------------------------------------------------

  /** Fetch the per-(connection's database, schema, table) display config. */
  async getDisplayConfig(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<DisplayConfig | null> {
    const scope = await this.scopeForConnection(connectionId);
    return this.metadataStore.displayConfig.getForTable(scope, schema, table);
  }

  /** Insert or replace the display config for `(schema, table)`. */
  async upsertDisplayConfig(
    connectionId: string,
    value: DisplayConfig,
  ): Promise<DisplayConfig> {
    const scope = await this.scopeForConnection(connectionId);
    return this.metadataStore.displayConfig.upsert(scope, value);
  }

  /** Idempotent delete. */
  async deleteDisplayConfig(
    connectionId: string,
    schema: string,
    table: string,
  ): Promise<void> {
    const scope = await this.scopeForConnection(connectionId);
    return this.metadataStore.displayConfig.delete(scope, schema, table);
  }

  /**
   * Fetch human-readable row labels for many rows in a single round trip.
   *
   * `pkTuples` is an array of PK tuples in the table's PK column order
   * (`TableInfo.primaryKey`). The result is parallel to the input: index
   * `i` of the return is the label for `pkTuples[i]`. Missing rows get an
   * empty string (the caller decides whether that's "deleted" or "stale
   * cache" — the engine can't tell).
   *
   * Compound-PK decision (per phase-2-prompts-v2.md amendment): we compile
   * the batch as an OR of per-tuple AND-of-eq groups through the existing
   * `FilterGroup` machinery. No adapter change required. SQL grows
   * linearly with batch size; capped at MAX_LABEL_BATCH below.
   */
  async getRowLabels(
    connectionId: string,
    schema: string,
    table: string,
    pkTuples: ReadonlyArray<ReadonlyArray<string | number | boolean | null>>,
  ): Promise<string[]> {
    if (pkTuples.length === 0) return [];
    if (pkTuples.length > MAX_LABEL_BATCH) {
      throw new ValidationError(
        `getRowLabels batch size ${pkTuples.length} exceeds limit ${MAX_LABEL_BATCH}`,
      );
    }
    const adapter = this.requireAdapter(connectionId);
    const snapshot = await this.getSchema(connectionId);
    const tableInfo = findTable(snapshot, schema, table);
    if (tableInfo === undefined) {
      throw new NotFoundError(
        `Table "${schema}"."${table}" not found in connection "${connectionId}"`,
        { resource: "table" },
      );
    }
    const pk = tableInfo.primaryKey;
    if (pk === undefined || pk.length === 0) {
      throw new ValidationError(
        `Table "${schema}"."${table}" has no primary key — getRowLabels requires one`,
      );
    }
    for (const tuple of pkTuples) {
      if (tuple.length !== pk.length) {
        throw new ValidationError(
          `getRowLabels: pkTuple length ${tuple.length} doesn't match PK length ${pk.length} for ${schema}.${table}`,
        );
      }
    }

    const config = await this.getDisplayConfig(connectionId, schema, table);

    // Figure out which columns we need to fetch:
    //   - the PK columns (always; we match results back to pkTuples by PK)
    //   - the displayColumn, secondaryColumn, and template-referenced
    //     columns from the DisplayConfig (when set)
    const projection = new Set<string>(pk);
    if (config !== null) {
      if (config.displayColumn !== undefined && config.displayColumn !== "") {
        projection.add(config.displayColumn);
      }
      if (
        config.secondaryColumn !== undefined &&
        config.secondaryColumn !== ""
      ) {
        projection.add(config.secondaryColumn);
      }
      if (
        config.rowLabelTemplate !== undefined &&
        config.rowLabelTemplate !== ""
      ) {
        for (const col of extractTemplateColumns(config.rowLabelTemplate)) {
          projection.add(col);
        }
      }
    }
    // Drop columns that don't exist on the table (e.g. a stale template
    // references a removed column). The label resolver renders missing
    // values as empty, so omitting them from the projection is safe.
    const validColumns = new Set(tableInfo.columns.map((c) => c.name));
    const projectionList = [...projection].filter((col) =>
      validColumns.has(col),
    );
    if (projectionList.length === 0) {
      // No fetchable columns at all (e.g. table has neither PK nor any
      // referenced display columns). Return PK-string fallback per tuple.
      return pkTuples.map((tuple) => stringifyPkTuple(tuple));
    }

    // Build the OR-of-AND-of-eq filter.
    const orChildren: FilterGroup[] = pkTuples.map((tuple) => ({
      op: "and",
      children: pk.map((col, i) => ({
        column: col,
        op: "eq",
        value: (tuple[i] ?? null) as FilterLeaf["value"],
      })),
    }));
    const filter: FilterGroup = { op: "or", children: orChildren };

    const plan: QueryPlan = {
      planId: randomUUID(),
      base: { kind: "table", schema, table },
      joins: [],
      columns: projectionList.map((name) => ({ source: { column: name } })),
      sort: [],
      filters: filter,
      limit: MAX_LABEL_BATCH,
    };
    const result = await adapter.runQuery(plan);

    // Index returned rows by stringified PK tuple for O(1) lookup.
    const rowsByPk = new Map<string, ResultRow>();
    for (const row of result.rows) {
      const tupleKey = stringifyPkTuple(pk.map((col) => row[col] as string | number | boolean | null));
      rowsByPk.set(tupleKey, row);
    }

    return pkTuples.map((tuple) => {
      const row = rowsByPk.get(stringifyPkTuple(tuple));
      if (row === undefined) return "";
      return formatRowLabel(row, pk, config);
    });
  }

  /**
   * Compute the scope key for a connection. Centralised here so every
   * scoped operation (relations, display configs, junction policies) uses
   * the same derivation.
   */
  private async scopeForConnection(connectionId: string): Promise<string> {
    const profile = await this.requireProfile(connectionId);
    return relationScopeKey({
      dialect: profile.dialect,
      host: profile.host,
      port: profile.port,
      database: profile.database,
    });
  }

  /**
   * Shared validation between create + update. Throws `ValidationError`
   * on any of the listed conditions. Does NOT check schema-derived
   * duplicates — only `createCustomRelation` enforces that, because an
   * update keeps the same id and isn't a duplicate.
   */
  private validateCustomRelation(
    snapshot: SchemaSnapshot,
    input: CustomRelationInput,
  ): void {
    if (input.cardinality !== "one-to-many" && input.cardinality !== "one-to-one") {
      throw new ValidationError(
        `Custom relations support cardinality "one-to-many" or "one-to-one" only — got "${input.cardinality}"`,
      );
    }
    if (
      input.from.columns.length === 0 ||
      input.to.columns.length === 0
    ) {
      throw new ValidationError(
        "Custom relations require at least one column on each side",
      );
    }
    if (input.from.columns.length !== input.to.columns.length) {
      throw new ValidationError(
        `Column count mismatch: ${input.from.columns.length} source vs ${input.to.columns.length} target`,
      );
    }
    const fromTable = findTable(snapshot, input.from.schema, input.from.table);
    if (fromTable === undefined) {
      throw new ValidationError(
        `Source table "${input.from.schema}"."${input.from.table}" not found`,
      );
    }
    const toTable = findTable(snapshot, input.to.schema, input.to.table);
    if (toTable === undefined) {
      throw new ValidationError(
        `Target table "${input.to.schema}"."${input.to.table}" not found`,
      );
    }
    for (const col of input.from.columns) {
      if (!fromTable.columns.some((c) => c.name === col)) {
        throw new ValidationError(
          `Source column "${col}" not found in ${input.from.table}`,
        );
      }
    }
    for (const col of input.to.columns) {
      if (!toTable.columns.some((c) => c.name === col)) {
        throw new ValidationError(
          `Target column "${col}" not found in ${input.to.table}`,
        );
      }
    }
    if (!areColumnsUniqueOnTable(toTable, input.to.columns)) {
      throw new ValidationError(
        `Target columns [${input.to.columns.join(", ")}] are not a unique constraint on ${input.to.schema}.${input.to.table}. A custom relation needs an unambiguous target side.`,
      );
    }
    if (
      input.cardinality === "one-to-one" &&
      !areColumnsUniqueOnTable(fromTable, input.from.columns)
    ) {
      throw new ValidationError(
        `One-to-one requires source columns [${input.from.columns.join(", ")}] to be a unique constraint on ${input.from.schema}.${input.from.table}.`,
      );
    }
  }

  /**
   * Set the manual junction policy for a single (schema, table). `auto`
   * removes any explicit override; `always` and `never` persist. Scope is
   * the same `(dialect, host, port, database)` key used by custom
   * relations.
   */
  async setJunctionPolicy(
    connectionId: string,
    schema: string,
    table: string,
    policy: JunctionPolicy,
  ): Promise<void> {
    const profile = await this.requireProfile(connectionId);
    const scope = relationScopeKey({
      dialect: profile.dialect,
      host: profile.host,
      port: profile.port,
      database: profile.database,
    });
    const settingsKey = junctionPoliciesSettingsKey(scope);
    const current =
      (await this.metadataStore.settings.get<Record<TableKey, JunctionPolicy>>(
        settingsKey,
      )) ?? {};
    const key = tableKey(schema, table);
    if (policy === "auto") {
      delete current[key];
    } else {
      current[key] = policy;
    }
    await this.metadataStore.settings.set(settingsKey, current);
    this.junctionPoliciesCache.delete(scope);
  }

  private async loadJunctionPolicies(scope: string): Promise<JunctionPolicyMap> {
    const cached = this.junctionPoliciesCache.get(scope);
    if (cached !== undefined) return cached;
    const raw =
      (await this.metadataStore.settings.get<Record<TableKey, JunctionPolicy>>(
        junctionPoliciesSettingsKey(scope),
      )) ?? {};
    const map = new Map<TableKey, JunctionPolicy>(Object.entries(raw));
    this.junctionPoliciesCache.set(scope, map);
    return map;
  }

  /**
   * For a focused row in `(schema, table)`, count the rows in every table
   * that references it — both direct 1:n inbound FKs and m:n relations
   * via detected junctions. Returns one entry per relation, keyed by the
   * relation's id (the m:n RelationDef's id for junction-collapsed entries,
   * NOT a synthetic `junction:<id>` namespace).
   *
   * Performance: unfiltered estimateCount(referencingTable) drives the
   * estimate-vs-exact decision. Tables with > 100k estimated rows surface
   * an estimate flagged `estimated: true`; smaller tables get exact counts.
   * The threshold lives in the engine, not the renderer, so adapter
   * implementations can override it later without touching the UI.
   *
   * Junction collapse: when an m:n covers two component 1:n relations, the
   * components are emitted in `listRelations` (Phase 3 joins need to
   * reference them) but suppressed here so the inspector shows "3 tags"
   * (via the m:n) rather than both "3 tags" and "3 customer_tags".
   */
  async getReferencingCounts(
    connectionId: string,
    schema: string,
    table: string,
    rowValues: Readonly<Record<string, string | number | boolean | null>>,
  ): Promise<
    Array<{ relationId: string; count: number; estimated: boolean }>
  > {
    const adapter = this.requireAdapter(connectionId);
    const snapshot = await this.getSchema(connectionId);
    const focusedTable = findTable(snapshot, schema, table);
    if (focusedTable === undefined) {
      throw new NotFoundError(
        `Table "${schema}"."${table}" not found in connection "${connectionId}"`,
        { resource: "table" },
      );
    }

    const relations = await this.listRelations(connectionId);
    const junctionTables = new Set<TableKey>();
    for (const rel of relations) {
      if (rel.cardinality === "many-to-many" && rel.junction !== undefined) {
        junctionTables.add(tableKey(rel.junction.schema, rel.junction.table));
      }
    }

    const results: Array<{
      relationId: string;
      count: number;
      estimated: boolean;
    }> = [];

    for (const rel of relations) {
      if (rel.cardinality === "many-to-many") {
        if (rel.junction === undefined) continue;
        // m:n: focused appears on either side.
        let referencingCols: readonly string[] | null = null;
        let targetCols: readonly string[] | null = null;
        if (rel.from.schema === schema && rel.from.table === table) {
          referencingCols = rel.junction.fromCols;
          targetCols = rel.from.columns;
        } else if (rel.to.schema === schema && rel.to.table === table) {
          referencingCols = rel.junction.toCols;
          targetCols = rel.to.columns;
        }
        if (referencingCols === null || targetCols === null) continue;
        const filter = buildJoinFilterFromRow(referencingCols, targetCols, rowValues);
        if (filter === null) continue;
        const { count, estimated } = await this.countOrEstimate(
          adapter,
          rel.junction.schema,
          rel.junction.table,
          filter,
        );
        results.push({ relationId: rel.id, count, estimated });
        continue;
      }

      // 1:n / 1:1: focused must be on the `to` (parent) side.
      if (rel.to.schema !== schema || rel.to.table !== table) continue;
      // Suppress 1:n relations whose source table is a detected junction —
      // they collapse into the m:n above.
      if (junctionTables.has(tableKey(rel.from.schema, rel.from.table))) continue;
      const filter = buildJoinFilterFromRow(
        rel.from.columns,
        rel.to.columns,
        rowValues,
      );
      if (filter === null) continue;
      const { count, estimated } = await this.countOrEstimate(
        adapter,
        rel.from.schema,
        rel.from.table,
        filter,
      );
      results.push({ relationId: rel.id, count, estimated });
    }

    return results;
  }

  /**
   * Cardinality preview — for every (visible source row, picked relation)
   * pair, return how many "children" the source has under that relation.
   *
   * Eligibility rules (silently skipped, never throw):
   *   - The relation id must resolve via `listRelations`.
   *   - For 1:n / 1:1, the source must be on the `to` (parent) side.
   *   - For m:n via a junction, the source must be either side AND the
   *     side's columns must exactly equal the source's PK in PK order.
   *
   * Performance: per relation, take the target table's unfiltered estimate.
   * Above `REFERENCING_COUNT_THRESHOLD` we drop to per-row `estimateCount`
   * (one fast `EXPLAIN` per row, no grouped COUNT). Below the threshold we
   * issue a single `countByGroup` round trip per relation.
   *
   * The result is one entry per (pkTuple, relationId) pair, including zero
   * counts (rows with no matches still get an entry with `count = 0`).
   * Order is not guaranteed.
   */
  async getCountsForRows(
    connectionId: string,
    schema: string,
    table: string,
    pkTuples: ReadonlyArray<ReadonlyArray<string | number | boolean | null>>,
    relationIds: ReadonlyArray<string>,
    options?: { readonly forceExact?: boolean },
  ): Promise<
    Array<{
      pkTuple: ReadonlyArray<string | number | boolean | null>;
      relationId: string;
      count: number;
      estimated: boolean;
    }>
  > {
    if (pkTuples.length === 0 || relationIds.length === 0) return [];
    if (pkTuples.length > MAX_COUNT_BATCH) {
      throw new ValidationError(
        `getCountsForRows batch size ${pkTuples.length} exceeds limit ${MAX_COUNT_BATCH}`,
      );
    }
    if (relationIds.length > MAX_PREVIEW_RELATIONS) {
      throw new ValidationError(
        `getCountsForRows: at most ${MAX_PREVIEW_RELATIONS} relations per call`,
      );
    }

    const adapter = this.requireAdapter(connectionId);
    const snapshot = await this.getSchema(connectionId);
    const sourceTable = findTable(snapshot, schema, table);
    if (sourceTable === undefined) {
      throw new NotFoundError(
        `Table "${schema}"."${table}" not found in connection "${connectionId}"`,
        { resource: "table" },
      );
    }
    const sourcePk = sourceTable.primaryKey;
    if (sourcePk === undefined || sourcePk.length === 0) {
      throw new ValidationError(
        `Table "${schema}"."${table}" has no primary key — getCountsForRows requires one`,
      );
    }
    for (const t of pkTuples) {
      if (t.length !== sourcePk.length) {
        throw new ValidationError(
          `getCountsForRows: pkTuple length ${t.length} doesn't match source PK length ${sourcePk.length}`,
        );
      }
    }

    const allRelations = await this.listRelations(connectionId);
    const byId = new Map(allRelations.map((r) => [r.id, r] as const));

    const out: Array<{
      pkTuple: ReadonlyArray<string | number | boolean | null>;
      relationId: string;
      count: number;
      estimated: boolean;
    }> = [];

    for (const relId of relationIds) {
      const rel = byId.get(relId);
      if (rel === undefined) continue;

      // Resolve which target the count is over + which columns to group by.
      let targetSchema: string;
      let targetTable: string;
      let groupCols: readonly string[];

      if (rel.cardinality === "many-to-many") {
        if (rel.junction === undefined) continue;
        if (rel.from.schema === schema && rel.from.table === table) {
          if (!arraysShallowEqual(rel.from.columns, sourcePk)) continue;
          targetSchema = rel.junction.schema;
          targetTable = rel.junction.table;
          groupCols = rel.junction.fromCols;
        } else if (rel.to.schema === schema && rel.to.table === table) {
          if (!arraysShallowEqual(rel.to.columns, sourcePk)) continue;
          targetSchema = rel.junction.schema;
          targetTable = rel.junction.table;
          groupCols = rel.junction.toCols;
        } else {
          continue;
        }
      } else {
        // 1:n / 1:1 — source must be the parent side.
        if (rel.to.schema !== schema || rel.to.table !== table) continue;
        if (!arraysShallowEqual(rel.to.columns, sourcePk)) continue;
        targetSchema = rel.from.schema;
        targetTable = rel.from.table;
        groupCols = rel.from.columns;
      }

      const forceExact = options?.forceExact === true;
      const unfilteredEstimate = forceExact
        ? 0
        : await adapter.estimateCount(
            simpleTablePlan(targetSchema, targetTable),
          );

      if (unfilteredEstimate > REFERENCING_COUNT_THRESHOLD) {
        // Per-row estimate path — one EXPLAIN per tuple.
        for (const tuple of pkTuples) {
          const filter: FilterGroup = {
            op: "and",
            children: groupCols.map((col, i) => ({
              column: col,
              op: "eq" as const,
              value: (tuple[i] ?? null) as FilterLeaf["value"],
            })),
          };
          const plan: QueryPlan = {
            ...simpleTablePlan(targetSchema, targetTable),
            filters: filter,
          };
          const est = await adapter.estimateCount(plan);
          out.push({
            pkTuple: [...tuple],
            relationId: relId,
            count: est,
            estimated: true,
          });
        }
      } else {
        // Exact grouped path — one round trip per relation.
        const grouped = await adapter.countByGroup({
          schema: targetSchema,
          table: targetTable,
          groupColumns: groupCols,
          inTuples: pkTuples,
        });
        const byKey = new Map<string, number>();
        for (const r of grouped) {
          byKey.set(stringifyPkTuple(r.key), r.count);
        }
        for (const tuple of pkTuples) {
          const count = byKey.get(stringifyPkTuple(tuple)) ?? 0;
          out.push({
            pkTuple: [...tuple],
            relationId: relId,
            count,
            estimated: false,
          });
        }
      }
    }

    return out;
  }

  private async countOrEstimate(
    adapter: DatabaseAdapter,
    schema: string,
    table: string,
    filter: FilterGroup,
  ): Promise<{ count: number; estimated: boolean }> {
    const unfiltered = simpleTablePlan(schema, table);
    const unfilteredEstimate = await adapter.estimateCount(unfiltered);
    const filteredPlan: QueryPlan = { ...unfiltered, filters: filter };
    if (unfilteredEstimate > REFERENCING_COUNT_THRESHOLD) {
      const estimate = await adapter.estimateCount(filteredPlan);
      return { count: estimate, estimated: true };
    }
    const exact = await adapter.countRows(filteredPlan);
    return { count: exact, estimated: false };
  }

  private async requireProfile(connectionId: string): Promise<ConnectionProfile> {
    const profile = await this.metadataStore.connections.get(connectionId);
    if (profile === null) {
      throw new NotFoundError(
        `No connection profile with id "${connectionId}"`,
        { resource: "connection", id: connectionId },
      );
    }
    return profile;
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

function arraysShallowEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Build an AND-of-equality FilterGroup that filters a referencing table by
 * values pulled from the focused row.
 *
 *   - `referencingCols`: the columns on the referencing (child / junction)
 *     side to filter by.
 *   - `targetCols`: the corresponding columns on the focused side (paired
 *     by position with `referencingCols`).
 *   - `rowValues`: column-name → value map for the focused row. Used to
 *     look up each `targetCols[i]`.
 *
 * Returns `null` when any target column isn't present in `rowValues` —
 * the caller skips that relation. Custom relations can legitimately
 * reference a unique non-PK column (e.g. `orders.shipping_country →
 * countries.code`), so this function does NOT restrict to the PK; it just
 * needs the value for every column the relation references.
 */
function buildJoinFilterFromRow(
  referencingCols: readonly string[],
  targetCols: readonly string[],
  rowValues: Readonly<Record<string, string | number | boolean | null>>,
): FilterGroup | null {
  if (referencingCols.length !== targetCols.length) return null;
  const leaves: FilterLeaf[] = [];
  for (let i = 0; i < referencingCols.length; i++) {
    const refCol = referencingCols[i];
    const targetCol = targetCols[i];
    if (refCol === undefined || targetCol === undefined) return null;
    if (!(targetCol in rowValues)) return null;
    leaves.push({
      column: refCol,
      op: "eq",
      value: rowValues[targetCol] as FilterLeaf["value"],
    });
  }
  return { op: "and", children: leaves };
}

function redactPassword(profile: ConnectionProfile): ConnectionProfileSummary {
  // Destructure to strip the password rather than overwriting with "", so the
  // returned shape *structurally* lacks the field. Renderer callers can never
  // accidentally read `result.password`.
  const { password: _password, ...summary } = profile;
  return summary;
}
