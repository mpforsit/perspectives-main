import { describe, expect, it } from "vitest";

import type { RelationDef } from "@perspectives/engine";

import { buildReferencingTarget, pickRowValues } from "./inspector";

const NOW = "2026-06-17T00:00:00.000Z";

function oneToMany(): RelationDef {
  // orders.customer_id → customers.id
  return {
    id: "01J9X2KZQ5N7P3VCM8B41NORDER",
    from: { schema: "public", table: "orders", columns: ["customer_id"] },
    to: { schema: "public", table: "customers", columns: ["id"] },
    cardinality: "one-to-many",
    source: "schema",
    displayDirection: "both",
    updatedAt: NOW,
  };
}

function compoundOneToMany(): RelationDef {
  // inventory(tenant_id, warehouse_code) → warehouses(tenant_id, code)
  return {
    id: "01J9X2KZQ5N7P3VCM8B41INVTRY",
    from: {
      schema: "public",
      table: "inventory",
      columns: ["tenant_id", "warehouse_code"],
    },
    to: {
      schema: "public",
      table: "warehouses",
      columns: ["tenant_id", "code"],
    },
    cardinality: "one-to-many",
    source: "schema",
    displayDirection: "both",
    updatedAt: NOW,
  };
}

function manyToMany(): RelationDef {
  // m:n customers ↔ tags via customer_tags
  return {
    id: "01J9X2KZQ5N7P3VCM8B41M2NCTG",
    from: { schema: "public", table: "customers", columns: ["id"] },
    to: { schema: "public", table: "tags", columns: ["id"] },
    junction: {
      schema: "public",
      table: "customer_tags",
      fromCols: ["customer_id"],
      toCols: ["tag_id"],
    },
    cardinality: "many-to-many",
    source: "schema",
    displayDirection: "both",
    updatedAt: NOW,
  };
}

describe("buildReferencingTarget — 1:n inbound", () => {
  it("filters the child table by values from the focused row", () => {
    const t = buildReferencingTarget(oneToMany(), "public", "customers", {
      id: 42,
    });
    expect(t?.schema).toBe("public");
    expect(t?.table).toBe("orders");
    expect(t?.filter).toEqual({
      op: "and",
      children: [{ column: "customer_id", op: "eq", value: 42 }],
    });
    expect(t?.caption).toContain("orders");
  });

  it("returns null when the focused table isn't on the `to` side", () => {
    const t = buildReferencingTarget(oneToMany(), "public", "orders", {
      id: 42,
    });
    expect(t).toBeNull();
  });

  it("preserves compound-FK column order in the filter", () => {
    const t = buildReferencingTarget(
      compoundOneToMany(),
      "public",
      "warehouses",
      { tenant_id: 1, code: "A1" },
    );
    expect(t?.table).toBe("inventory");
    expect(t?.filter.children).toEqual([
      { column: "tenant_id", op: "eq", value: 1 },
      { column: "warehouse_code", op: "eq", value: "A1" },
    ]);
  });

  it("looks up values by column name, so PK declaration order doesn't matter", () => {
    // Same outcome whether `rowValues` was assembled in PK order or any
    // other order — we look up by name.
    const t = buildReferencingTarget(
      compoundOneToMany(),
      "public",
      "warehouses",
      { code: "A1", tenant_id: 1 },
    );
    expect(t?.filter.children).toEqual([
      { column: "tenant_id", op: "eq", value: 1 },
      { column: "warehouse_code", op: "eq", value: "A1" },
    ]);
  });

  it("returns null when a target column is missing from the row (e.g. non-primitive in the row, filtered out)", () => {
    const t = buildReferencingTarget(oneToMany(), "public", "customers", {
      // id is missing — non-primitive original or just not in the snapshot
      email: "a@b.c",
    });
    expect(t).toBeNull();
  });

  it("works for a custom relation that targets a UNIQUE non-PK column", () => {
    const customRel: RelationDef = {
      id: "01J9X2KZQ5N7P3VCM8B41CUSTM2",
      from: { schema: "public", table: "orders", columns: ["status"] },
      to: { schema: "public", table: "customers", columns: ["email"] },
      cardinality: "one-to-many",
      source: "custom",
      displayDirection: "both",
      updatedAt: NOW,
    };
    const t = buildReferencingTarget(customRel, "public", "customers", {
      id: 7,
      email: "customer7@example.com",
    });
    expect(t?.table).toBe("orders");
    expect(t?.filter).toEqual({
      op: "and",
      children: [
        { column: "status", op: "eq", value: "customer7@example.com" },
      ],
    });
  });
});

describe("buildReferencingTarget — m:n via junction", () => {
  it("focused on `from` side: filter the junction by fromCols", () => {
    const t = buildReferencingTarget(manyToMany(), "public", "customers", {
      id: 42,
    });
    expect(t?.schema).toBe("public");
    expect(t?.table).toBe("customer_tags");
    expect(t?.filter).toEqual({
      op: "and",
      children: [{ column: "customer_id", op: "eq", value: 42 }],
    });
    expect(t?.caption).toContain("tags");
  });

  it("focused on `to` side: filter the junction by toCols", () => {
    const t = buildReferencingTarget(manyToMany(), "public", "tags", { id: 7 });
    expect(t?.table).toBe("customer_tags");
    expect(t?.filter).toEqual({
      op: "and",
      children: [{ column: "tag_id", op: "eq", value: 7 }],
    });
  });

  it("returns null when the focused table isn't on either side of the m:n", () => {
    const t = buildReferencingTarget(manyToMany(), "public", "orders", {
      id: 1,
    });
    expect(t).toBeNull();
  });
});

describe("buildReferencingTarget — value passthrough", () => {
  it("threads null through (focused PK columns are NOT NULL in practice, but the type allows it)", () => {
    const t = buildReferencingTarget(oneToMany(), "public", "customers", {
      id: null,
    });
    expect(t?.filter.children[0]).toMatchObject({ value: null });
  });
});

describe("pickRowValues", () => {
  it("keeps string / number / boolean / null entries", () => {
    expect(
      pickRowValues({
        id: 7,
        full_name: "Ada",
        is_active: true,
        last_login_at: null,
      }),
    ).toEqual({
      id: 7,
      full_name: "Ada",
      is_active: true,
      last_login_at: null,
    });
  });

  it("drops Date / Buffer / array / object / bigint values", () => {
    expect(
      pickRowValues({
        id: 7,
        created_at: new Date("2026-06-17T00:00:00Z"),
        avatar: new Uint8Array([1, 2, 3]),
        tags: ["beta", "vip"],
        meta: { score: 9 },
        big: 1n,
      }),
    ).toEqual({ id: 7 });
  });
});
