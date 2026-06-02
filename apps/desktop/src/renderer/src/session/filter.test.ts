import { describe, expect, it } from "vitest";

import type { SchemaSnapshot } from "@perspectives/engine";

import { filterSchema } from "./filter";

function table(schema: string, name: string) {
  return {
    schema,
    name,
    kind: "table" as const,
    columns: [],
    foreignKeys: [],
    indexes: [],
  };
}

function view(schema: string, name: string) {
  return { schema, name, columns: [] };
}

const SAMPLE: SchemaSnapshot = {
  fetchedAt: "2026-06-01T00:00:00Z",
  schemas: [
    {
      name: "public",
      tables: [
        table("public", "customers"),
        table("public", "orders"),
        table("public", "order_items"),
      ],
      views: [view("public", "active_customers")],
    },
    {
      name: "inventory",
      tables: [table("inventory", "products"), table("inventory", "warehouses")],
    },
    {
      name: "analytics",
      tables: [table("analytics", "events")],
    },
  ],
};

describe("filterSchema", () => {
  it("returns the snapshot unchanged when the query is empty", () => {
    expect(filterSchema(SAMPLE, "")).toEqual(SAMPLE);
  });

  it("trims whitespace — a query of only spaces is treated as empty", () => {
    expect(filterSchema(SAMPLE, "    ")).toEqual(SAMPLE);
  });

  it("matches table names case-insensitively", () => {
    const result = filterSchema(SAMPLE, "CUSTOMERS");
    expect(result.schemas.map((s) => s.name)).toEqual(["public"]);
    expect(result.schemas[0]?.tables.map((t) => t.name)).toEqual(["customers"]);
  });

  it("matches partial substrings", () => {
    const result = filterSchema(SAMPLE, "ord");
    expect(result.schemas[0]?.tables.map((t) => t.name)).toEqual([
      "orders",
      "order_items",
    ]);
  });

  it("drops schemas with no matching items", () => {
    const result = filterSchema(SAMPLE, "warehouses");
    expect(result.schemas.map((s) => s.name)).toEqual(["inventory"]);
    expect(result.schemas[0]?.tables.map((t) => t.name)).toEqual(["warehouses"]);
  });

  it("returns an empty schemas array when nothing matches", () => {
    const result = filterSchema(SAMPLE, "nonexistent");
    expect(result.schemas).toEqual([]);
  });

  it("matches views, not just tables", () => {
    const result = filterSchema(SAMPLE, "active");
    expect(result.schemas[0]?.tables).toEqual([]);
    expect(result.schemas[0]?.views?.map((v) => v.name)).toEqual([
      "active_customers",
    ]);
  });

  it("drops the views key when no views match in a kept schema", () => {
    const result = filterSchema(SAMPLE, "orders");
    // `public` matches via tables but its only view ("active_customers")
    // doesn't match — `views` should be absent rather than [].
    expect(result.schemas[0]?.views).toBeUndefined();
  });

  it("keeps every item under a schema when the schema name itself matches", () => {
    const result = filterSchema(SAMPLE, "inventory");
    expect(result.schemas.map((s) => s.name)).toEqual(["inventory"]);
    expect(result.schemas[0]?.tables.map((t) => t.name)).toEqual([
      "products",
      "warehouses",
    ]);
  });

  it("does not mutate the input snapshot", () => {
    const before = JSON.stringify(SAMPLE);
    filterSchema(SAMPLE, "ord");
    expect(JSON.stringify(SAMPLE)).toBe(before);
  });
});
