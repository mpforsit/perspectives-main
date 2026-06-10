/**
 * Audit log entries.
 *
 * The shape is defined in `@perspectives/dsl` (canonical Zod schema) and
 * re-exported here. Every write the engine performs against a target
 * database produces exactly one `AuditEvent`; the metadata store's
 * `auditLog` (an `AppendStore`) is what persists them.
 *
 * See AUDIT-CODEX.md finding #9 for why this lives in the DSL package.
 */

export type { AuditAction, AuditEvent } from "@perspectives/dsl";
