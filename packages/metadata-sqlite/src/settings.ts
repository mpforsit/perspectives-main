import type Database from "better-sqlite3";

import { ValidationError, type KVStore } from "@perspectives/engine";

/**
 * Settings as a JSON-encoded key/value store. The `T` generic on `get` and
 * `set` is purely a developer-side label — values round-trip through
 * `JSON.parse` / `JSON.stringify`, so callers should restrict themselves to
 * JSON-safe shapes.
 */

interface SettingRow {
  key: string;
  value_json: string;
}

export class SettingsStore implements KVStore {
  private readonly upsertStmt: Database.Statement<[string, string, string]>;
  private readonly selectStmt: Database.Statement<[string], SettingRow>;
  private readonly deleteStmt: Database.Statement<[string]>;
  private readonly listAllStmt: Database.Statement<[], { key: string }>;
  private readonly listPrefixStmt: Database.Statement<[string], { key: string }>;

  constructor(
    private readonly db: Database.Database,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.upsertStmt = this.db.prepare(`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `);
    this.selectStmt = this.db.prepare<[string], SettingRow>(
      `SELECT key, value_json FROM settings WHERE key = ?`,
    );
    this.deleteStmt = this.db.prepare(`DELETE FROM settings WHERE key = ?`);
    this.listAllStmt = this.db.prepare<[], { key: string }>(
      `SELECT key FROM settings ORDER BY key ASC`,
    );
    this.listPrefixStmt = this.db.prepare<[string], { key: string }>(
      `SELECT key FROM settings WHERE key LIKE ? ESCAPE '\\' ORDER BY key ASC`,
    );
  }

  async get<T>(key: string): Promise<T | null> {
    const row = this.selectStmt.get(key);
    if (row === undefined) return null;
    try {
      return JSON.parse(row.value_json) as T;
    } catch (cause) {
      throw new ValidationError(
        `Stored setting "${key}" has unparseable JSON value`,
        { cause },
      );
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.upsertStmt.run(key, JSON.stringify(value), this.now());
    return Promise.resolve();
  }

  async delete(key: string): Promise<void> {
    this.deleteStmt.run(key);
    return Promise.resolve();
  }

  async keys(prefix?: string): Promise<string[]> {
    if (prefix === undefined) {
      return this.listAllStmt.all().map((r) => r.key);
    }
    // Escape SQL LIKE wildcards (% and _) inside the user-supplied prefix so
    // it's treated as a literal string match. Backslash is the escape char,
    // matching the ESCAPE '\\' clause on the prepared statement.
    const escaped = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
    return this.listPrefixStmt.all(`${escaped}%`).map((r) => r.key);
  }
}
