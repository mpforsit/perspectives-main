import type Database from "better-sqlite3";

import { validatePerspective, type PerspectiveDef } from "@perspectives/dsl";
import {
  ValidationError,
  type CRUDStore,
  type ListQuery,
} from "@perspectives/engine";

/**
 * Persists `PerspectiveDef` rows as JSON-encoded text. The DSL validator
 * runs at the boundary in both directions:
 *
 *   - on `create` / `update`: the value is validated first; if invalid, no
 *     SQL runs and the engine sees a `ValidationError` with Zod issues.
 *   - on `get` / `list`: the JSON is re-validated on the way out. A
 *     corrupted row raises `ValidationError` rather than returning a
 *     malformed object — loud failure beats silent loss.
 */

interface PerspectiveRow {
  id: string;
  payload: string;
  updated_at: string;
}

export class PerspectivesStore implements CRUDStore<PerspectiveDef> {
  private readonly insertStmt: Database.Statement<[string, string, string]>;
  private readonly updateStmt: Database.Statement<[string, string, string]>;
  private readonly selectByIdStmt: Database.Statement<[string], PerspectiveRow>;
  private readonly selectAllStmt: Database.Statement<[], PerspectiveRow>;
  private readonly deleteStmt: Database.Statement<[string]>;

  constructor(private readonly db: Database.Database) {
    this.insertStmt = this.db.prepare(
      `INSERT INTO perspectives (id, payload, updated_at) VALUES (?, ?, ?)`,
    );
    this.updateStmt = this.db.prepare(
      `UPDATE perspectives SET payload = ?, updated_at = ? WHERE id = ?`,
    );
    this.selectByIdStmt = this.db.prepare<[string], PerspectiveRow>(
      `SELECT * FROM perspectives WHERE id = ?`,
    );
    this.selectAllStmt = this.db.prepare<[], PerspectiveRow>(
      `SELECT * FROM perspectives ORDER BY updated_at DESC, id ASC`,
    );
    this.deleteStmt = this.db.prepare(`DELETE FROM perspectives WHERE id = ?`);
  }

  async get(id: string): Promise<PerspectiveDef | null> {
    const row = this.selectByIdStmt.get(id);
    if (row === undefined) return null;
    return parseAndValidate(row);
  }

  async list(_query?: ListQuery): Promise<PerspectiveDef[]> {
    const rows = this.selectAllStmt.all();
    return rows.map(parseAndValidate);
  }

  async create(value: PerspectiveDef): Promise<PerspectiveDef> {
    const result = validatePerspective(value);
    if (!result.ok) {
      throw new ValidationError(
        `PerspectiveDef ${value.id} failed validation on write`,
        { issues: result.errors.issues },
      );
    }
    this.insertStmt.run(
      result.value.id,
      JSON.stringify(result.value),
      result.value.updatedAt,
    );
    return result.value;
  }

  async update(id: string, value: PerspectiveDef): Promise<PerspectiveDef> {
    if (value.id !== id) {
      throw new ValidationError(
        `PerspectiveDef.id (${value.id}) does not match the update target id (${id})`,
      );
    }
    const result = validatePerspective(value);
    if (!result.ok) {
      throw new ValidationError(
        `PerspectiveDef ${id} failed validation on update`,
        { issues: result.errors.issues },
      );
    }
    const run = this.updateStmt.run(
      JSON.stringify(result.value),
      result.value.updatedAt,
      id,
    );
    if (run.changes === 0) {
      throw new ValidationError(`No perspective with id ${id}`);
    }
    return result.value;
  }

  async delete(id: string): Promise<void> {
    this.deleteStmt.run(id);
  }
}

function parseAndValidate(row: PerspectiveRow): PerspectiveDef {
  let raw: unknown;
  try {
    raw = JSON.parse(row.payload);
  } catch (cause) {
    throw new ValidationError(
      `Stored perspective ${row.id} has unparseable JSON payload`,
      { cause },
    );
  }
  const result = validatePerspective(raw);
  if (!result.ok) {
    throw new ValidationError(
      `Stored perspective ${row.id} failed schema validation on read`,
      { issues: result.errors.issues },
    );
  }
  return result.value;
}
