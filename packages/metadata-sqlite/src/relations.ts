import type Database from "better-sqlite3";

import { validateRelation, type RelationDef } from "@perspectives/dsl";
import {
  ValidationError,
  type CRUDStore,
  type ListQuery,
} from "@perspectives/engine";

/**
 * Persists `RelationDef` rows. Identical pattern to `PerspectivesStore`:
 * JSON storage, DSL validation on both sides of the boundary.
 */

interface RelationRow {
  id: string;
  payload: string;
  updated_at: string;
}

export class RelationsStore implements CRUDStore<RelationDef> {
  private readonly insertStmt: Database.Statement<[string, string, string]>;
  private readonly updateStmt: Database.Statement<[string, string, string]>;
  private readonly selectByIdStmt: Database.Statement<[string], RelationRow>;
  private readonly selectAllStmt: Database.Statement<[], RelationRow>;
  private readonly deleteStmt: Database.Statement<[string]>;

  constructor(private readonly db: Database.Database) {
    this.insertStmt = this.db.prepare(
      `INSERT INTO relations (id, payload, updated_at) VALUES (?, ?, ?)`,
    );
    this.updateStmt = this.db.prepare(
      `UPDATE relations SET payload = ?, updated_at = ? WHERE id = ?`,
    );
    this.selectByIdStmt = this.db.prepare<[string], RelationRow>(
      `SELECT * FROM relations WHERE id = ?`,
    );
    this.selectAllStmt = this.db.prepare<[], RelationRow>(
      `SELECT * FROM relations ORDER BY updated_at DESC, id ASC`,
    );
    this.deleteStmt = this.db.prepare(`DELETE FROM relations WHERE id = ?`);
  }

  async get(id: string): Promise<RelationDef | null> {
    const row = this.selectByIdStmt.get(id);
    if (row === undefined) return null;
    return parseAndValidate(row);
  }

  async list(_query?: ListQuery): Promise<RelationDef[]> {
    return this.selectAllStmt.all().map(parseAndValidate);
  }

  async create(value: RelationDef): Promise<RelationDef> {
    const result = validateRelation(value);
    if (!result.ok) {
      throw new ValidationError(
        `RelationDef ${value.id} failed validation on write`,
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

  async update(id: string, value: RelationDef): Promise<RelationDef> {
    if (value.id !== id) {
      throw new ValidationError(
        `RelationDef.id (${value.id}) does not match the update target id (${id})`,
      );
    }
    const result = validateRelation(value);
    if (!result.ok) {
      throw new ValidationError(
        `RelationDef ${id} failed validation on update`,
        { issues: result.errors.issues },
      );
    }
    const run = this.updateStmt.run(
      JSON.stringify(result.value),
      result.value.updatedAt,
      id,
    );
    if (run.changes === 0) {
      throw new ValidationError(`No relation with id ${id}`);
    }
    return result.value;
  }

  async delete(id: string): Promise<void> {
    this.deleteStmt.run(id);
  }
}

function parseAndValidate(row: RelationRow): RelationDef {
  let raw: unknown;
  try {
    raw = JSON.parse(row.payload);
  } catch (cause) {
    throw new ValidationError(
      `Stored relation ${row.id} has unparseable JSON payload`,
      { cause },
    );
  }
  const result = validateRelation(raw);
  if (!result.ok) {
    throw new ValidationError(
      `Stored relation ${row.id} failed schema validation on read`,
      { issues: result.errors.issues },
    );
  }
  return result.value;
}
