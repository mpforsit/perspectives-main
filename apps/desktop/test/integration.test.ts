/**
 * End-to-end tRPC integration: tRPC caller → EngineService → PostgresAdapter →
 * Postgres → back. Uses the same `seed.sql` the adapter-postgres tests use, so
 * a single change to the fixture stays in sync across both packages.
 *
 * The full stack runs in-process — `createCaller` invokes the procedures
 * directly without going over IPC. That's deliberate: this test is about the
 * service composition and router wiring, not about the IPC bridge (which is
 * covered separately in the adapter-postgres + metadata-sqlite suites).
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresAdapter } from "@perspectives/adapter-postgres";
import {
  EngineService,
  type ConnectionProfile,
} from "@perspectives/engine";
import {
  InMemoryCredentialStore,
  SqliteMetadataStore,
} from "@perspectives/metadata-sqlite";

import { createContext, makeAppRouter } from "../src/main/trpc/router";

const here = fileURLToPath(new URL(".", import.meta.url));
const SEED_SQL_PATH = resolve(
  here,
  "../../../packages/adapter-postgres/test/fixtures/seed.sql",
);

const TEST_DB = "perspectives_integration";
const TEST_USER = "perspectives_int_user";
const TEST_PASSWORD = "perspectives_int_password";
const CONNECTION_ID = "01J9X2KZQ5N7P3VCM8B4ETRGYH";
const NOW = "2026-05-29T08:00:00.000Z";

let container: StartedPostgreSqlContainer;
let engine: EngineService;
let metadataStore: SqliteMetadataStore;
let caller: ReturnType<ReturnType<typeof makeAppRouter>["createCaller"]>;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16")
    .withDatabase(TEST_DB)
    .withUsername(TEST_USER)
    .withPassword(TEST_PASSWORD)
    .withCopyFilesToContainer([
      { source: SEED_SQL_PATH, target: "/docker-entrypoint-initdb.d/00-seed.sql" },
    ])
    .start();

  const credentialStore = new InMemoryCredentialStore();
  metadataStore = new SqliteMetadataStore({
    filePath: ":memory:",
    credentialStore,
  });
  engine = new EngineService({
    metadataStore,
    credentialStore,
    adapterFactory: (profile) => new PostgresAdapter(profile),
  });
  caller = makeAppRouter(engine).createCaller(createContext());
}, 120_000);

afterAll(async () => {
  await engine?.close();
  await metadataStore?.close();
  await container?.stop();
});

describe("EngineService over tRPC — full stack", () => {
  it("creates a connection, connects, introspects, and pages customers", async () => {
    const profile: ConnectionProfile = {
      id: CONNECTION_ID,
      name: "Integration test",
      dialect: "postgres",
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: TEST_DB,
      user: TEST_USER,
      password: TEST_PASSWORD,
      applicationName: "perspectives-integration-test",
      environment: "development",
      createdAt: NOW,
      updatedAt: NOW,
    };

    // 1. Create the profile via tRPC.
    const created = await caller.connections.create(profile);
    expect(created.id).toBe(profile.id);

    const listed = await caller.connections.list();
    expect(listed.map((p) => p.id)).toContain(profile.id);

    // 2. Activate the connection (constructs the adapter, probes the server).
    const info = await caller.connections.connect({ connectionId: profile.id });
    expect(info.serverName).toBe("PostgreSQL");
    expect(info.database).toBe(TEST_DB);
    expect(info.user).toBe(TEST_USER);

    // 3. Introspect schema through the cached path.
    const snapshot = await caller.schema.get({ connectionId: profile.id });
    const publicSchema = snapshot.schemas.find((s) => s.name === "public");
    expect(publicSchema).toBeDefined();
    const customers = publicSchema?.tables.find((t) => t.name === "customers");
    expect(customers).toBeDefined();
    expect(customers?.comment).toBe("End customers of the business.");

    // 4. Page the customers table.
    const page = await caller.data.getTablePage({
      connectionId: profile.id,
      schema: "public",
      table: "customers",
      sort: [{ column: "id", direction: "asc" }],
      pageSize: 25,
    });
    expect(page.rows.length).toBe(25);
    expect(page.nextCursor).toBeDefined();
    // The seed packs ids 1..3000 sequentially via generate_series.
    expect(Number(page.rows[0]?.["id"])).toBe(1);
    expect(Number(page.rows[24]?.["id"])).toBe(25);

    // 5. Cross-check the count and estimate.
    const exact = await caller.data.countTable({
      connectionId: profile.id,
      schema: "public",
      table: "customers",
    });
    expect(exact).toBe(3000);

    const estimate = await caller.data.estimateTable({
      connectionId: profile.id,
      schema: "public",
      table: "customers",
    });
    expect(estimate).toBeGreaterThan(0);

    // 6a. SQL console path — read-only-enforced raw SQL through tRPC.
    const sqlOk = await caller.data.runReadOnlySql({
      connectionId: profile.id,
      sql: "SELECT id, country_code FROM customers ORDER BY id LIMIT 2",
    });
    expect(sqlOk.rows.length).toBe(2);
    expect(sqlOk.columns.map((c) => c.name)).toEqual(["id", "country_code"]);

    await expect(
      caller.data.runReadOnlySql({
        connectionId: profile.id,
        sql: "UPDATE customers SET country_code = 'ZZ' WHERE id = 1",
      }),
    ).rejects.toThrowError(/read-only/i);

    // 6b. Settings round-trip via the new settings router (used for tab restore).
    const restoreKey = `session:${profile.id}:openTabs`;
    expect(await caller.settings.get({ key: restoreKey })).toBeNull();
    await caller.settings.set({
      key: restoreKey,
      value: [{ kind: "table", schema: "public", name: "customers" }],
    });
    expect(await caller.settings.get({ key: restoreKey })).toEqual([
      { kind: "table", schema: "public", name: "customers" },
    ]);

    // 7. Disconnect — the adapter must release its pool so the test process
    //    can exit cleanly.
    await caller.connections.disconnect({ connectionId: profile.id });
  }, 60_000);
});
