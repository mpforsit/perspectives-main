import { describe, expect, it } from "vitest";

import { validateRelation } from "@perspectives/dsl";

import {
  deriveSchemaRelations,
  deterministicRelationId,
  relationScopeKey,
} from "../src";
import type { SchemaSnapshot } from "../src";

const NOW = "2026-06-11T00:00:00.000Z";

/**
 * Hand-built snapshot fixtures exercising the three FK shapes Phase 2 must
 * handle (simple, compound, self-referential) plus a 1:1 case. These are
 * what unit-tests assert against; the seeded-container integration test in
 * apps/desktop covers the introspector-to-derivation pipeline end-to-end.
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
              { name: "email", dataType: "text", jsType: "string", nullable: false, position: 2 },
            ],
            foreignKeys: [],
            indexes: [
              { name: "customers_pk", schema: "public", table: "customers", columns: ["id"], unique: true, isPrimary: true },
              { name: "customers_email_uk", schema: "public", table: "customers", columns: ["email"], unique: true, isPrimary: false },
            ],
          },
          {
            schema: "public",
            name: "orders",
            kind: "table",
            primaryKey: ["id"],
            columns: [
              { name: "id", dataType: "int8", jsType: "bigint", nullable: false, position: 1 },
              { name: "customer_id", dataType: "int8", jsType: "bigint", nullable: false, position: 2 },
            ],
            foreignKeys: [
              {
                name: "orders_customer_fk",
                from: { schema: "public", table: "orders", columns: ["customer_id"] },
                to: { schema: "public", table: "customers", columns: ["id"] },
              },
            ],
            indexes: [
              { name: "orders_pk", schema: "public", table: "orders", columns: ["id"], unique: true, isPrimary: true },
            ],
          },
          {
            schema: "public",
            name: "employees",
            kind: "table",
            primaryKey: ["id"],
            columns: [
              { name: "id", dataType: "int4", jsType: "number", nullable: false, position: 1 },
              { name: "manager_id", dataType: "int4", jsType: "number", nullable: true, position: 2 },
            ],
            foreignKeys: [
              {
                name: "employees_manager_fk",
                from: { schema: "public", table: "employees", columns: ["manager_id"] },
                to: { schema: "public", table: "employees", columns: ["id"] },
              },
            ],
            indexes: [
              { name: "employees_pk", schema: "public", table: "employees", columns: ["id"], unique: true, isPrimary: true },
            ],
          },
          {
            schema: "public",
            name: "warehouses",
            kind: "table",
            primaryKey: ["tenant_id", "code"],
            columns: [
              { name: "tenant_id", dataType: "int4", jsType: "number", nullable: false, position: 1 },
              { name: "code", dataType: "text", jsType: "string", nullable: false, position: 2 },
            ],
            foreignKeys: [],
            indexes: [
              { name: "warehouses_pk", schema: "public", table: "warehouses", columns: ["tenant_id", "code"], unique: true, isPrimary: true },
            ],
          },
          {
            schema: "public",
            name: "inventory",
            kind: "table",
            primaryKey: ["id"],
            columns: [
              { name: "id", dataType: "int8", jsType: "bigint", nullable: false, position: 1 },
              { name: "tenant_id", dataType: "int4", jsType: "number", nullable: false, position: 2 },
              { name: "warehouse_code", dataType: "text", jsType: "string", nullable: false, position: 3 },
            ],
            foreignKeys: [
              {
                name: "inventory_warehouse_fk",
                from: { schema: "public", table: "inventory", columns: ["tenant_id", "warehouse_code"] },
                to: { schema: "public", table: "warehouses", columns: ["tenant_id", "code"] },
              },
            ],
            indexes: [
              { name: "inventory_pk", schema: "public", table: "inventory", columns: ["id"], unique: true, isPrimary: true },
            ],
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
            // PK = customer_id, which IS the FK column → 1:1 case.
            foreignKeys: [
              {
                name: "addresses_customer_fk",
                from: { schema: "public", table: "addresses", columns: ["customer_id"] },
                to: { schema: "public", table: "customers", columns: ["id"] },
              },
            ],
            indexes: [
              { name: "addresses_pk", schema: "public", table: "addresses", columns: ["customer_id"], unique: true, isPrimary: true },
            ],
          },
        ],
      },
    ],
  };
}

describe("deterministicRelationId", () => {
  it("emits 26 chars from the Crockford alphabet (passes the DSL's ULID regex)", () => {
    const id = deterministicRelationId("x");
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("is deterministic for the same input", () => {
    expect(deterministicRelationId("hello")).toBe(deterministicRelationId("hello"));
  });

  it("changes when the input changes", () => {
    expect(deterministicRelationId("a")).not.toBe(deterministicRelationId("b"));
  });
});

describe("deriveSchemaRelations", () => {
  const relations = deriveSchemaRelations(snapshot(), { now: NOW });

  it("emits one RelationDef per FK (4 in this fixture: orders, employees, inventory, addresses)", () => {
    expect(relations.length).toBe(4);
  });

  it("every derived id passes validateRelation (round-trips through the DSL)", () => {
    for (const r of relations) {
      const result = validateRelation(r);
      if (!result.ok) {
        throw new Error(
          `RelationDef ${r.id} failed DSL validation: ${JSON.stringify(result.errors.issues)}`,
        );
      }
    }
  });

  it("preserves compound-FK column order on both sides", () => {
    const inventoryRel = relations.find(
      (r) => r.from.table === "inventory" && r.to.table === "warehouses",
    );
    expect(inventoryRel).toBeDefined();
    expect(inventoryRel?.from.columns).toEqual(["tenant_id", "warehouse_code"]);
    expect(inventoryRel?.to.columns).toEqual(["tenant_id", "code"]);
  });

  it("represents self-referential FKs with the same table on both sides", () => {
    const selfRel = relations.find(
      (r) => r.from.table === "employees" && r.to.table === "employees",
    );
    expect(selfRel).toBeDefined();
    expect(selfRel?.from.columns).toEqual(["manager_id"]);
    expect(selfRel?.to.columns).toEqual(["id"]);
    expect(selfRel?.cardinality).toBe("one-to-many");
  });

  it("marks an FK whose source columns are themselves unique as one-to-one", () => {
    // addresses.customer_id IS the PK of addresses → 1:1 with customers.
    const oneOne = relations.find((r) => r.from.table === "addresses");
    expect(oneOne?.cardinality).toBe("one-to-one");
  });

  it("marks an FK whose source columns are NOT unique as one-to-many", () => {
    const oneMany = relations.find(
      (r) => r.from.table === "orders" && r.to.table === "customers",
    );
    expect(oneMany?.cardinality).toBe("one-to-many");
  });

  it("returns identical output for two runs over the same snapshot (id stability)", () => {
    const a = deriveSchemaRelations(snapshot(), { now: NOW });
    const b = deriveSchemaRelations(snapshot(), { now: NOW });
    expect(a).toEqual(b);
  });

  it("returns a different id if the FK column order changes (compound shape sensitivity)", () => {
    const baseline = relations.find((r) => r.from.table === "inventory")?.id;
    const swapped = snapshot();
    const inv = swapped.schemas[0]?.tables.find((t) => t.name === "inventory");
    const fk = inv?.foreignKeys[0];
    if (fk === undefined) throw new Error("inventory FK missing in fixture");
    fk.from.columns = ["warehouse_code", "tenant_id"];
    fk.to.columns = ["code", "tenant_id"];
    const swappedRels = deriveSchemaRelations(swapped, { now: NOW });
    const swappedId = swappedRels.find((r) => r.from.table === "inventory")?.id;
    expect(baseline).toBeDefined();
    expect(swappedId).toBeDefined();
    expect(swappedId).not.toBe(baseline);
  });
});

describe("relationScopeKey", () => {
  it("namespaces by dialect, host, port, database", () => {
    expect(
      relationScopeKey({
        dialect: "postgres",
        host: "db.example.com",
        port: 5432,
        database: "perspectives_dev",
      }),
    ).toBe("postgres://db.example.com:5432/perspectives_dev");
  });

  it("lowercases dialect and host (DNS isn't case-sensitive)", () => {
    expect(
      relationScopeKey({
        dialect: "POSTGRES",
        host: "DB.Example.COM",
        port: 5432,
        database: "MyDB",
      }),
    ).toBe("postgres://db.example.com:5432/MyDB");
  });

  it("does NOT lowercase the database (Postgres database names are case-sensitive)", () => {
    const a = relationScopeKey({ dialect: "postgres", host: "h", port: 1, database: "MyDB" });
    const b = relationScopeKey({ dialect: "postgres", host: "h", port: 1, database: "mydb" });
    expect(a).not.toBe(b);
  });
});
