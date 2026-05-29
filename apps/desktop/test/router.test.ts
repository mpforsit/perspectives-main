import { describe, expect, expectTypeOf, it } from "vitest";
import type { inferRouterOutputs } from "@trpc/server";

import { appRouter, createContext } from "../src/main/trpc/router";
import type { AppRouter } from "../src/main/trpc/router";

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
