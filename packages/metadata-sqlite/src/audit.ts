import type Database from "better-sqlite3";

import { auditEventSchema } from "@perspectives/dsl";
import {
  ValidationError,
  type AppendListQuery,
  type AppendStore,
  type AuditEvent,
} from "@perspectives/engine";

/**
 * Append-only audit log. Writes are single-row inserts; reads support
 * since/until filters on the `timestamp` column plus a hard `limit`.
 *
 * Every event goes through the canonical Zod schema in `@perspectives/dsl`
 * on write — bad shapes never reach the SQLite row. The schema is the
 * single source of truth (see AUDIT-CODEX.md finding #9 + long-term #4).
 */

interface AuditRow {
  id: string;
  workspace_id: string | null;
  user_id: string;
  timestamp: string;
  connection_id: string;
  perspective_id: string | null;
  table_name: string;
  primary_key_json: string;
  action: AuditEvent["action"];
  before_values_json: string | null;
  after_values_json: string | null;
}

export class AuditLogStore implements AppendStore<AuditEvent> {
  private readonly insertStmt: Database.Statement<[
    string, string | null, string, string, string, string | null,
    string, string, AuditEvent["action"], string | null, string | null,
  ]>;

  constructor(private readonly db: Database.Database) {
    this.insertStmt = this.db.prepare(`
      INSERT INTO audit_log (
        id, workspace_id, user_id, timestamp, connection_id, perspective_id,
        table_name, primary_key_json, action, before_values_json, after_values_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  async append(event: AuditEvent): Promise<void> {
    const parsed = auditEventSchema.safeParse(event);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path?.join(".") ?? "AuditEvent";
      throw new ValidationError(`${path}: ${issue?.message ?? "invalid"}`, {
        cause: parsed.error,
      });
    }
    const e = parsed.data;
    this.insertStmt.run(
      e.id,
      e.workspaceId ?? null,
      e.userId,
      e.timestamp,
      e.connectionId,
      e.perspectiveId ?? null,
      e.table,
      JSON.stringify(e.primaryKey),
      e.action,
      e.beforeValues === undefined ? null : JSON.stringify(e.beforeValues),
      e.afterValues === undefined ? null : JSON.stringify(e.afterValues),
    );
    return Promise.resolve();
  }

  async list(query?: AppendListQuery): Promise<AuditEvent[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query?.since !== undefined) {
      conditions.push("timestamp >= ?");
      params.push(query.since);
    }
    if (query?.until !== undefined) {
      conditions.push("timestamp < ?");
      params.push(query.until);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = typeof query?.limit === "number" ? `LIMIT ${query.limit}` : "";
    const offset =
      typeof query?.offset === "number" ? `OFFSET ${query.offset}` : "";

    const sql = `SELECT * FROM audit_log ${where} ORDER BY timestamp ASC, id ASC ${limit} ${offset}`;
    const rows = this.db.prepare<unknown[], AuditRow>(sql).all(...params);
    return rows.map(rowToEvent);
  }
}

function rowToEvent(row: AuditRow): AuditEvent {
  const event: AuditEvent = {
    id: row.id,
    userId: row.user_id,
    timestamp: row.timestamp,
    connectionId: row.connection_id,
    table: row.table_name,
    primaryKey: parseJson(row.primary_key_json, "primary_key_json") as Record<
      string,
      unknown
    >,
    action: row.action,
  };
  if (row.workspace_id !== null) event.workspaceId = row.workspace_id;
  if (row.perspective_id !== null) event.perspectiveId = row.perspective_id;
  if (row.before_values_json !== null) {
    event.beforeValues = parseJson(row.before_values_json, "before_values_json") as Record<
      string,
      unknown
    >;
  }
  if (row.after_values_json !== null) {
    event.afterValues = parseJson(row.after_values_json, "after_values_json") as Record<
      string,
      unknown
    >;
  }
  return event;
}

function parseJson(raw: string, column: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new ValidationError(`Stored audit_log row has unparseable ${column}`, {
      cause,
    });
  }
}
