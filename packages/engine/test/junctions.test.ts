import { describe, expect, it } from "vitest";

import { validateRelation } from "@perspectives/dsl";

import {
  detectJunctions,
  deriveSchemaRelations,
  matchesJunctionHeuristic,
  tableKey,
  type JunctionPolicyMap,
  type SchemaSnapshot,
  type TableInfo,
} from "../src";

const NOW = "2026-06-15T00:00:00.000Z";

/**
 * Hand-built fixture with three candidates:
 *   - `customer_tags` (customer_id, tag_id): true junction.
 *   - `order_items` (order_id, product_id, quantity, unit_price): has extra
 *     non-FK columns; must NOT be detected. `inventory` from the real seed
 *     has the same trap (quantity column), but we mirror the prompt's
 *     example here.
 *   - `addresses` (customer_id PK + line1): only one FK, not a junction.
 */
function snapshot(): SchemaSnapshot {
  return {
    fetchedAt: NOW,
    schemas: [
      {
        name: "public",
        tables: [
          {
            schema: "public",
            name: "customers",
            kind: "table",
            primaryKey: ["id"],
            columns: [
              { name: "id", dataType: "int8", jsType: "bigint", nullable: false, position: 1 },
            ],
            foreignKeys: [],
            indexes: [{ name: "customers_pk", schema: "public", table: "customers", columns: ["id"], unique: true, isPrimary: true }],
          },
          {
            schema: "public",
            name: "tags",
            kind: "table",
            primaryKey: ["id"],
            columns: [
              { name: "id", dataType: "int8", jsType: "bigint", nullable: false, position: 1 },
            ],
            foreignKeys: [],
            indexes: [{ name: "tags_pk", schema: "public", table: "tags", columns: ["id"], unique: true, isPrimary: true }],
          },
          {
            schema: "public",
            name: "products",
            kind: "table",
            primaryKey: ["id"],
            columns: [
              { name: "id", dataType: "int8", jsType: "bigint", nullable: false, position: 1 },
            ],
            foreignKeys: [],
            indexes: [{ name: "products_pk", schema: "public", table: "products", columns: ["id"], unique: true, isPrimary: true }],
          },
          {
            schema: "public",
            name: "orders",
            kind: "table",
            primaryKey: ["id"],
            columns: [
              { name: "id", dataType: "int8", jsType: "bigint", nullable: false, position: 1 },
            ],
            foreignKeys: [],
            indexes: [{ name: "orders_pk", schema: "public", table: "orders", columns: ["id"], unique: true, isPrimary: true }],
          },
          {
            schema: "public",
            name: "customer_tags",
            kind: "table",
            primaryKey: ["customer_id", "tag_id"],
            columns: [
              { name: "customer_id", dataType: "int8", jsType: "bigint", nullable: false, position: 1 },
              { name: "tag_id", dataType: "int8", jsType: "bigint", nullable: false, position: 2 },
              { name: "created_at", dataType: "timestamptz", jsType: "datetime", nullable: false, position: 3 },
            ],
            foreignKeys: [
              {
                name: "customer_tags_customer_fk",
                from: { schema: "public", table: "customer_tags", columns: ["customer_id"] },
                to: { schema: "public", table: "customers", columns: ["id"] },
              },
              {
                name: "customer_tags_tag_fk",
                from: { schema: "public", table: "customer_tags", columns: ["tag_id"] },
                to: { schema: "public", table: "tags", columns: ["id"] },
              },
            ],
            indexes: [{ name: "customer_tags_pk", schema: "public", table: "customer_tags", columns: ["customer_id", "tag_id"], unique: true, isPrimary: true }],
          },
          {
            schema: "public",
            name: "order_items",
            kind: "table",
            primaryKey: ["order_id", "product_id"],
            columns: [
              { name: "order_id", dataType: "int8", jsType: "bigint", nullable: false, position: 1 },
              { name: "product_id", dataType: "int8", jsType: "bigint", nullable: false, position: 2 },
              // Extra non-FK, non-audit columns disqualify this from
              // junction status — it's a first-class entity.
              { name: "quantity", dataType: "int4", jsType: "number", nullable: false, position: 3 },
              { name: "unit_price", dataType: "numeric", jsType: "number", nullable: false, position: 4 },
            ],
            foreignKeys: [
              {
                name: "order_items_order_fk",
                from: { schema: "public", table: "order_items", columns: ["order_id"] },
                to: { schema: "public", table: "orders", columns: ["id"] },
              },
              {
                name: "order_items_product_fk",
                from: { schema: "public", table: "order_items", columns: ["product_id"] },
                to: { schema: "public", table: "products", columns: ["id"] },
              },
            ],
            indexes: [{ name: "order_items_pk", schema: "public", table: "order_items", columns: ["order_id", "product_id"], unique: true, isPrimary: true }],
          },
          {
            schema: "public",
            name: "addresses",
            kind: "table",
            primaryKey: ["customer_id"],
            columns: [
              { name: "customer_id", dataType: "int8", jsType: "bigint", nullable: false, position: 1 },
              { name: "line1", dataType: "text", jsType: "string", nullable: false, position: 2 },
            ],
            foreignKeys: [
              {
                name: "addresses_customer_fk",
                from: { schema: "public", table: "addresses", columns: ["customer_id"] },
                to: { schema: "public", table: "customers", columns: ["id"] },
              },
            ],
            indexes: [{ name: "addresses_pk", schema: "public", table: "addresses", columns: ["customer_id"], unique: true, isPrimary: true }],
          },
        ],
      },
    ],
  };
}

function runDetect(snap = snapshot(), policies?: JunctionPolicyMap) {
  const schemaRelations = deriveSchemaRelations(snap, { now: NOW });
  const opts = policies === undefined
    ? { schemaRelations, now: NOW }
    : { schemaRelations, now: NOW, policies };
  return detectJunctions(snap, opts);
}

describe("matchesJunctionHeuristic", () => {
  it("accepts a two-FK PK-covering table with only audit extras", () => {
    const t = snapshot().schemas[0]!.tables.find((t) => t.name === "customer_tags")!;
    expect(matchesJunctionHeuristic(t)).toBe(true);
  });

  it("rejects a table with extra non-FK, non-audit columns (order_items / quantity trap)", () => {
    const t = snapshot().schemas[0]!.tables.find((t) => t.name === "order_items")!;
    expect(matchesJunctionHeuristic(t)).toBe(false);
  });

  it("rejects a single-FK table (addresses)", () => {
    const t = snapshot().schemas[0]!.tables.find((t) => t.name === "addresses")!;
    expect(matchesJunctionHeuristic(t)).toBe(false);
  });

  it("rejects a two-FK table when neither PK nor any unique constraint covers the FK columns", () => {
    const t = snapshot().schemas[0]!.tables.find((t) => t.name === "customer_tags")!;
    const tampered: TableInfo = {
      ...t,
      primaryKey: ["customer_id"], // PK no longer covers (customer_id, tag_id)
      indexes: [], // no unique index covering the FK pair either
    };
    expect(matchesJunctionHeuristic(tampered)).toBe(false);
  });

  it("accepts a unique-constraint-backed junction (no PK)", () => {
    const t = snapshot().schemas[0]!.tables.find((t) => t.name === "customer_tags")!;
    const noPk: TableInfo = {
      ...t,
      primaryKey: undefined,
      indexes: [{ name: "customer_tags_uk", schema: "public", table: "customer_tags", columns: ["customer_id", "tag_id"], unique: true, isPrimary: false }],
    };
    expect(matchesJunctionHeuristic(noPk)).toBe(true);
  });
});

describe("detectJunctions", () => {
  it("detects customer_tags as a junction between customers and tags", () => {
    const result = runDetect();
    const info = result.get(tableKey("public", "customer_tags"));
    expect(info).toBeDefined();
    expect(info?.junction).toEqual({ schema: "public", table: "customer_tags" });
    expect(info?.m2n.cardinality).toBe("many-to-many");
    expect(info?.m2n.from).toMatchObject({ schema: "public", table: "customers" });
    expect(info?.m2n.to).toMatchObject({ schema: "public", table: "tags" });
    expect(info?.m2n.junction?.fromCols).toEqual(["customer_id"]);
    expect(info?.m2n.junction?.toCols).toEqual(["tag_id"]);
    expect(info?.reason).toBe("heuristic");
  });

  it("does NOT misclassify order_items (extra columns)", () => {
    const result = runDetect();
    expect(result.get(tableKey("public", "order_items"))).toBeUndefined();
  });

  it("emits m:n RelationDefs that pass validateRelation", () => {
    const result = runDetect();
    for (const info of result.values()) {
      const out = validateRelation(info.m2n);
      if (!out.ok) {
        throw new Error(
          `m:n ${info.m2n.id} failed validation: ${JSON.stringify(out.errors.issues)}`,
        );
      }
    }
  });

  it("emits an m:n id in 26-char Crockford base32 (ULID regex)", () => {
    const result = runDetect();
    for (const info of result.values()) {
      expect(info.m2n.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });

  it("emits the same m:n id across two detection runs (stability)", () => {
    const a = runDetect();
    const b = runDetect();
    const aId = a.get(tableKey("public", "customer_tags"))?.m2n.id;
    const bId = b.get(tableKey("public", "customer_tags"))?.m2n.id;
    expect(aId).toBeDefined();
    expect(aId).toBe(bId);
  });

  it("respects policy=never to suppress detected junctions", () => {
    const policies = new Map([["public.customer_tags", "never" as const]]);
    const result = runDetect(snapshot(), policies);
    expect(result.get(tableKey("public", "customer_tags"))).toBeUndefined();
  });

  it("respects policy=always to force junction treatment on a heuristic near-miss", () => {
    const policies = new Map([["public.order_items", "always" as const]]);
    const result = runDetect(snapshot(), policies);
    const info = result.get(tableKey("public", "order_items"));
    expect(info).toBeDefined();
    expect(info?.reason).toBe("policy-always");
    expect(info?.m2n.cardinality).toBe("many-to-many");
    expect(info?.m2n.from).toMatchObject({ table: "orders" });
    expect(info?.m2n.to).toMatchObject({ table: "products" });
  });

  it("doesn't force junction on a single-FK table even with policy=always (shape can't support m:n)", () => {
    const policies = new Map([["public.addresses", "always" as const]]);
    const result = runDetect(snapshot(), policies);
    // Only 1 FK → can't synthesise an m:n. Detection skips it without
    // crashing.
    expect(result.get(tableKey("public", "addresses"))).toBeUndefined();
  });

  it("emits both reason='both' when heuristic matches AND policy=always", () => {
    const policies = new Map([["public.customer_tags", "always" as const]]);
    const result = runDetect(snapshot(), policies);
    expect(result.get(tableKey("public", "customer_tags"))?.reason).toBe("both");
  });
});
