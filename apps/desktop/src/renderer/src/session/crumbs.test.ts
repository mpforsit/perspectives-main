import { describe, expect, it } from "vitest";

import type { FilterGroup } from "@perspectives/engine";

import { collapseCrumbs, crumbTargetPk } from "./crumbs";
import type { BreadcrumbStep } from "./links";

function makeCrumb(schema: string, table: string, label: string): BreadcrumbStep {
  return {
    schema,
    table,
    label,
    filter: {
      op: "and",
      children: [{ column: "id", op: "eq", value: label }],
    },
  };
}

describe("collapseCrumbs", () => {
  it("returns a stable empty shape for zero crumbs", () => {
    const out = collapseCrumbs([]);
    expect(out.collapsed).toBe(false);
    expect(out.hidden).toEqual([]);
    expect(out.tail).toEqual([]);
  });

  it("does not collapse a 1-hop trail", () => {
    const out = collapseCrumbs([makeCrumb("public", "customers", "1")]);
    expect(out.collapsed).toBe(false);
    expect(out.head.label).toBe("1");
    expect(out.tail).toEqual([]);
    expect(out.hidden).toEqual([]);
  });

  it("does not collapse a 4-hop trail (renders every crumb inline)", () => {
    const trail = [
      makeCrumb("public", "customers", "1"),
      makeCrumb("public", "orders", "42"),
      makeCrumb("public", "order_items", "7"),
      makeCrumb("public", "products", "3"),
    ];
    const out = collapseCrumbs(trail);
    expect(out.collapsed).toBe(false);
    expect(out.head.index).toBe(0);
    expect(out.tail.map((t) => t.index)).toEqual([1, 2, 3]);
    expect(out.hidden).toEqual([]);
  });

  it("collapses a 5-hop trail into head + hidden + last two", () => {
    const trail = [
      makeCrumb("public", "customers", "1"),
      makeCrumb("public", "orders", "42"),
      makeCrumb("public", "order_items", "7"),
      makeCrumb("public", "products", "3"),
      makeCrumb("public", "categories", "electronics"),
    ];
    const out = collapseCrumbs(trail);
    expect(out.collapsed).toBe(true);
    expect(out.head.label).toBe("1");
    expect(out.head.index).toBe(0);
    expect(out.hidden.map((h) => h.label)).toEqual(["42", "7"]);
    expect(out.hidden.map((h) => h.index)).toEqual([1, 2]);
    expect(out.tail.map((t) => t.label)).toEqual(["3", "electronics"]);
    expect(out.tail.map((t) => t.index)).toEqual([3, 4]);
  });

  it("collapses a 6-hop trail into head + 3 hidden + last two", () => {
    const trail = Array.from({ length: 6 }, (_, i) =>
      makeCrumb("public", `t${i}`, String(i)),
    );
    const out = collapseCrumbs(trail);
    expect(out.collapsed).toBe(true);
    expect(out.hidden.map((h) => h.label)).toEqual(["1", "2", "3"]);
    expect(out.tail.map((t) => t.label)).toEqual(["4", "5"]);
  });

  it("preserves self-referential chains without deduplication", () => {
    // manager → manager → manager → manager → manager (5 hops, same table).
    const trail = Array.from({ length: 5 }, (_, i) =>
      makeCrumb("public", "employees", String(i + 1)),
    );
    const out = collapseCrumbs(trail);
    expect(out.collapsed).toBe(true);
    // Every step is still there — we don't hide duplicates.
    expect(out.head.label).toBe("1");
    expect(out.hidden.map((h) => h.label)).toEqual(["2", "3"]);
    expect(out.tail.map((t) => t.label)).toEqual(["4", "5"]);
  });
});

describe("crumbTargetPk", () => {
  it("extracts a single-column PK tuple from an AND-of-eq filter", () => {
    const filter: FilterGroup = {
      op: "and",
      children: [{ column: "id", op: "eq", value: 42 }],
    };
    expect(crumbTargetPk(filter, ["id"])).toEqual([42]);
  });

  it("reorders the values to match the target's PK column order", () => {
    const filter: FilterGroup = {
      op: "and",
      children: [
        { column: "code", op: "eq", value: "A1" },
        { column: "tenant_id", op: "eq", value: 1 },
      ],
    };
    // Filter children are in `code, tenant_id` order but the PK is
    // declared as `tenant_id, code`.
    expect(crumbTargetPk(filter, ["tenant_id", "code"])).toEqual([1, "A1"]);
  });

  it("returns null when the filter is missing a PK column", () => {
    const filter: FilterGroup = {
      op: "and",
      children: [{ column: "tenant_id", op: "eq", value: 1 }],
    };
    expect(crumbTargetPk(filter, ["tenant_id", "code"])).toBeNull();
  });

  it("returns null when the filter is an OR group (non-flat)", () => {
    const filter: FilterGroup = {
      op: "or",
      children: [{ column: "id", op: "eq", value: 1 }],
    };
    expect(crumbTargetPk(filter, ["id"])).toBeNull();
  });

  it("returns null when a leaf uses a non-eq operator", () => {
    const filter: FilterGroup = {
      op: "and",
      children: [{ column: "id", op: "gt", value: 1 }],
    };
    expect(crumbTargetPk(filter, ["id"])).toBeNull();
  });

  it("returns null when a leaf value is an array (not a primitive)", () => {
    const filter: FilterGroup = {
      op: "and",
      children: [{ column: "id", op: "eq", value: [1, 2] }],
    };
    expect(crumbTargetPk(filter, ["id"])).toBeNull();
  });

  it("returns null when the target has no PK", () => {
    const filter: FilterGroup = {
      op: "and",
      children: [{ column: "id", op: "eq", value: 1 }],
    };
    expect(crumbTargetPk(filter, [])).toBeNull();
  });
});
