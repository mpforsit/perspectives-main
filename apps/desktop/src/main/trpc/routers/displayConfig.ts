import type { DisplayConfig, EngineService } from "@perspectives/engine";

import {
  deleteDisplayConfigInputSchema,
  getDisplayConfigInputSchema,
  upsertDisplayConfigInputSchema,
} from "../inputs";
import type { TrpcBuilder } from "../router";

// Cast helper for the Zod-vs-`exactOptionalPropertyTypes` boundary —
// matches the pattern in the other routers.
const asDisplayConfig = (value: unknown): DisplayConfig => value as DisplayConfig;

/**
 * Phase 2.5 — per-table display configuration. Configs are stored
 * per-`(host, port, database, schema, table)`, so the same DB schema on
 * different physical databases can have independent display preferences.
 */
export function makeDisplayConfigRouter(t: TrpcBuilder, engine: EngineService) {
  return t.router({
    getForTable: t.procedure
      .input(getDisplayConfigInputSchema)
      .query(({ input }) =>
        engine.getDisplayConfig(input.connectionId, input.schema, input.table),
      ),

    upsert: t.procedure
      .input(upsertDisplayConfigInputSchema)
      .mutation(({ input }) =>
        engine.upsertDisplayConfig(
          input.connectionId,
          asDisplayConfig(input.displayConfig),
        ),
      ),

    delete: t.procedure
      .input(deleteDisplayConfigInputSchema)
      .mutation(({ input }) =>
        engine.deleteDisplayConfig(input.connectionId, input.schema, input.table),
      ),
  });
}
