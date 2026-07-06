import type Database from "better-sqlite3";

import { validateDisplayConfig, type DisplayConfig } from "@perspectives/dsl";
import {
  ValidationError,
  type DisplayConfigRepository,
} from "@perspectives/engine";

/**
 * Persists `DisplayConfig` rows scoped by database identity. The composite
 * primary key `(scope, schema_name, table_name)` lets the same DB schema
 * + table carry different display preferences across different databases.
 *
 * Validation runs on both edges — `validateDisplayConfig` on write and on
 * read — so a bit-rotted row surfaces as a typed error instead of a
 * malformed value.
 */

interface DisplayConfigRow {
  payload: string;
}

export class DisplayConfigsStore implements DisplayConfigRepository {
  private readonly insertStmt: Database.Statement<
    [string, string, string, string, string]
  >;
  private readonly upsertStmt: Database.Statement<
    [string, string, string, string, string]
  >;
  private readonly selectByKeyStmt: Database.Statement<
    [string, string, string],
    DisplayConfigRow
  >;
  private readonly selectByScopeStmt: Database.Statement<[string], DisplayConfigRow>;
  private readonly deleteStmt: Database.Statement<[string, string, string]>;

  constructor(private readonly db: Database.Database) {
    this.insertStmt = this.db.prepare(
      `INSERT INTO display_configs
         (scope, schema_name, table_name, payload, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.upsertStmt = this.db.prepare(
      `INSERT INTO display_configs
         (scope, schema_name, table_name, payload, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (scope, schema_name, table_name) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
    );
    this.selectByKeyStmt = this.db.prepare<
      [string, string, string],
      DisplayConfigRow
    >(
      `SELECT payload FROM display_configs
       WHERE scope = ? AND schema_name = ? AND table_name = ?`,
    );
    this.selectByScopeStmt = this.db.prepare<[string], DisplayConfigRow>(
      `SELECT payload FROM display_configs
       WHERE scope = ?
       ORDER BY schema_name ASC, table_name ASC`,
    );
    this.deleteStmt = this.db.prepare(
      `DELETE FROM display_configs
       WHERE scope = ? AND schema_name = ? AND table_name = ?`,
    );
    // Silence the unused-warning on insertStmt — kept for future flows
    // (audit-log-style inserts that should refuse to overwrite).
    void this.insertStmt;
  }

  async getForTable(
    scope: string,
    schema: string,
    table: string,
  ): Promise<DisplayConfig | null> {
    const row = this.selectByKeyStmt.get(scope, schema, table);
    if (row === undefined) return null;
    return parseAndValidate(row);
  }

  async listForScope(scope: string): Promise<DisplayConfig[]> {
    return this.selectByScopeStmt.all(scope).map(parseAndValidate);
  }

  async upsert(scope: string, value: DisplayConfig): Promise<DisplayConfig> {
    const result = validateDisplayConfig(value);
    if (!result.ok) {
      throw new ValidationError(
        `DisplayConfig ${value.schema}.${value.table} failed validation on write`,
        { issues: result.errors.issues },
      );
    }
    this.upsertStmt.run(
      scope,
      result.value.schema,
      result.value.table,
      JSON.stringify(result.value),
      result.value.updatedAt,
    );
    return result.value;
  }

  async delete(scope: string, schema: string, table: string): Promise<void> {
    this.deleteStmt.run(scope, schema, table);
  }
}

function parseAndValidate(row: DisplayConfigRow): DisplayConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(row.payload);
  } catch (cause) {
    throw new ValidationError(
      `Stored display config has unparseable JSON payload`,
      { cause },
    );
  }
  const result = validateDisplayConfig(raw);
  if (!result.ok) {
    throw new ValidationError(
      `Stored display config failed schema validation on read`,
      { issues: result.errors.issues },
    );
  }
  return result.value;
}
