/**
 * Zod schemas for tRPC procedure inputs.
 *
 * The engine's TypeScript interfaces (in `@perspectives/engine/metadata.ts`)
 * are the canonical shapes; these schemas are the runtime gate at the IPC
 * boundary. If they ever drift from the interfaces, the typecheck on the
 * router callers will catch it — `z.infer<typeof ...>` is structurally
 * assignable to / from the engine types.
 *
 * Long-term, these schemas could move into `@perspectives/engine` (the same
 * "schema is source of truth" pattern the DSL package uses), but until there's
 * a second consumer the duplication is cheaper than the refactor.
 */

import { z } from "zod";

// ============================================================================
// Connection profile
// ============================================================================

export const dialectSchema = z.enum([
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

export const sslOptionsSchema = z.object({
  mode: z.enum(["disable", "prefer", "require", "verify-ca", "verify-full"]),
  caCert: z.string().optional(),
  clientCert: z.string().optional(),
  clientKey: z.string().optional(),
});

export const sshTunnelOptionsSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  user: z.string().min(1),
  authMethod: z.enum(["password", "key"]),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
});

export const connectionProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  dialect: dialectSchema,
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string(),
  applicationName: z.string().optional(),
  environment: environmentSchema,
  ssl: sslOptionsSchema.optional(),
  sshTunnel: sshTunnelOptionsSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

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
});
