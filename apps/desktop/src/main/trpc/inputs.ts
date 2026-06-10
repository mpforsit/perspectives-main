/**
 * Zod schemas for tRPC procedure inputs.
 *
 * The "shared" persisted shapes (`ConnectionProfile`, `AuditEvent`, etc.)
 * are re-exported from `@perspectives/dsl` — that package is the single
 * source of truth, and using its schemas here means the IPC boundary, the
 * SQLite store, and the engine all validate against the same definitions.
 * See AUDIT-CODEX.md finding #9.
 *
 * IPC-only shapes (`runReadOnlySqlInputSchema`, `getTablePageInputSchema`,
 * etc.) stay in this file — they describe RPC arguments, not persisted
 * objects.
 */

import { z } from "zod";

import {
  connectionProfileSchema as canonicalConnectionProfileSchema,
  dialectNameSchema,
  environmentSchema as canonicalEnvironmentSchema,
  sshTunnelOptionsSchema as canonicalSshTunnelOptionsSchema,
  sslOptionsSchema as canonicalSslOptionsSchema,
} from "@perspectives/dsl";

// ============================================================================
// Connection profile — re-exported from the canonical DSL schemas. The
// trailing "Schema" suffix is preserved so call sites stay unchanged.
// ============================================================================

export const dialectSchema = dialectNameSchema;
export const environmentSchema = canonicalEnvironmentSchema;
export const sslOptionsSchema = canonicalSslOptionsSchema;
export const sshTunnelOptionsSchema = canonicalSshTunnelOptionsSchema;
export const connectionProfileSchema = canonicalConnectionProfileSchema;

// ============================================================================
// Sort + Cursor (for data.getTablePage)
// ============================================================================

export const sortDefSchema = z.object({
  joinAlias: z.string().min(1).max(64).optional(),
  column: z.string().min(1).max(255),
  direction: z.enum(["asc", "desc"]),
  nulls: z.enum(["first", "last"]).optional(),
});

export const cursorSchema = z.object({
  values: z.array(
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
  direction: z.enum(["forward", "backward"]),
});

// ============================================================================
// Tagged inputs the sub-routers actually receive
// ============================================================================

export const connectionIdSchema = z.object({
  connectionId: z.string().min(1),
});

export const tableRefSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1),
  table: z.string().min(1),
});

export const getTablePageInputSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1),
  table: z.string().min(1),
  sort: z.array(sortDefSchema).default([]),
  cursor: cursorSchema.optional(),
  pageSize: z.number().int().min(1).max(10_000).optional(),
});

export const runReadOnlySqlInputSchema = z.object({
  connectionId: z.string().min(1),
  // 1 MiB upper bound — well past anything a human would paste into the
  // console; mostly a defence against accidental file-drop.
  sql: z.string().min(1).max(1_048_576),
  /** Per-call override of the engine's SQL-console budget. The engine fills
   *  defaults from `READ_ONLY_SQL_DEFAULTS` so the renderer may omit any
   *  field. See AUDIT-CODEX.md finding #4. */
  limits: z
    .object({
      statementTimeoutMs: z.number().int().positive().max(600_000).optional(),
      idleInTransactionTimeoutMs: z
        .number()
        .int()
        .positive()
        .max(600_000)
        .optional(),
      maxRows: z.number().int().nonnegative().max(1_000_000).optional(),
      maxBytes: z.number().int().nonnegative().max(512 * 1024 * 1024).optional(),
    })
    .optional(),
  /** Opaque token identifying an in-flight cancellation request. The router
   *  registers an AbortController under this id so the renderer can call
   *  `cancelReadOnlySql` and reach the running query through `pg_cancel_backend`. */
  cancelToken: z.string().min(1).max(128).optional(),
});

export const cancelReadOnlySqlInputSchema = z.object({
  cancelToken: z.string().min(1).max(128),
});
