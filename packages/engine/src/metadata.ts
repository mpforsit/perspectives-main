/**
 * The Engine ↔ Metadata-Store seam.
 *
 * The engine persists every product-level concept — perspectives, relations,
 * display configs, connection profiles, settings, the audit log, and in
 * shared mode the workspace / membership / share records — through this
 * interface. Three concrete implementations are planned:
 *
 *   - `@perspectives/metadata-sqlite`    : local SQLite for the desktop app
 *   - `@perspectives/metadata-postgres`  : the self-hostable server
 *   - `@perspectives/metadata-remote`    : HTTP client used by the desktop
 *                                          app when linked to a workspace
 *
 * Switching between them is a config decision; the engine itself doesn't
 * know which one it's wired to.
 */

import type {
  AuditEvent,
  ConnectionProfile,
  ConnectionProfileSummary,
  DisplayConfig,
  PerspectiveDef,
  RelationDef,
  SshTunnelOptions,
  SslOptions,
} from "@perspectives/dsl";

// Re-export the metadata-canonical types so existing
// `@perspectives/engine` consumers keep working without churn. The DSL
// remains the source of truth — these are the Zod-derived `z.infer<...>`
// types, not parallel declarations. See AUDIT-CODEX.md finding #9.
export type {
  AuditEvent,
  ConnectionProfile,
  ConnectionProfileSummary,
  SshTunnelOptions,
  SslOptions,
};

// ============================================================================
// Generic store interfaces.
// ============================================================================

/**
 * Query parameters for list operations. Stores translate them into dialect-
 * appropriate WHERE / LIMIT / OFFSET clauses; for SQLite and HTTP that's the
 * same shape, so we don't generalize further.
 */
export interface ListQuery {
  /** Hard upper bound on results returned in a single call. */
  limit?: number;
  /** Offset-based pagination. Stores may also accept a cursor (see
   *  `AppendStore.list`), but for CRUD lists offset is plenty. */
  offset?: number;
  /** Scope results to a single workspace. Required in shared mode; ignored
   *  in single-user mode. */
  workspaceId?: string;
}

/**
 * Create / read / update / delete by an opaque string id. The semantics of
 * "id" are owned by the store and its `T`:
 *
 *   - For DSL records with an explicit `id: ULID` field (PerspectiveDef,
 *     RelationDef) the store uses that field directly.
 *   - For records keyed by a composite (e.g. `DisplayConfig` is keyed by
 *     `(schema, table)`) the store flattens the composite into a stable
 *     string — typically `"<schema>.<table>"` — and round-trips it as `id`.
 */
export interface CRUDStore<T> {
  /** Returns the record, or `null` if no record has this id. */
  get(id: string): Promise<T | null>;
  list(query?: ListQuery): Promise<T[]>;
  /** Insert a new record. Throws `ConflictError` if a record with the same id
   *  already exists. */
  create(value: T): Promise<T>;
  /** Replace an existing record. Throws `NotFoundError` if the id is unknown
   *  and `ConflictError` if optimistic-locking metadata doesn't match. */
  update(id: string, value: T): Promise<T>;
  /** Idempotent delete — succeeds whether or not the record exists. */
  delete(id: string): Promise<void>;
}

/**
 * Append-only store used for the audit log and (later) the workspace-side
 * history that the sync layer keeps. No update or delete — entries are
 * immutable once written.
 */
export interface AppendStore<T> {
  append(event: T): Promise<void>;
  list(query?: AppendListQuery): Promise<T[]>;
}

/**
 * Scoped store for `DisplayConfig` rows. One config per
 * `(scope, schema, table)`; upsert handles "save or overwrite" so the
 * caller doesn't need to branch on create-vs-update.
 *
 * Scope is the engine's `relationScopeKey(profile)` — same key the custom
 * relations store uses. Two database profiles pointing at the same DB
 * share configs.
 */
export interface DisplayConfigRepository {
  getForTable(
    scope: string,
    schema: string,
    table: string,
  ): Promise<DisplayConfig | null>;
  /** All display configs persisted under `scope`. */
  listForScope(scope: string): Promise<DisplayConfig[]>;
  /** Insert or replace by (scope, schema, table). */
  upsert(scope: string, value: DisplayConfig): Promise<DisplayConfig>;
  /** Idempotent delete. */
  delete(scope: string, schema: string, table: string): Promise<void>;
}

/**
 * Scoped store for custom `RelationDef`s.
 *
 * Relations exist per *database*, not per `ConnectionProfile`. Two profiles
 * pointing at the same Postgres see the same custom relations; renaming a
 * profile doesn't orphan them. The scope is the engine's
 * `relationScopeKey(profile)` — typically `"<dialect>://<host>:<port>/<db>"`
 * — and is opaque to the store.
 *
 * `id` remains the RelationDef's own ULID (globally unique within the
 * store); the scope is an orthogonal index. Update + delete operate by id
 * alone since the id is already unique; create requires a scope.
 */
export interface RelationsRepository {
  get(id: string): Promise<RelationDef | null>;
  /** All custom relations stored under `scope`. */
  listForScope(scope: string): Promise<RelationDef[]>;
  /** Persist a new custom RelationDef in `scope`. */
  create(scope: string, value: RelationDef): Promise<RelationDef>;
  /** Replace an existing RelationDef. The scope is fixed at creation time. */
  update(id: string, value: RelationDef): Promise<RelationDef>;
  /** Idempotent delete by id. */
  delete(id: string): Promise<void>;
}

export interface AppendListQuery extends ListQuery {
  /** ISO-8601 lower bound (inclusive) on `timestamp`. */
  since?: string;
  /** ISO-8601 upper bound (exclusive) on `timestamp`. */
  until?: string;
}

/**
 * Key-value store for product settings — preferences, last-opened
 * connection, feature flags, etc. Values must round-trip through JSON.
 */
export interface KVStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /** List keys with an optional prefix filter. */
  keys(prefix?: string): Promise<string[]>;
}

/**
 * Where connection passwords live. **Never in `MetadataStore`** — that file is
 * a flat JSON-ish database the user can hand off, copy between machines, or
 * lose; passwords have a different lifecycle and a different threat model.
 *
 * Three concrete implementations are expected:
 *   - `InMemoryCredentialStore` (lives in `@perspectives/metadata-sqlite`) —
 *     ephemeral, for tests and the rare "I'll re-enter this every session"
 *     mode.
 *   - The Electron `safeStorage`-backed adapter (lives in `apps/desktop`) —
 *     OS-keychain encrypted at rest. Lands in a later prompt.
 *   - Server-side encrypted KV for shared connections (Phase 6).
 *
 * The interface is deliberately password-only for now; SSH passphrases, SSH
 * private keys, and SSL client keys move through here when Phase 4 lands.
 */
export interface CredentialStore {
  /** Persist the password for a connection. */
  set(connectionId: string, password: string): Promise<void>;
  /** Return the password, or `null` if no credential is stored for this id. */
  get(connectionId: string): Promise<string | null>;
  /** Idempotent — deleting a missing key is a no-op. */
  delete(connectionId: string): Promise<void>;
}

// ============================================================================
// ConnectionProfile
//
// The shape is defined in `@perspectives/dsl` and re-exported above. The
// invariant remains the same:
//
//   **Credentials are local-only.** Any field that could authenticate a
//   session — `password`, `sshTunnel.password`, `sshTunnel.privateKey`,
//   `sshTunnel.passphrase`, `ssl.clientKey` — MUST NOT appear in any
//   payload sent over the network in any mode. The `MetadataStore` surface
//   includes `connections: CRUDStore<ConnectionProfile>` for *local* stores
//   only; the remote store implementation refuses to serialize this type.
//   Phase 6 introduces server-side encrypted shared connections under a
//   separate type — `ConnectionProfile` itself never leaves the device.
// ============================================================================

// ============================================================================
// Workspace / membership / share — shared-mode only.
// ============================================================================

/**
 * A collaboration container. Owns perspectives, relations, display configs,
 * and members. Single-user local stores leave this slot off the
 * `MetadataStore`; the remote store and the Postgres server store implement
 * it.
 */
export interface Workspace {
  /** ULID. */
  id: string;
  name: string;
  /** User id of the original creator. Authorship; not the same as ownership
   *  role (which is per-membership). */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

export interface Membership {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  /** ISO-8601. */
  joinedAt: string;
}

/**
 * A share grant on a perspective (or, in later phases, on a connection or a
 * workspace-shared resource). The exact shape will firm up alongside the
 * Phase 6 permission model — this skeleton is here so the `MetadataStore`
 * interface can already reference it.
 */
export interface Share {
  id: string;
  workspaceId: string;
  /** What is being shared. Initially this is always a perspective. */
  resource: { kind: "perspective"; id: string };
  /** Audience. `workspace` exposes to every member of the workspace. */
  audience: { kind: "workspace" } | { kind: "user"; userId: string };
  /** Permission granted by this share. */
  permission: "view" | "edit";
  createdBy: string;
  createdAt: string;
}

// ============================================================================
// The MetadataStore surface.
// ============================================================================

/**
 * The contract every metadata store implements.
 *
 * Single-user / local mode leaves the workspace-shaped slots
 * (`workspaces`, `members`, `shares`) undefined. Shared-mode stores populate
 * them, and the engine branches on their presence to decide whether to
 * enforce permissions.
 */
export interface MetadataStore {
  perspectives: CRUDStore<PerspectiveDef>;
  relations: RelationsRepository;
  displayConfig: DisplayConfigRepository;
  connections: CRUDStore<ConnectionProfile>;
  auditLog: AppendStore<AuditEvent>;
  settings: KVStore;

  // ---- Shared-mode only --------------------------------------------------
  workspaces?: CRUDStore<Workspace>;
  members?: CRUDStore<Membership>;
  shares?: CRUDStore<Share>;
}
