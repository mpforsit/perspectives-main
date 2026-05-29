/**
 * Audit log entries.
 *
 * Every write the engine performs against a target database produces exactly
 * one `AuditEvent`. The metadata store's `auditLog` (an AppendStore) is what
 * persists them. The plan calls for these to be browsable and searchable in
 * the UI, and surfaced to workspace admins in shared mode.
 *
 * Notes on shape:
 *   - `primaryKey` is the column → value map of the affected row. Most tables
 *     have a single-column PK, but compound PKs are first-class everywhere
 *     else in the engine, so we keep that flexibility here too.
 *   - `beforeValues` / `afterValues` are the column → value maps the engine
 *     read immediately before / after the mutation. They are populated for
 *     updates (both) and inserts (`afterValues` only) and deletes
 *     (`beforeValues` only).
 *   - `connectionId` is the metadata-store id of the ConnectionProfile the
 *     write went through — *not* the raw DB session id. We never persist
 *     credentials here.
 */

export interface AuditEvent {
  /** ULID. */
  id: string;
  /** Workspace this event belongs to. Absent in single-user / local mode. */
  workspaceId?: string;
  /** Stable user id from the metadata store. In single-user mode this is the
   *  local user record's id. */
  userId: string;
  /** ISO-8601 timestamp with offset. */
  timestamp: string;
  /** ConnectionProfile id (not the DB session id). */
  connectionId: string;
  /** Schema-qualified table name, e.g. "public.customers". */
  table: string;
  /** Column → value map of the affected row's primary key. */
  primaryKey: Record<string, unknown>;
  action: "insert" | "update" | "delete";
  /** Pre-mutation snapshot. Populated on `update` and `delete`. */
  beforeValues?: Record<string, unknown>;
  /** Post-mutation snapshot. Populated on `insert` and `update`. */
  afterValues?: Record<string, unknown>;
  /** The perspective the write went through, if any. Direct SQL writes leave
   *  this undefined. */
  perspectiveId?: string;
}
