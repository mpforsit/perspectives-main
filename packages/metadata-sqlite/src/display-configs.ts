import type Database from "better-sqlite3";

import { validateDisplayConfig, type DisplayConfig } from "@perspectives/dsl";
import {
  ValidationError,
  type CRUDStore,
  type ListQuery,
} from "@perspectives/engine";

/**
 * Persists `DisplayConfig` rows. `DisplayConfig` is keyed by `(schema, table)`
 * in the DSL — there's no `id` field. We flatten the composite to
 * `"<schema>.<table>"` for the `CRUDStore` interface; the schema and table
 * fields remain authoritative inside the payload.
 */

interface DisplayConfigRow {
  id: string;
  payload: string;
  updated_at: string;
}

export function displayConfigId(config: { schema: string; table: string }): string {
  return `${config.schema}.${config.table}`;
}

export class DisplayConfigsStore implements CRUDStore<DisplayConfig> {
  private readonly insertStmt: Database.Statement<[string, string, string]>;
  private readonly updateStmt: Database.Statement<[string, string, string]>;
  private readonly selectByIdStmt: Database.Statement<[string], DisplayConfigRow>;
  private readonly selectAllStmt: Database.Statement<[], DisplayConfigRow>;
  private readonly deleteStmt: Database.Statement<[string]>;

  constructor(private readonly db: Database.Database) {
    this.insertStmt = this.db.prepare(
      `INSERT INTO display_configs (id, payload, updated_at) VALUES (?, ?, ?)`,
    );
    this.updateStmt = this.db.prepare(
      `UPDATE display_configs SET payload = ?, updated_at = ? WHERE id = ?`,
    );
    this.selectByIdStmt = this.db.prepare<[string], DisplayConfigRow>(
      `SELECT * FROM display_configs WHERE id = ?`,
    );
    this.selectAllStmt = this.db.prepare<[], DisplayConfigRow>(
      `SELECT * FROM display_configs ORDER BY id ASC`,
    );
    this.deleteStmt = this.db.prepare(`DELETE FROM display_configs WHERE id = ?`);
  }

  async get(id: string): Promise<DisplayConfig | null> {
    const row = this.selectByIdStmt.get(id);
    if (row === undefined) return null;
    return parseAndValidate(row);
  }

  async list(_query?: ListQuery): Promise<DisplayConfig[]> {
    return this.selectAllStmt.all().map(parseAndValidate);
  }

  async create(value: DisplayConfig): Promise<DisplayConfig> {
    const result = validateDisplayConfig(value);
    if (!result.ok) {
      throw new ValidationError(
        `DisplayConfig ${displayConfigId(value)} failed validation on write`,
        { issues: result.errors.issues },
      );
    }
    this.insertStmt.run(
      displayConfigId(result.value),
      JSON.stringify(result.value),
      result.value.updatedAt,
    );
    return result.value;
  }

  async update(id: string, value: DisplayConfig): Promise<DisplayConfig> {
    const computedId = displayConfigId(value);
    if (computedId !== id) {
      throw new ValidationError(
        `DisplayConfig (${computedId}) does not match the update target id (${id})`,
      );
    }
    const result = validateDisplayConfig(value);
    if (!result.ok) {
      throw new ValidationError(
        `DisplayConfig ${id} failed validation on update`,
        { issues: result.errors.issues },
      );
    }
    const run = this.updateStmt.run(
      JSON.stringify(result.value),
      result.value.updatedAt,
      id,
    );
    if (run.changes === 0) {
      throw new ValidationError(`No display config with id ${id}`);
    }
    return result.value;
  }

  async delete(id: string): Promise<void> {
    this.deleteStmt.run(id);
  }
}

function parseAndValidate(row: DisplayConfigRow): DisplayConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(row.payload);
  } catch (cause) {
    throw new ValidationError(
      `Stored display config ${row.id} has unparseable JSON payload`,
      { cause },
    );
  }
  const result = validateDisplayConfig(raw);
  if (!result.ok) {
    throw new ValidationError(
      `Stored display config ${row.id} failed schema validation on read`,
      { issues: result.errors.issues },
    );
  }
  return result.value;
}
