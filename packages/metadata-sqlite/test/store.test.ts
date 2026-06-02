import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ValidationError, type ConnectionProfile } from "@perspectives/engine";
import type { PerspectiveDef, RelationDef } from "@perspectives/dsl";

import {
  InMemoryCredentialStore,
  SqliteMetadataStore,
} from "../src";

const NOW = "2026-05-29T08:00:00.000Z";

function makeProfile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: "conn_01",
    name: "Local test",
    dialect: "postgres",
    host: "localhost",
    port: 5432,
    database: "perspectives_dev",
    user: "perspectives",
    password: "PrettyPlease!",
    environment: "development",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const ULID = "01J9X2KZQ5N7P3VCM8B4ETRGYH";

function makePerspective(overrides: Partial<PerspectiveDef> = {}): PerspectiveDef {
  return {
    id: ULID,
    name: "Active customers",
    base: { kind: "table", schema: "public", table: "customers" },
    columns: [{ source: { column: "id" } }],
    sort: [],
    filters: { op: "and", children: [] },
    filterBar: { visible: [], collapsed: [] },
    createdBy: "user_test",
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}

function makeRelation(overrides: Partial<RelationDef> = {}): RelationDef {
  return {
    id: "01J9X2KZQ5N7P3VCM8B4ETRGYJ",
    from: { schema: "public", table: "customers", columns: ["id"] },
    to: { schema: "public", table: "orders", columns: ["customer_id"] },
    cardinality: "one-to-many",
    source: "schema",
    displayDirection: "both",
    updatedAt: NOW,
    ...overrides,
  };
}

describe("SqliteMetadataStore — connections CRUD", () => {
  let store: SqliteMetadataStore;

  beforeEach(() => {
    store = new SqliteMetadataStore({
      filePath: ":memory:",
      credentialStore: new InMemoryCredentialStore(),
      now: () => NOW,
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("round-trips a profile through create → get and restores the password from the credential store", async () => {
    const profile = makeProfile({ password: "the-real-secret" });
    const created = await store.connections.create(profile);
    expect(created).toEqual(profile);

    const fetched = await store.connections.get(profile.id);
    expect(fetched).toEqual(profile);
    expect(fetched?.password).toBe("the-real-secret");
  });

  it("list returns the saved profiles with passwords reattached", async () => {
    const a = makeProfile({ id: "a", name: "A", password: "pa" });
    const b = makeProfile({
      id: "b",
      name: "B",
      password: "pb",
      createdAt: "2026-05-30T00:00:00.000Z",
    });
    await store.connections.create(a);
    await store.connections.create(b);

    const profiles = await store.connections.list();
    const sorted = profiles.sort((x, y) => x.id.localeCompare(y.id));
    expect(sorted[0]?.password).toBe("pa");
    expect(sorted[1]?.password).toBe("pb");
  });

  it("update changes fields and rewrites the password", async () => {
    const profile = makeProfile({ password: "initial" });
    await store.connections.create(profile);

    const next: ConnectionProfile = {
      ...profile,
      name: "Renamed",
      password: "rotated",
      updatedAt: "2026-05-30T00:00:00.000Z",
    };
    await store.connections.update(profile.id, next);

    const fetched = await store.connections.get(profile.id);
    expect(fetched?.name).toBe("Renamed");
    expect(fetched?.password).toBe("rotated");
  });

  it("delete removes both the row and the credential", async () => {
    const profile = makeProfile();
    await store.connections.create(profile);
    await store.connections.delete(profile.id);
    expect(await store.connections.get(profile.id)).toBeNull();
  });

  it("rejects profiles with an invalid port", async () => {
    await expect(
      store.connections.create(makeProfile({ port: 0 })),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("SqliteMetadataStore — settings KV", () => {
  let store: SqliteMetadataStore;

  beforeEach(() => {
    store = new SqliteMetadataStore({
      filePath: ":memory:",
      credentialStore: new InMemoryCredentialStore(),
      now: () => NOW,
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("round-trips primitives, arrays, and nested objects through JSON", async () => {
    await store.settings.set("theme", "dark");
    await store.settings.set("history", [1, 2, 3]);
    await store.settings.set("layout", { sidebar: "left", width: 240 });

    expect(await store.settings.get<string>("theme")).toBe("dark");
    expect(await store.settings.get<number[]>("history")).toEqual([1, 2, 3]);
    expect(await store.settings.get<{ sidebar: string; width: number }>("layout"))
      .toEqual({ sidebar: "left", width: 240 });
  });

  it("returns null for missing keys", async () => {
    expect(await store.settings.get("missing")).toBeNull();
  });

  it("delete and keys-with-prefix work as expected", async () => {
    await store.settings.set("ui:theme", "dark");
    await store.settings.set("ui:density", "compact");
    await store.settings.set("net:proxy", "localhost:8080");

    expect((await store.settings.keys()).sort()).toEqual([
      "net:proxy",
      "ui:density",
      "ui:theme",
    ]);
    expect((await store.settings.keys("ui:")).sort()).toEqual([
      "ui:density",
      "ui:theme",
    ]);

    await store.settings.delete("ui:density");
    expect(await store.settings.get("ui:density")).toBeNull();
  });
});

describe("SqliteMetadataStore — DSL validation", () => {
  let store: SqliteMetadataStore;

  beforeEach(() => {
    store = new SqliteMetadataStore({
      filePath: ":memory:",
      credentialStore: new InMemoryCredentialStore(),
      now: () => NOW,
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("rejects a perspective with an invalid ULID id", async () => {
    const bad = makePerspective({ id: "not-a-ulid" });
    await expect(store.perspectives.create(bad)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a perspective missing a required field", async () => {
    // Strip `name` to force a Zod error.
    const { name: _name, ...rest } = makePerspective();
    await expect(
      store.perspectives.create(rest as unknown as PerspectiveDef),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts a valid perspective and round-trips it", async () => {
    const p = makePerspective();
    const created = await store.perspectives.create(p);
    expect(created.id).toBe(p.id);
    const back = await store.perspectives.get(p.id);
    expect(back).toEqual(p);
  });

  it("surfaces a typed error when the stored JSON is corrupted", async () => {
    const p = makePerspective();
    await store.perspectives.create(p);

    // Reach past the public API to simulate corruption (a bit-rot row, a
    // hand-edited file). The next read should raise ValidationError, not
    // return a malformed object.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only escape hatch
    const db = (store as any).db as import("better-sqlite3").Database;
    db.prepare(`UPDATE perspectives SET payload = ? WHERE id = ?`).run(
      JSON.stringify({ ...p, version: 99 }),
      p.id,
    );

    await expect(store.perspectives.get(p.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("round-trips a RelationDef", async () => {
    const r = makeRelation();
    await store.relations.create(r);
    const back = await store.relations.get(r.id);
    expect(back).toEqual(r);
  });
});
