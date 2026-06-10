import type Database from "better-sqlite3";

import {
  connectionProfileSchema,
  sslOptionsSchema,
  type SshTunnelOptions,
  type SslOptions,
} from "@perspectives/dsl";
import {
  ValidationError,
  type ConnectionProfile,
  type CRUDStore,
  type ListQuery,
} from "@perspectives/engine";

import type { CredentialStore } from "./credentials";

/**
 * `ConnectionProfile` persistence.
 *
 * The `password` field never reaches SQLite — it goes through the supplied
 * `CredentialStore` instead. Everything else (host/port/database/etc.) lives
 * in the `connections` table. On read, the password is fetched back from the
 * credential store and re-attached to the returned profile; if no credential
 * is stored the password comes back as `""` and the caller is expected to
 * treat that as "needs re-entry" rather than as a literal empty password.
 *
 * The split has been validated by the password-leak guard test
 * (see `test/credentials.test.ts`).
 */

interface ConnectionRow {
  id: string;
  name: string;
  dialect: string;
  host: string;
  port: number;
  database: string;
  user: string;
  application_name: string | null;
  environment: string;
  ssl_json: string | null;
  ssh_tunnel_json: string | null;
  created_at: string;
  updated_at: string;
}

export class ConnectionsStore implements CRUDStore<ConnectionProfile> {
  private readonly insertStmt: Database.Statement<[
    string, string, string, string, number, string, string,
    string | null, string, string | null, string | null, string, string,
  ]>;
  private readonly updateStmt: Database.Statement<[
    string, string, string, number, string, string,
    string | null, string, string | null, string | null, string,
    string,
  ]>;
  private readonly selectByIdStmt: Database.Statement<[string], ConnectionRow>;
  private readonly selectAllStmt: Database.Statement<[], ConnectionRow>;
  private readonly deleteStmt: Database.Statement<[string]>;

  constructor(
    private readonly db: Database.Database,
    private readonly credentials: CredentialStore,
  ) {
    this.insertStmt = this.db.prepare(`
      INSERT INTO connections (
        id, name, dialect, host, port, database, "user",
        application_name, environment, ssl_json, ssh_tunnel_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.updateStmt = this.db.prepare(`
      UPDATE connections SET
        name = ?, dialect = ?, host = ?, port = ?, database = ?, "user" = ?,
        application_name = ?, environment = ?, ssl_json = ?, ssh_tunnel_json = ?,
        updated_at = ?
      WHERE id = ?
    `);
    this.selectByIdStmt = this.db.prepare<[string], ConnectionRow>(
      `SELECT * FROM connections WHERE id = ?`,
    );
    this.selectAllStmt = this.db.prepare<[], ConnectionRow>(
      `SELECT * FROM connections ORDER BY created_at ASC, id ASC`,
    );
    this.deleteStmt = this.db.prepare(`DELETE FROM connections WHERE id = ?`);
  }

  async get(id: string): Promise<ConnectionProfile | null> {
    const row = this.selectByIdStmt.get(id);
    if (row === undefined) return null;
    const password = (await this.credentials.get(id)) ?? "";
    return rowToProfile(row, password);
  }

  async list(_query?: ListQuery): Promise<ConnectionProfile[]> {
    // ListQuery.workspaceId is ignored in single-user / local mode.
    const rows = this.selectAllStmt.all();
    const profiles: ConnectionProfile[] = [];
    for (const row of rows) {
      const password = (await this.credentials.get(row.id)) ?? "";
      profiles.push(rowToProfile(row, password));
    }
    return profiles;
  }

  /**
   * Create order is **credential first, then SQLite row**. If the credential
   * write fails (e.g. `safeStorage.isEncryptionAvailable()` returns false),
   * SQLite is never touched — the user sees the failure but the connection
   * list stays consistent. If the SQLite insert fails after the credential
   * landed, the credential is rolled back to whatever was there before (which
   * is normally `null`, but could be a value from a previous row that
   * happened to share this id and is about to surface a uniqueness error).
   * See AUDIT-CODEX.md finding #7.
   */
  async create(value: ConnectionProfile): Promise<ConnectionProfile> {
    validateProfileShape(value);
    const previousCredential = await this.credentials.get(value.id);
    await this.credentials.set(value.id, value.password);
    try {
      this.insertStmt.run(
        value.id,
        value.name,
        value.dialect,
        value.host,
        value.port,
        value.database,
        value.user,
        value.applicationName ?? null,
        value.environment,
        serializeSsl(value.ssl),
        serializeSshTunnel(value.sshTunnel),
        value.createdAt,
        value.updatedAt,
      );
    } catch (cause) {
      await rollbackCredential(this.credentials, value.id, previousCredential);
      throw cause;
    }
    return value;
  }

  /**
   * Update order: capture the old credential, write the new credential, then
   * the row. If the row write fails, roll the credential back to its previous
   * value (or delete it if there wasn't one). If the row write succeeds but
   * we're then asked to update a row that doesn't exist, do the same rollback.
   */
  async update(id: string, value: ConnectionProfile): Promise<ConnectionProfile> {
    validateProfileShape(value);
    if (value.id !== id) {
      throw new ValidationError(
        `ConnectionProfile.id (${value.id}) does not match the update target id (${id})`,
      );
    }
    // Snapshot the old credential first so we can restore it if the SQLite
    // update fails or matches no rows. `null` here means "no credential was
    // stored" — rolling back means deleting whatever we wrote.
    const previousCredential = await this.credentials.get(id);
    await this.credentials.set(id, value.password);
    let result;
    try {
      result = this.updateStmt.run(
        value.name,
        value.dialect,
        value.host,
        value.port,
        value.database,
        value.user,
        value.applicationName ?? null,
        value.environment,
        serializeSsl(value.ssl),
        serializeSshTunnel(value.sshTunnel),
        value.updatedAt,
        id,
      );
    } catch (cause) {
      await rollbackCredential(this.credentials, id, previousCredential);
      throw cause;
    }
    if (result.changes === 0) {
      await rollbackCredential(this.credentials, id, previousCredential);
      throw new ValidationError(`No connection profile with id ${id}`);
    }
    return value;
  }

  async delete(id: string): Promise<void> {
    this.deleteStmt.run(id);
    await this.credentials.delete(id);
  }
}

async function rollbackCredential(
  store: CredentialStore,
  id: string,
  previous: string | null,
): Promise<void> {
  try {
    if (previous === null) {
      await store.delete(id);
    } else {
      await store.set(id, previous);
    }
  } catch {
    /* intentional — don't mask the original failure */
  }
}

// ============================================================================
// Helpers
// ============================================================================

function validateProfileShape(profile: ConnectionProfile): void {
  // Run the canonical DSL schema as the runtime gate — it already rejects
  // every secret-bearing field (ssl.clientKey, the entire sshTunnel block)
  // and enforces the structural checks the hand-rolled validator did
  // (non-empty id/name/host/db/user, port 1..65535, string password).
  // AUDIT-CODEX.md finding #9: one schema, used at every boundary.
  const parsed = connectionProfileSchema.safeParse(profile);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.join(".") ?? "ConnectionProfile";
    throw new ValidationError(`${path}: ${issue?.message ?? "invalid"}`, {
      cause: parsed.error,
    });
  }
  // `clientKey` is omitted from the canonical schema *type*, but a strict()
  // schema also rejects it at runtime. Belt-and-braces: defense against a
  // future refactor that loosens the schema would still catch the leak
  // here, where the plaintext write would happen.
  if (
    profile.ssl !== undefined &&
    "clientKey" in profile.ssl &&
    (profile.ssl as { clientKey?: unknown }).clientKey !== undefined
  ) {
    throw new ValidationError(
      "ConnectionProfile.ssl.clientKey is a secret and is not yet supported — Phase 4 will route it through CredentialStore",
    );
  }
  if (profile.sshTunnel !== undefined) {
    throw new ValidationError(
      "ConnectionProfile.sshTunnel is not yet supported — Phase 4 will land SSH tunneling with secret routing through CredentialStore",
    );
  }
}

// `sslOptionsSchema` is currently imported but only consulted through
// `connectionProfileSchema` above. Re-export it from the module so callers
// can rebuild a profile piecewise without re-deriving the shape.
export { sslOptionsSchema };

function rowToProfile(row: ConnectionRow, password: string): ConnectionProfile {
  const profile: ConnectionProfile = {
    id: row.id,
    name: row.name,
    dialect: row.dialect as ConnectionProfile["dialect"],
    host: row.host,
    port: row.port,
    database: row.database,
    user: row.user,
    password,
    environment: row.environment as ConnectionProfile["environment"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.application_name !== null) profile.applicationName = row.application_name;
  const ssl = deserializeSsl(row.ssl_json);
  if (ssl !== undefined) profile.ssl = ssl;
  const ssh = deserializeSshTunnel(row.ssh_tunnel_json);
  if (ssh !== undefined) profile.sshTunnel = ssh;
  return profile;
}

function serializeSsl(ssl: SslOptions | undefined): string | null {
  return ssl === undefined ? null : JSON.stringify(ssl);
}

function deserializeSsl(raw: string | null): SslOptions | undefined {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as SslOptions;
  } catch (cause) {
    throw new ValidationError("Corrupted ssl_json column in connections row", { cause });
  }
}

function serializeSshTunnel(
  ssh: SshTunnelOptions | undefined,
): string | null {
  return ssh === undefined ? null : JSON.stringify(ssh);
}

function deserializeSshTunnel(raw: string | null): SshTunnelOptions | undefined {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as SshTunnelOptions;
  } catch (cause) {
    throw new ValidationError(
      "Corrupted ssh_tunnel_json column in connections row",
      { cause },
    );
  }
}
