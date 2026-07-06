/**
 * The Electron-main tRPC router factory.
 *
 * Router *definitions* live here and in `./routers/*`. They depend only on
 * the engine's `EngineService` interface — the composition layer passes a
 * concrete instance in at startup. The renderer reaches the router only via
 * a type-only import (`import type { AppRouter }`) so none of the
 * server-side runtime gets bundled into the browser.
 */

import { initTRPC } from "@trpc/server";
import superjson from "superjson";

import type { EngineService } from "@perspectives/engine";

import { makeConnectionsRouter } from "./routers/connections";
import { makeDataRouter } from "./routers/data";
import { makeDisplayConfigRouter } from "./routers/displayConfig";
import { makeHealthRouter } from "./routers/health";
import { makeRelationsRouter } from "./routers/relations";
import { makeSchemaRouter } from "./routers/schema";
import { makeSettingsRouter } from "./routers/settings";

/** Empty for now. Workspace / user / request-id context lands here later. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Context {
  // Intentionally empty.
}

export function createContext(): Context {
  return {};
}

const t = initTRPC.context<Context>().create({ transformer: superjson });

/** The shared `t` builder, exposed for sub-router factories. */
export type TrpcBuilder = typeof t;

/**
 * Build the top-level tRPC router with a concrete `EngineService` wired in.
 * Called once at startup by the main process (and by the integration test).
 */
export function makeAppRouter(engine: EngineService) {
  return t.router({
    health: makeHealthRouter(t),
    connections: makeConnectionsRouter(t, engine),
    schema: makeSchemaRouter(t, engine),
    data: makeDataRouter(t, engine),
    relations: makeRelationsRouter(t, engine),
    displayConfig: makeDisplayConfigRouter(t, engine),
    settings: makeSettingsRouter(t, engine),
  });
}

export type AppRouter = ReturnType<typeof makeAppRouter>;
