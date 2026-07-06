import { describe, expect, it } from "vitest";

import type { RelationDef, SchemaSnapshot } from "@perspectives/engine";

import {
  isDraftValid,
  validateCustomRelationDraft,
  type CustomRelationDraft,
} from "./validate";

const NOW = "2026-06-17T00:00:00.000Z";

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
              { name: "country_code", dataType: "text", jsType: "string", nullable: true, position: 3 },
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
              { name: "shipping_country", dataType: "text", jsType: "string", nullable: true, position: 3 },
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
            name: "countries",
            kind: "table",
            primaryKey: ["code"],
            columns: [
              { name: "code", dataType: "text", jsType: "string", nullable: false, position: 1 },
              { name: "name", dataType: "text", jsType: "string", nullable: false, position: 2 },
            ],
            foreignKeys: [],
            indexes: [
              { name: "countries_pk", schema: "public", table: "countries", columns: ["code"], unique: true, isPrimary: true },
            ],
          },
        ],
      },
    ],
  };
}

function blank(): CustomRelationDraft {
  return {
    fromSchema: "",
    fromTable: "",
    fromColumns: [],
    toSchema: "",
    toTable: "",
    toColumns: [],
    cardinality: "one-to-many",
    labelForward: "",
    labelReverse: "",
    displayDirection: "both",
  };
}

function happyPath(): CustomRelationDraft {
  return {
    fromSchema: "public",
    fromTable: "orders",
    fromColumns: ["shipping_country"],
    toSchema: "public",
    toTable: "countries",
    toColumns: ["code"],
    cardinality: "one-to-many",
    labelForward: "",
    labelReverse: "",
    displayDirection: "both",
  };
}

const schemaDerivedOrdersCustomer: RelationDef = {
  id: "01J9X2KZQ5N7P3VCM8B49ORDCST",
  from: { schema: "public", table: "orders", columns: ["customer_id"] },
  to: { schema: "public", table: "customers", columns: ["id"] },
  cardinality: "one-to-many",
  source: "schema",
  displayDirection: "both",
  updatedAt: NOW,
};

describe("validateCustomRelationDraft — empty / partial drafts", () => {
  it("flags an empty draft with the obvious issues", () => {
    const issues = validateCustomRelationDraft(blank(), snapshot(), []);
    const kinds = issues.map((i) => i.kind);
    expect(kinds).toContain("no-source-table");
    expect(kinds).toContain("no-target-table");
    expect(kinds).toContain("no-source-columns");
    expect(kinds).toContain("no-target-columns");
  });

  it("flags column-count mismatch when sides differ in length", () => {
    const draft = {
      ...happyPath(),
      fromColumns: ["shipping_country", "id"],
    };
    const issues = validateCustomRelationDraft(draft, snapshot(), []);
    expect(issues).toContainEqual({
      kind: "column-count-mismatch",
      sourceCount: 2,
      targetCount: 1,
    });
  });

  it("flags a missing source table (e.g. stale snapshot)", () => {
    const draft = { ...happyPath(), fromTable: "ghosts" };
    const issues = validateCustomRelationDraft(draft, snapshot(), []);
    expect(issues).toContainEqual({
      kind: "source-table-missing",
      schema: "public",
      table: "ghosts",
    });
  });
});

describe("validateCustomRelationDraft — uniqueness", () => {
  it("accepts a target that matches the PK", () => {
    const issues = validateCustomRelationDraft(happyPath(), snapshot(), []);
    expect(issues.length).toBe(0);
  });

  it("accepts a target that matches a unique index (not the PK)", () => {
    const draft = {
      ...happyPath(),
      toTable: "customers",
      toColumns: ["email"], // customers_email_uk
    };
    const issues = validateCustomRelationDraft(draft, snapshot(), []);
    expect(issues).toEqual([]);
  });

  it("rejects when target columns are not collectively unique", () => {
    // orders.shipping_country has no unique index → can't be a target.
    const draft = {
      ...happyPath(),
      toTable: "orders",
      toColumns: ["shipping_country"],
    };
    const issues = validateCustomRelationDraft(draft, snapshot(), []);
    expect(issues).toContainEqual({
      kind: "target-not-unique",
      columns: ["shipping_country"],
    });
  });

  it("for 1:1, additionally requires the source columns to be unique", () => {
    // orders.customer_id is not unique (1:n natural shape). 1:1 → reject.
    const draft: CustomRelationDraft = {
      ...happyPath(),
      fromColumns: ["customer_id"],
      toTable: "customers",
      toColumns: ["id"],
      cardinality: "one-to-one",
    };
    const issues = validateCustomRelationDraft(draft, snapshot(), []);
    expect(issues).toContainEqual({
      kind: "source-not-unique-for-1to1",
      columns: ["customer_id"],
    });
  });

  it("1:1 with unique source columns passes", () => {
    const draft: CustomRelationDraft = {
      ...happyPath(),
      fromColumns: ["id"], // orders PK
      toTable: "customers",
      toColumns: ["id"],
      cardinality: "one-to-one",
    };
    const issues = validateCustomRelationDraft(draft, snapshot(), []);
    expect(issues).toEqual([]);
  });
});

describe("validateCustomRelationDraft — duplicate of schema-derived", () => {
  it("rejects a draft that exactly mirrors a schema-derived 1:n", () => {
    const draft: CustomRelationDraft = {
      ...happyPath(),
      fromTable: "orders",
      fromColumns: ["customer_id"],
      toTable: "customers",
      toColumns: ["id"],
    };
    const issues = validateCustomRelationDraft(
      draft,
      snapshot(),
      [schemaDerivedOrdersCustomer],
    );
    expect(issues).toContainEqual({
      kind: "duplicate-of-schema-derived",
      relationId: schemaDerivedOrdersCustomer.id,
    });
  });

  it("allows the same source/target with different columns", () => {
    const draft: CustomRelationDraft = {
      ...happyPath(),
      fromTable: "orders",
      fromColumns: ["id"],
      toTable: "customers",
      toColumns: ["id"],
    };
    const issues = validateCustomRelationDraft(
      draft,
      snapshot(),
      [schemaDerivedOrdersCustomer],
    );
    // 1:1 fine path → no duplicate
    expect(issues).toEqual([]);
  });

  it("does not collide with existing CUSTOM relations (only schema-derived ones count)", () => {
    const existingCustom: RelationDef = {
      ...schemaDerivedOrdersCustomer,
      id: "01J9X2KZQ5N7P3VCM8B49CUSTM1",
      source: "custom",
    };
    const draft: CustomRelationDraft = {
      ...happyPath(),
      fromTable: "orders",
      fromColumns: ["customer_id"],
      toTable: "customers",
      toColumns: ["id"],
    };
    const issues = validateCustomRelationDraft(draft, snapshot(), [existingCustom]);
    expect(issues.find((i) => i.kind === "duplicate-of-schema-derived")).toBeUndefined();
  });
});

describe("isDraftValid", () => {
  it("returns true only when zero issues", () => {
    expect(isDraftValid(happyPath(), snapshot(), [])).toBe(true);
    expect(isDraftValid(blank(), snapshot(), [])).toBe(false);
  });
});
