import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConnectionError, type ConnectionProfile } from "@perspectives/engine";

import { PostgresAdapter } from "../src";
import { withSeededPostgres } from "./helpers/container";

const handle = withSeededPostgres();

describe("PostgresAdapter.testConnection", () => {
  let adapter: PostgresAdapter;

  beforeAll(() => {
    adapter = new PostgresAdapter(handle.profile);
  });

  afterAll(async () => {
    await adapter.close();
  });

  it("returns server identity and a measurable latency", async () => {
    const info = await adapter.testConnection();

    expect(info.serverName).toBe("PostgreSQL");
    expect(info.serverVersion).toMatch(/^\d+(?:\.\d+)*/);
    expect(info.database).toBe(handle.profile.database);
    expect(info.user).toBe(handle.profile.user);
    expect(info.connectionId).toMatch(/^\d+$/);
    expect(info.latencyMs).toBeGreaterThanOrEqual(0);
    expect(info.latencyMs).toBeLessThan(60_000);
  });

  it("populates the dialect's negotiated version after the probe", async () => {
    await adapter.testConnection();
    expect(adapter.dialect.version).toMatch(/^\d+(?:\.\d+)*/);
  });
});

describe("PostgresAdapter — error mapping", () => {
  it("throws a ConnectionError when the server is unreachable", async () => {
    const badProfile: ConnectionProfile = {
      ...handle.profile,
      // Port 1 is privileged and not listening — connect() fails fast.
      port: 1,
    };
    const badAdapter = new PostgresAdapter(badProfile, {
      connectionTimeoutMillis: 2_000,
      max: 1,
    });

    try {
      await expect(badAdapter.testConnection()).rejects.toBeInstanceOf(
        ConnectionError,
      );
    } finally {
      await badAdapter.close();
    }
  });
});
