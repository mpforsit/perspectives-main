import { describe, expect, expectTypeOf, it } from "vitest";
import type { inferRouterOutputs } from "@trpc/server";

import {
  EngineService,
  type CredentialStore,
  type DatabaseAdapter,
  type DatabaseAdapterFactory,
  type MetadataStore,
} from "@perspectives/engine";

import { createContext, makeAppRouter, type AppRouter } from "../src/main/trpc/router";

// Health-only — the procedure doesn't touch the engine, but `makeAppRouter`
// needs *some* `EngineService`. Stubs are cheap.
const noopMetadataStore = {} as unknown as MetadataStore;
const noopCredentialStore: CredentialStore = {
  set: () => Promise.resolve(),
  get: () => Promise.resolve(null),
  delete: () => Promise.resolve(),
};
const noopAdapterFactory: DatabaseAdapterFactory = () => ({} as DatabaseAdapter);

const engine = new EngineService({
  metadataStore: noopMetadataStore,
  credentialStore: noopCredentialStore,
  adapterFactory: noopAdapterFactory,
});

const appRouter = makeAppRouter(engine);

describe("AppRouter — health.ping", () => {
  it("compile-time output shape is { ok: true; version: string }", () => {
    type Outputs = inferRouterOutputs<AppRouter>;
    type Ping = Outputs["health"]["ping"];

    expectTypeOf<Ping>().toEqualTypeOf<{ ok: true; version: string }>();
    expectTypeOf<Ping["ok"]>().toEqualTypeOf<true>();
    expectTypeOf<Ping["version"]>().toBeString();
  });

  it("resolves to ok=true and the package.json version string", async () => {
    const caller = appRouter.createCaller(createContext());
    const result = await caller.health.ping();

    expect(result.ok).toBe(true);
    expect(typeof result.version).toBe("string");
    // The version is driven by the desktop package.json — currently 0.0.1.
    // Allow any SemVer-shaped string so a bump doesn't silently break this test.
    expect(result.version).toMatch(/^\d+\.\d+\.\d+(?:[-+].*)?$/);
  });
});
