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

    // 6c. Phase 2.1 — relations index over the full stack.
    const relations = await caller.relations.list({ connectionId: profile.id });
    // Seed FKs we expect to discover: customer_tags(customer_id→customers.id),
    // customer_tags(tag_id→tags.id), inventory(product_id→products.id),
    // inventory(tenant_id, warehouse_code→warehouses.tenant_id, code) [compound],
    // employees(manager_id→employees.id) [self-ref], orders(customer_id→customers.id).
    expect(relations.length).toBeGreaterThanOrEqual(6);
    // Every id passes the DSL's ULID regex (Crockford base32, 26 chars).
    for (const r of relations) {
      expect(r.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
    const compound = relations.find(
      (r) => r.from.table === "inventory" && r.to.table === "warehouses",
    );
    expect(compound).toBeDefined();
    expect(compound?.from.columns).toEqual(["tenant_id", "warehouse_code"]);
    expect(compound?.to.columns).toEqual(["tenant_id", "code"]);
    expect(compound?.source).toBe("schema");

    const selfRef = relations.find(
      (r) =>
        r.from.table === "employees" &&
        r.to.table === "employees" &&
        r.from.columns[0] === "manager_id",
    );
    expect(selfRef).toBeDefined();
    expect(selfRef?.cardinality).toBe("one-to-many");

    const ordersToCustomers = relations.find(
      (r) => r.from.table === "orders" && r.to.table === "customers",
    );
    expect(ordersToCustomers).toBeDefined();

    // Stability: ids survive a re-fetch (deterministic over the same FKs).
    const second = await caller.relations.list({ connectionId: profile.id });
    expect(second.map((r) => r.id).sort()).toEqual(
      relations.map((r) => r.id).sort(),
    );

    // Custom relations merge in alongside schema-derived ones. Insert one
    // directly through the metadata store under the correct scope key.
    const scope = `postgres://${profile.host.toLowerCase()}:${profile.port}/${profile.database}`;
    const customRel = {
      // ULID — must avoid I/L/O/U. "CUSTOM" contained both U and O.
      id: "01J9X2KZQ5N7P3VCM8B4ETRGZK" as const,
      from: { schema: "public", table: "orders", columns: ["status"] },
      to: { schema: "public", table: "orders", columns: ["id"] },
      cardinality: "one-to-many" as const,
      source: "custom" as const,
      displayDirection: "both" as const,
      updatedAt: NOW,
    };
    await metadataStore.relations.create(scope, customRel);
    const merged = await caller.relations.list({ connectionId: profile.id });
    expect(merged.map((r) => r.id)).toContain(customRel.id);
    expect(merged.filter((r) => r.source === "custom").length).toBe(1);

    // 6d. getRowByKey — compound PK round-trips correctly.
    // warehouses(tenant_id, code) PK. The seed inserts (1, 'A1') and (1, 'B2').
    const warehouseRow = await caller.data.getRowByKey({
      connectionId: profile.id,
      schema: "public",
      table: "warehouses",
      pkValues: [1, "A1"],
    });
    expect(warehouseRow).not.toBeNull();
    expect(warehouseRow?.["tenant_id"]).toBe(1);
    expect(warehouseRow?.["code"]).toBe("A1");

    // Miss returns null, not error.
    const missing = await caller.data.getRowByKey({
      connectionId: profile.id,
      schema: "public",
      table: "warehouses",
      pkValues: [999, "NONE"],
    });
    expect(missing).toBeNull();

    // Simple PK still works.
    const customerOne = await caller.data.getRowByKey({
      connectionId: profile.id,
      schema: "public",
      table: "customers",
      pkValues: [1],
    });
    expect(customerOne).not.toBeNull();
    expect(Number(customerOne?.["id"])).toBe(1);

    // 6e. Phase 2.3 — junction detection: customer_tags is detected as an
    //     m:n between customers and tags. The 1:n relations whose `from`
    //     side IS the junction (customer_tags → customers,
    //     customer_tags → tags) remain in listRelations for Phase 3 join
    //     resolution; the inspector's getReferencingCounts suppresses them.
    const junctions = await caller.relations.detectJunctions({
      connectionId: profile.id,
    });
    const customerTagsJunction = junctions.find(
      (j) => j.junction.schema === "public" && j.junction.table === "customer_tags",
    );
    expect(customerTagsJunction).toBeDefined();
    expect(customerTagsJunction?.m2n.cardinality).toBe("many-to-many");
    expect(customerTagsJunction?.m2n.junction).toBeDefined();
    expect(customerTagsJunction?.m2n.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    // The m:n RelationDef shows up in listRelations alongside the
    // schema-derived 1:n's and the custom relation added earlier.
    const allWithJunction = await caller.relations.list({ connectionId: profile.id });
    expect(allWithJunction.some((r) => r.id === customerTagsJunction?.m2n.id)).toBe(true);

    // 6f. Policy round-trip: setting `never` removes the junction; setting
    //     back to `auto` restores it.
    await caller.relations.setJunctionPolicy({
      connectionId: profile.id,
      schema: "public",
      table: "customer_tags",
      policy: "never",
    });
    const afterNever = await caller.relations.detectJunctions({
      connectionId: profile.id,
    });
    expect(
      afterNever.find(
        (j) => j.junction.table === "customer_tags",
      ),
    ).toBeUndefined();
    // ...and listRelations no longer surfaces the m:n while the override
    // is active.
    const listAfterNever = await caller.relations.list({ connectionId: profile.id });
    expect(
      listAfterNever.some((r) => r.cardinality === "many-to-many"),
    ).toBe(false);

    await caller.relations.setJunctionPolicy({
      connectionId: profile.id,
      schema: "public",
      table: "customer_tags",
      policy: "auto",
    });
    const afterAuto = await caller.relations.detectJunctions({
      connectionId: profile.id,
    });
    expect(
      afterAuto.find((j) => j.junction.table === "customer_tags"),
    ).toBeDefined();

    // 6g. getReferencingCounts for customer #1 surfaces the orders count
    //     (3 orders per customer — 9000 orders / 3000 customers via i % 3000)
    //     plus the m:n customer↔tags count (0 — no customer_tags rows seeded).
    //     The 1:n customer_tags → customers component is SUPPRESSED.
    const counts = await caller.data.getReferencingCounts({
      connectionId: profile.id,
      schema: "public",
      table: "customers",
      // Send the focused row's primitive values keyed by column name —
      // the engine looks up `relation.to.columns[i]` against this map, so
      // custom relations referencing non-PK unique columns (e.g. `email`)
      // also get filled. Customer #1's row from the seed.
      rowValues: {
        id: 1,
        email: "customer1@example.com",
        country_code: "DE",
      },
    });
    // The 1:n customer_tags → customers (which would show "0 customer_tags
    // rows") must NOT appear because the m:n collapses through it.
    const customerTagsComponentRel = allWithJunction.find(
      (r) =>
        r.cardinality !== "many-to-many" &&
        r.from.schema === "public" &&
        r.from.table === "customer_tags" &&
        r.to.schema === "public" &&
        r.to.table === "customers",
    );
    expect(customerTagsComponentRel).toBeDefined();
    expect(counts.find((c) => c.relationId === customerTagsComponentRel?.id)).toBeUndefined();

    // The m:n surfaces under its real id with count 0 (seed has no
    // customer_tags rows yet).
    expect(
      counts.find((c) => c.relationId === customerTagsJunction?.m2n.id),
    ).toMatchObject({ count: 0, estimated: false });

    // The orders 1:n surfaces with count 3 (customers 1..3000 each get
    // i ∈ {3000, 6000, 9000} → 3 orders for customer #1).
    const ordersRel = allWithJunction.find(
      (r) =>
        r.cardinality !== "many-to-many" &&
        r.from.schema === "public" &&
        r.from.table === "orders" &&
        r.to.table === "customers",
    );
    expect(ordersRel).toBeDefined();
    const ordersCount = counts.find((c) => c.relationId === ordersRel?.id);
    expect(ordersCount?.count).toBe(3);
    expect(ordersCount?.estimated).toBe(false);

    // 6h. Phase 2.4 — custom-relation CRUD over tRPC.
    //     Create a custom 1:n between two tables that have no FK between
    //     them. The seed has no `countries` table, so we use
    //     `orders.placed_at → orders.id` as a contrived 1:n target (it
    //     wouldn't be useful semantically, but it exercises the validation
    //     path with valid columns + unique target).
    //
    //     Actually simpler: use an existing unique constraint as the target
    //     and a non-FK column as the source. customers.email is unique;
    //     orders has no FK to customers.email. So:
    //       orders.status (non-unique) → customers.email (unique)
    //     is a legal custom 1:n the seed doesn't already model.
    const beforeCount = (
      await caller.relations.list({ connectionId: profile.id })
    ).length;
    const createdCustom = await caller.relations.createCustom({
      connectionId: profile.id,
      relation: {
        from: {
          schema: "public",
          table: "orders",
          columns: ["status"],
        },
        to: {
          schema: "public",
          table: "customers",
          columns: ["email"],
        },
        cardinality: "one-to-many",
        label: { forward: "billed customer", reverse: "status order" },
        displayDirection: "both",
      },
    });
    expect(createdCustom.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(createdCustom.source).toBe("custom");
    expect(createdCustom.from.columns).toEqual(["status"]);
    expect(createdCustom.to.columns).toEqual(["email"]);

    const afterCreate = await caller.relations.list({ connectionId: profile.id });
    expect(afterCreate.length).toBe(beforeCount + 1);
    expect(afterCreate.some((r) => r.id === createdCustom.id)).toBe(true);

    // The inspector must include the custom relation in its count output
    // even though it references customers.email (a non-PK unique column).
    // Before the rowValues refactor this crashed with "Target column
    // 'email' is not part of the focused PK [id]".
    const countsWithCustom = await caller.data.getReferencingCounts({
      connectionId: profile.id,
      schema: "public",
      table: "customers",
      rowValues: {
        id: 1,
        email: "customer1@example.com",
      },
    });
    const customCount = countsWithCustom.find(
      (c) => c.relationId === createdCustom.id,
    );
    expect(customCount).toBeDefined();
    // Status values cycle "pending"/"shipped"/"delivered"/"cancelled"; the
    // chance of any of them matching "customer1@example.com" is zero, so
    // count is 0 — what matters is the path didn't throw.
    expect(customCount?.count).toBe(0);
    expect(customCount?.estimated).toBe(false);

    // 6i. Reject creation when the target columns are NOT collectively
    //     unique. orders.placed_at is not unique on its own → must reject.
    await expect(
      caller.relations.createCustom({
        connectionId: profile.id,
        relation: {
          from: {
            schema: "public",
            table: "customers",
            columns: ["country_code"],
          },
          to: {
            schema: "public",
            table: "orders",
            columns: ["placed_at"],
          },
          cardinality: "one-to-many",
        },
      }),
    ).rejects.toThrowError(/not a unique constraint/i);

    // 6j. Reject creation when the columns mismatch in count (compound
    //     mismatch is a JS-level guard before the DB ever sees the input).
    await expect(
      caller.relations.createCustom({
        connectionId: profile.id,
        relation: {
          from: {
            schema: "public",
            table: "orders",
            columns: ["status", "id"],
          },
          to: {
            schema: "public",
            table: "customers",
            columns: ["email"],
          },
          cardinality: "one-to-many",
        },
      }),
    ).rejects.toThrowError(/mismatch/i);

    // 6k. Reject creation when the shape exactly duplicates a schema-derived
    //     relation. The schema-derived orders.customer_id → customers.id
    //     already exists.
    await expect(
      caller.relations.createCustom({
        connectionId: profile.id,
        relation: {
          from: {
            schema: "public",
            table: "orders",
            columns: ["customer_id"],
          },
          to: {
            schema: "public",
            table: "customers",
            columns: ["id"],
          },
          cardinality: "one-to-many",
        },
      }),
    ).rejects.toThrowError(/already covers/i);

    // 6l. Delete the custom relation.
    await caller.relations.deleteCustom({
      connectionId: profile.id,
      id: createdCustom.id,
    });
    const afterDelete = await caller.relations.list({
      connectionId: profile.id,
    });
    expect(afterDelete.some((r) => r.id === createdCustom.id)).toBe(false);
    expect(afterDelete.length).toBe(beforeCount);

    // 6m. Delete is idempotent on unknown ids — schema-derived relations
    //     aren't persisted in `metadata.relations`, so a delete by a
    //     schema-derived id is a no-op (not an error). This documents the
    //     current behaviour: the source-check in the engine only fires when
    //     the id IS persisted but happens to be marked source="schema".
    //     That path is unreachable through normal flow (custom relations
    //     never carry source="schema") but the guard is kept as
    //     belt-and-braces.
    const aSchemaDerivedId = afterDelete.find((r) => r.source === "schema")?.id;
    expect(aSchemaDerivedId).toBeDefined();
    await expect(
      caller.relations.deleteCustom({
        connectionId: profile.id,
        id: aSchemaDerivedId!,
      }),
    ).resolves.toBeUndefined();

    // 6n. Phase 2.5 — display config + batched row labels.
    //     Save a DisplayConfig on customers with a template, then fetch
    //     labels for three rows in one batch.
    const customerDisplay = await caller.displayConfig.upsert({
      connectionId: profile.id,
      displayConfig: {
        schema: "public",
        table: "customers",
        displayColumn: "full_name",
        secondaryColumn: "email",
        rowLabelTemplate: "{full_name} ({country_code})",
        updatedAt: NOW,
      },
    });
    expect(customerDisplay.displayColumn).toBe("full_name");
    expect(customerDisplay.rowLabelTemplate).toBe("{full_name} ({country_code})");

    // Round-trip via getForTable.
    const fetchedConfig = await caller.displayConfig.getForTable({
      connectionId: profile.id,
      schema: "public",
      table: "customers",
    });
    expect(fetchedConfig?.displayColumn).toBe("full_name");

    // Batch label lookup for three customer rows. Seed:
    //   country_code = ['DE','FR','NL','IT','ES','PL','US','UK','BR','JP'][1+(i%10)]
    //   → i=1 picks index 2 → FR; i=2 picks 3 → NL; i=3 picks 4 → IT.
    const customerLabels = await caller.data.getRowLabels({
      connectionId: profile.id,
      schema: "public",
      table: "customers",
      pkTuples: [[1], [2], [3]],
    });
    expect(customerLabels).toHaveLength(3);
    expect(customerLabels[0]).toBe("Customer 1 (FR)");
    expect(customerLabels[1]).toBe("Customer 2 (NL)");
    expect(customerLabels[2]).toBe("Customer 3 (IT)");

    // Missing rows render as empty strings — single round trip still.
    const partialLabels = await caller.data.getRowLabels({
      connectionId: profile.id,
      schema: "public",
      table: "customers",
      pkTuples: [[1], [99999], [3]],
    });
    expect(partialLabels).toEqual([
      "Customer 1 (FR)",
      "",
      "Customer 3 (IT)",
    ]);

    // 6o. Compound-PK batch — single round trip via the OR-of-AND-of-eq
    //     filter. The seed has warehouses (1, 'A1') and (1, 'B2').
    const warehouseLabels = await caller.data.getRowLabels({
      connectionId: profile.id,
      schema: "public",
      table: "warehouses",
      // Input order: B2 first, then A1 → labels must come back in that
      // order regardless of the database's natural row order.
      pkTuples: [
        [1, "B2"],
        [1, "A1"],
      ],
    });
    expect(warehouseLabels).toHaveLength(2);
    // No DisplayConfig on warehouses → PK fallback `<tenant_id>·<code>`.
    expect(warehouseLabels[0]).toBe("1·B2");
    expect(warehouseLabels[1]).toBe("1·A1");

    // Delete + re-fetch returns null.
    await caller.displayConfig.delete({
      connectionId: profile.id,
      schema: "public",
      table: "customers",
    });
    expect(
      await caller.displayConfig.getForTable({
        connectionId: profile.id,
        schema: "public",
        table: "customers",
      }),
    ).toBeNull();

    // Without a DisplayConfig, labels fall back to the PK.
    const fallback = await caller.data.getRowLabels({
      connectionId: profile.id,
      schema: "public",
      table: "customers",
      pkTuples: [[1]],
    });
    expect(fallback[0]).toBe("1");

    // 6p. Phase 2.6 — cardinality preview. The orders.customer_id → customers.id
    //     1:n is the canonical "outbound" relation from customers' point of view.
    //     Seed: 9000 orders / 3000 customers via i % 3000 → exactly 3 orders each.
    const ordersRelForPreview = allWithJunction.find(
      (r) =>
        r.cardinality !== "many-to-many" &&
        r.from.schema === "public" &&
        r.from.table === "orders" &&
        r.to.schema === "public" &&
        r.to.table === "customers",
    );
    expect(ordersRelForPreview).toBeDefined();

    // 6p.1 — first 100 customers, exact grouped path. Each row gets count 3.
    const first100 = Array.from({ length: 100 }, (_, i) => [i + 1]);
    const previewFirst100 = await caller.data.getCountsForRows({
      connectionId: profile.id,
      schema: "public",
      table: "customers",
      pkTuples: first100,
      relationIds: [ordersRelForPreview!.id],
    });
    expect(previewFirst100).toHaveLength(100);
    for (const entry of previewFirst100) {
      expect(entry.relationId).toBe(ordersRelForPreview!.id);
      expect(entry.count).toBe(3);
      expect(entry.estimated).toBe(false);
    }

    // 6p.2 — sweep all 3000 customers in batches of 200 and confirm total = 9000.
    let total = 0;
    for (let start = 1; start <= 3000; start += 200) {
      const batch = Array.from(
        { length: Math.min(200, 3001 - start) },
        (_, i) => [start + i],
      );
      const counts = await caller.data.getCountsForRows({
        connectionId: profile.id,
        schema: "public",
        table: "customers",
        pkTuples: batch,
        relationIds: [ordersRelForPreview!.id],
      });
      for (const c of counts) total += c.count;
    }
    expect(total).toBe(9000);

    // 6p.3 — a PK that doesn't exist gets count 0 (not omitted).
    const withMiss = await caller.data.getCountsForRows({
      connectionId: profile.id,
      schema: "public",
      table: "customers",
      pkTuples: [[1], [99999]],
      relationIds: [ordersRelForPreview!.id],
    });
    expect(withMiss).toHaveLength(2);
    const missEntry = withMiss.find(
      (e) => Array.isArray(e.pkTuple) && e.pkTuple[0] === 99999,
    );
    expect(missEntry?.count).toBe(0);
    expect(missEntry?.estimated).toBe(false);

    // 6p.4 — unknown relation IDs are silently skipped (no throw, no entry).
    const noisy = await caller.data.getCountsForRows({
      connectionId: profile.id,
      schema: "public",
      table: "customers",
      pkTuples: [[1]],
      relationIds: [ordersRelForPreview!.id, "rel_does_not_exist_x".padEnd(26, "0")],
    });
    expect(noisy.filter((e) => e.relationId === ordersRelForPreview!.id)).toHaveLength(1);
    expect(noisy.find((e) => e.relationId !== ordersRelForPreview!.id)).toBeUndefined();

    // 7. Disconnect — the adapter must release its pool so the test process
    //    can exit cleanly.
    await caller.connections.disconnect({ connectionId: profile.id });
  }, 60_000);
});
