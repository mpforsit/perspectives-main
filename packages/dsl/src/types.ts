/**
 * Convenience type aliases for the sub-shapes that make up PerspectiveDef.
 *
 * These exist so other workspace packages — notably @perspectives/engine —
 * can `import type { FilterGroup, SortDef, ColumnDef } from "@perspectives/dsl"`
 * without having to spell out `z.infer<typeof schemas.X>` themselves.
 *
 * Every alias is derived from the Zod schema in ./schemas via `z.infer`, so
 * the type and the runtime validator can never disagree. Do not declare these
 * shapes by hand here or anywhere else.
 */

import type { z } from "zod";
import {
  auditActionSchema,
  auditEventSchema,
  connectionProfileSchema,
  connectionProfileSummarySchema,
  dialectNameSchema,
  environmentSchema,
  sshTunnelOptionsSchema,
  sslOptionsSchema,
} from "./metadata";
import { schemas } from "./schemas";

export type FilterGroup = z.infer<typeof schemas.FilterGroup>;
export type FilterLeaf = z.infer<typeof schemas.FilterLeaf>;
export type ColumnDef = z.infer<typeof schemas.ColumnDef>;
export type PermissionDef = z.infer<typeof schemas.PermissionDef>;
export type PerspectiveBase = z.infer<typeof schemas.PerspectiveBase>;
export type JoinDef = z.infer<typeof schemas.JoinDef>;

// The remaining sub-shapes aren't surfaced as individual entries in `schemas`
// (they live only as object properties), so we derive them via index access
// on the top-level PerspectiveDef shape.
type Perspective = z.infer<typeof schemas.PerspectiveDef>;

export type SortDef = Perspective["sort"][number];
export type ColumnSource = ColumnDef["source"];
export type FilterBarConfig = Perspective["filterBar"];
export type FilterBarField = FilterBarConfig["visible"][number];
export type PerspectiveTableBase = Extract<PerspectiveBase, { kind: "table" }>;
export type PerspectiveSqlBase = Extract<PerspectiveBase, { kind: "sql" }>;

// Metadata-side types (canonical Zod-derived). AUDIT-CODEX.md finding #9.
export type DialectName = z.infer<typeof dialectNameSchema>;
export type EnvironmentTag = z.infer<typeof environmentSchema>;
export type SslOptions = z.infer<typeof sslOptionsSchema>;
export type SshTunnelOptions = z.infer<typeof sshTunnelOptionsSchema>;
export type ConnectionProfile = z.infer<typeof connectionProfileSchema>;
export type ConnectionProfileSummary = z.infer<
  typeof connectionProfileSummarySchema
>;
export type AuditAction = z.infer<typeof auditActionSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
