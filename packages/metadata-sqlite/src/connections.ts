import type Database from "better-sqlite3";

import {
  ValidationError,
  type ConnectionProfile,
  type CRUDStore,
  type ListQuery,
  type SslOptions,
  type SshTunnelOptions,
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

  async create(value: ConnectionProfile): Promise<ConnectionProfile> {
    validateProfileShape(value);
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
    await this.credentials.set(value.id, value.password);
    return value;
  }

  async update(id: string, value: ConnectionProfile): Promise<ConnectionProfile> {
    validateProfileShape(value);
    if (value.id !== id) {
      throw new ValidationError(
        `ConnectionProfile.id (${value.id}) does not match the update target id (${id})`,
      );
    }
    const result = this.updateStmt.run(
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
    if (result.changes === 0) {
      throw new ValidationError(`No connection profile with id ${id}`);
    }
    await this.credentials.set(id, value.password);
    return value;
  }

  async delete(id: string): Promise<void> {
    this.deleteStmt.run(id);
    await this.credentials.delete(id);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function validateProfileShape(profile: ConnectionProfile): void {
  if (!profile.id) throw new ValidationError("ConnectionProfile.id is required");
  if (!profile.name) throw new ValidationError("ConnectionProfile.name is required");
  if (!profile.host) throw new ValidationError("ConnectionProfile.host is required");
  if (!Number.isInteger(profile.port) || profile.port <= 0 || profile.port > 65_535) {
    throw new ValidationError(
      `ConnectionProfile.port must be 1..65535, got ${profile.port}`,
    );
  }
  if (!profile.database) {
    throw new ValidationError("ConnectionProfile.database is required");
  }
  if (!profile.user) throw new ValidationError("ConnectionProfile.user is required");
  if (typeof profile.password !== "string") {
    throw new ValidationError("ConnectionProfile.password must be a string");
  }
}

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
