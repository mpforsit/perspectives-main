import type { TrpcBuilder } from "../router";

import pkg from "../../../../package.json";

export function makeHealthRouter(t: TrpcBuilder) {
  return t.router({
    /**
     * Liveness probe used by the renderer to confirm the engine is reachable.
     * Returns the running build's version so the UI can show what's loaded.
     */
    ping: t.procedure.query((): { ok: true; version: string } => ({
      ok: true,
      version: pkg.version,
    })),
  });
}
