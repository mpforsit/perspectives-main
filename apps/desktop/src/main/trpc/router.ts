/**
 * The Electron-main tRPC router.
 *
 * The router definition lives in the main process — it imports `@trpc/server`
 * and any future engine packages. The renderer reaches it only via a
 * type-only import (`import type { AppRouter }`) so none of the server-side
 * runtime gets bundled into the browser.
 */

import { initTRPC } from "@trpc/server";
import superjson from "superjson";

import pkg from "../../../package.json";

/** Empty for now. Workspace / user / request-id context lands here later. */
export interface Context {
  // Intentionally empty.
}

export function createContext(): Context {
  return {};
}

const t = initTRPC.context<Context>().create({ transformer: superjson });

const healthRouter = t.router({
  /**
   * Liveness probe used by the renderer to confirm the engine is reachable.
   * Returns the running build's version so the UI can show what's loaded.
   */
  ping: t.procedure.query((): { ok: true; version: string } => ({
    ok: true,
    version: pkg.version,
  })),
});

export const appRouter = t.router({
  health: healthRouter,
});

export type AppRouter = typeof appRouter;
