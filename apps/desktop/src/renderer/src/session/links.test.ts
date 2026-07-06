import { describe, expect, it } from "vitest";

import type { RelationDef } from "@perspectives/engine";

import {
  buildColumnLinkMap,
  buildLinkFilter,
  extractTargetPkValues,
  formatBreadcrumbLabel,
} from "./links";

const NOW = "2026-06-11T00:00:00.000Z";

function simpleRel(): RelationDef {
  return {
    id: "01J9X2KZQ5N7P3VCM8B4SIMPL1",
    from: { schema: "public", table: "orders", columns: ["customer_id"] },
    to: { schema: "public", table: "customers", columns: ["id"] },
    cardinality: "one-to-many",
    source: "schema",
    displayDirection: "both",
    updatedAt: NOW,
  };
}

function compoundRel(): RelationDef {
  return {
    id: "01J9X2KZQ5N7P3VCM8B4CMPND1",
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

function selfRefRel(): RelationDef {
  return {
    id: "01J9X2KZQ5N7P3VCM8B4SELF11",
    from: { schema: "public", table: "employees", columns: ["manager_id"] },
    to: { schema: "public", table: "employees", columns: ["id"] },
    cardinality: "one-to-many",
    source: "schema",
    displayDirection: "both",
    updatedAt: NOW,
  };
}

describe("buildLinkFilter", () => {
  it("builds an AND of equality leaves for a simple FK", () => {
    const filter = buildLinkFilter(simpleRel(), { customer_id: 42, status: "pending" });
    expect(filter).toEqual({
      op: "and",
      children: [{ column: "id", op: "eq", value: 42 }],
    });
  });

  it("preserves column order across both sides for a compound FK", () => {
    const filter = buildLinkFilter(compoundRel(), {
      tenant_id: 1,
      warehouse_code: "A1",
      product_id: 99,
    });
    expect(filter).toEqual({
      op: "and",
      children: [
        { column: "tenant_id", op: "eq", value: 1 },
        { column: "code", op: "eq", value: "A1" },
      ],
    });
  });

  it("handles self-referential FKs (same table on both sides)", () => {
    const filter = buildLinkFilter(selfRefRel(), { id: 5, manager_id: 3 });
    expect(filter).toEqual({
      op: "and",
      children: [{ column: "id", op: "eq", value: 3 }],
    });
  });

  it("threads null through (NULL FK values are legal and the filter should match null targets honestly)", () => {
    const filter = buildLinkFilter(selfRefRel(), { manager_id: null });
    expect(filter.children[0]).toMatchObject({ value: null });
  });

  it("throws on column-count mismatch (defensive — DSL prevents this on write, but JS-level guard catches a hand-rolled relation)", () => {
    const bad: RelationDef = {
      ...compoundRel(),
      to: {
        schema: "public",
        table: "warehouses",
        columns: ["tenant_id"], // <-- one column to from's two
      },
    };
    expect(() => buildLinkFilter(bad, { tenant_id: 1, warehouse_code: "A1" })).toThrow(
      /mismatched column counts/,
    );
  });
});

describe("extractTargetPkValues", () => {
  it("returns the FK source values in source-column order", () => {
    expect(
      extractTargetPkValues(compoundRel(), {
        tenant_id: 1,
        warehouse_code: "A1",
        unrelated: "ignore",
      }),
    ).toEqual([1, "A1"]);
  });

  it("threads null through", () => {
    expect(extractTargetPkValues(selfRefRel(), { manager_id: null })).toEqual([null]);
  });
});

describe("formatBreadcrumbLabel", () => {
  it("renders the PK tuple inside square brackets", () => {
    expect(formatBreadcrumbLabel("customers", [42])).toBe("customers[42]");
    expect(formatBreadcrumbLabel("warehouses", [1, "A1"])).toBe("warehouses[1,A1]");
  });

  it("renders null as ∅ so empty PKs are visually distinct from the string 'null'", () => {
    expect(formatBreadcrumbLabel("employees", [null])).toBe("employees[∅]");
  });
});

describe("buildColumnLinkMap", () => {
  it("maps every FK column on the source table to its relation", () => {
    const map = buildColumnLinkMap([simpleRel(), compoundRel()], "public", "inventory");
    expect(map.get("tenant_id")?.id).toBe(compoundRel().id);
    expect(map.get("warehouse_code")?.id).toBe(compoundRel().id);
    expect(map.get("customer_id")).toBeUndefined();
  });

  it("ignores relations whose source table doesn't match", () => {
    const map = buildColumnLinkMap([simpleRel()], "public", "customers");
    expect(map.size).toBe(0);
  });

  it("first-wins when a column participates in multiple FKs (no picker in Phase 2)", () => {
    const aliased: RelationDef = {
      ...simpleRel(),
      id: "01J9X2KZQ5N7P3VCM8B4ALIAS1",
      to: { schema: "public", table: "company", columns: ["id"] },
    };
    const map = buildColumnLinkMap([simpleRel(), aliased], "public", "orders");
    expect(map.get("customer_id")?.to.table).toBe("customers");
  });

  it("handles self-referential FKs without infinite-loop weirdness", () => {
    const map = buildColumnLinkMap([selfRefRel()], "public", "employees");
    expect(map.get("manager_id")?.to.table).toBe("employees");
  });
});
