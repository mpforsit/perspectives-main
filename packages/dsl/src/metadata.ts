/**
 * Canonical Zod schemas for the persisted metadata shapes that the engine,
 * the SQLite store, and the tRPC boundary all need to agree on.
 *
 * Three are landed here so far — `ConnectionProfile`, `AuditEvent`, and a
 * common `SslOptions` / `SshTunnelOptions` pair that the connection profile
 * composes. Before this file existed each layer rolled its own shape:
 * tRPC validated one way, the SQLite store validated another, and the
 * engine's TypeScript types described a third (see AUDIT-CODEX.md finding
 * #9). The schemas here are the single source of truth — engine types are
 * derived via `z.infer`, tRPC validates with these schemas at the IPC
 * boundary, and the SQLite store uses them on read/write.
 */

import { z } from "zod";

// ============================================================================
// Primitives shared with DSL schemas
// ============================================================================

const ISODateTime = z.string().datetime({ offset: true });

// ============================================================================
// Connection profile
// ============================================================================

export const dialectNameSchema = z.enum([
  "postgres",
  "mysql",
  "mssql",
  "sqlite",
  "other",
]);

export const environmentSchema = z.enum([
  "production",
  "staging",
  "development",
  "other",
]);

/**
 * SSL options carried on a `ConnectionProfile`. The secret-bearing
 * `clientKey` field is intentionally absent from the canonical schema —
 * letting it cross any boundary persists it as plaintext into the
 * unencrypted SQLite metadata file (AUDIT-CODEX.md finding #1). When
 * Phase 4 introduces `CredentialStore`-routed secrets, the key will
 * live on a separate type.
 */
export const sslOptionsSchema = z
  .object({
    mode: z.enum(["disable", "prefer", "require", "verify-ca", "verify-full"]),
    caCert: z.string().optional(),
    clientCert: z.string().optional(),
  })
  .strict();

/**
 * SSH tunnel options. Phase 4 — until encrypted routing exists, no
 * `sshTunnel` payload is acceptable. The schema still describes the
 * eventual shape (so the engine's `ConnectionProfile` type stays
 * structurally compatible with the renderer's form) but `.refine` rejects
 * every runtime payload.
 */
export const sshTunnelOptionsSchema = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65_535),
    user: z.string().min(1),
    authMethod: z.enum(["password", "key"]),
    password: z.string().optional(),
    privateKey: z.string().optional(),
    passphrase: z.string().optional(),
  })
  .strict()
  .refine(
    () => false,
    {
      message:
        "SSH tunneling is not yet supported — Phase 4 will route secret fields through CredentialStore",
    },
  );

export const connectionProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  dialect: dialectNameSchema,
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  database: z.string().min(1),
  user: z.string().min(1),
  /** Local-only; never serialized off the user's device. The metadata store
   *  routes this to its `CredentialStore`, not to the JSON row. */
  password: z.string(),
  applicationName: z.string().optional(),
  environment: environmentSchema,
  ssl: sslOptionsSchema.optional(),
  sshTunnel: sshTunnelOptionsSchema.optional(),
  createdAt: ISODateTime,
  updatedAt: ISODateTime,
});

/** Same shape minus the password — what the engine returns from
 *  `listConnections` / `createConnection` so credentials never enter the
 *  renderer's React Query cache. */
export const connectionProfileSummarySchema = connectionProfileSchema.omit({
  password: true,
});

// ============================================================================
// Audit log
// ============================================================================

const valuesMapSchema = z.record(z.string(), z.unknown());

export const auditActionSchema = z.enum(["insert", "update", "delete"]);

export const auditEventSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  userId: z.string().min(1),
  timestamp: ISODateTime,
  connectionId: z.string().min(1),
  /** Schema-qualified table name (e.g. "public.customers"). */
  table: z.string().min(1),
  primaryKey: valuesMapSchema,
  action: auditActionSchema,
  beforeValues: valuesMapSchema.optional(),
  afterValues: valuesMapSchema.optional(),
  perspectiveId: z.string().min(1).optional(),
});
