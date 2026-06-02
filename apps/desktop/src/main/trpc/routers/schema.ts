import type { EngineService } from "@perspectives/engine";

import { connectionIdSchema } from "../inputs";
import type { TrpcBuilder } from "../router";

export function makeSchemaRouter(t: TrpcBuilder, engine: EngineService) {
  return t.router({
    /** Returns the cached schema for an active connection, fetching it once
     *  if the cache is cold. */
    get: t.procedure
      .input(connectionIdSchema)
      .query(({ input }) => engine.getSchema(input.connectionId)),

    /** Invalidate the cache and re-introspect — used by the renderer's
     *  "Refresh schema" action. */
    refresh: t.procedure
      .input(connectionIdSchema)
      .mutation(({ input }) => engine.refreshSchema(input.connectionId)),
  });
}
