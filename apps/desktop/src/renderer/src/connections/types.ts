/**
 * Renderer-side aliases for engine types. Re-exporting through a single
 * module keeps every renderer import line short and gives us a single place
 * to swap to schema-derived types if the engine ever stops being TS-source.
 */

import type {
  ConnectionProfile,
  ConnectionProfileSummary,
} from "@perspectives/engine";

export type { ConnectionProfile, ConnectionProfileSummary };
