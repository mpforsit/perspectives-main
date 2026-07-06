import { describe, expect, it } from "vitest";

import {
  loadPersistedTabs,
  persistedTabsKey,
  toPersistedPayload,
  TABS_VERSION,
} from "./tabs-storage";

describe("persistedTabsKey", () => {
  it("namespaces by connection id and version", () => {
    expect(persistedTabsKey("abc")).toBe(`session:abc:tabs.v${TABS_VERSION}`);
  });
});

describe("loadPersistedTabs", () => {
  it("returns null for null/undefined", () => {
    expect(loadPersistedTabs(null)).toBeNull();
    expect(loadPersistedTabs(undefined)).toBeNull();
  });

  it("returns null when the version doesn't match", () => {
    expect(
      loadPersistedTabs({
        v: 99,
        tabs: [{ kind: "table", schema: "public", name: "x" }],
        activeIndex: 0,
      }),
    ).toBeNull();
  });

  it("returns null for malformed payloads", () => {
    expect(loadPersistedTabs({ tabs: [{ schema: "x" }] })).toBeNull();
    expect(loadPersistedTabs("garbage")).toBeNull();
    expect(loadPersistedTabs({ v: TABS_VERSION, tabs: 5 })).toBeNull();
  });

  it("clamps activeIndex into the tab range", () => {
    const payload = {
      v: TABS_VERSION,
      tabs: [
        { kind: "table", schema: "public", name: "a" },
        { kind: "view", schema: "public", name: "b" },
      ],
      activeIndex: 99,
    };
    expect(loadPersistedTabs(payload)).toEqual({
      tabs: payload.tabs,
      activeIndex: 1,
    });
  });

  it("handles the empty-tabs case with activeIndex -1", () => {
    const out = loadPersistedTabs({ v: TABS_VERSION, tabs: [], activeIndex: -1 });
    expect(out).toEqual({ tabs: [], activeIndex: -1 });
  });

  it("accepts the SQL-tab variant alongside table / view", () => {
    const out = loadPersistedTabs({
      v: TABS_VERSION,
      tabs: [
        { kind: "table", schema: "public", name: "customers" },
        { kind: "sql", id: "sql-01", title: "Untitled query" },
        { kind: "view", schema: "public", name: "active_users" },
      ],
      activeIndex: 1,
    });
    expect(out?.tabs.length).toBe(3);
    expect(out?.tabs[1]).toEqual({
      kind: "sql",
      id: "sql-01",
      title: "Untitled query",
    });
  });

  it("rejects a SQL tab payload missing its id", () => {
    expect(
      loadPersistedTabs({
        v: TABS_VERSION,
        tabs: [{ kind: "sql", title: "x" }],
        activeIndex: 0,
      }),
    ).toBeNull();
  });

  it("accepts the filteredTable variant alongside the others", () => {
    const out = loadPersistedTabs({
      v: TABS_VERSION,
      tabs: [
        { kind: "table", schema: "public", name: "orders" },
        {
          kind: "filteredTable",
          id: "ft-01",
          schema: "public",
          name: "customers",
          filter: {
            op: "and",
            children: [{ column: "id", op: "eq", value: 42 }],
          },
          crumbs: [
            {
              schema: "public",
              table: "customers",
              label: "customers[42]",
              filter: {
                op: "and",
                children: [{ column: "id", op: "eq", value: 42 }],
              },
            },
          ],
        },
      ],
      activeIndex: 1,
    });
    expect(out?.tabs.length).toBe(2);
    const ft = out?.tabs[1];
    expect(ft?.kind).toBe("filteredTable");
    if (ft?.kind === "filteredTable") {
      expect(ft.id).toBe("ft-01");
      expect(ft.crumbs.length).toBe(1);
      expect(ft.filter.children[0]).toMatchObject({
        column: "id",
        op: "eq",
        value: 42,
      });
    }
  });

  it("rejects a filteredTable payload missing the filter field", () => {
    expect(
      loadPersistedTabs({
        v: TABS_VERSION,
        tabs: [
          {
            kind: "filteredTable",
            id: "ft-bad",
            schema: "public",
            name: "customers",
            crumbs: [
              {
                schema: "public",
                table: "customers",
                label: "x",
                filter: { op: "and", children: [] },
              },
            ],
          },
        ],
        activeIndex: 0,
      }),
    ).toBeNull();
  });

  it("rejects a filteredTable payload with a malformed compound filter (wrong leaf shape)", () => {
    expect(
      loadPersistedTabs({
        v: TABS_VERSION,
        tabs: [
          {
            kind: "filteredTable",
            id: "ft-bad",
            schema: "public",
            name: "warehouses",
            filter: {
              op: "and",
              children: [
                { column: "tenant_id", op: "eq", value: 1 },
                { column: "code" }, // missing op + value
              ],
            },
            crumbs: [
              {
                schema: "public",
                table: "warehouses",
                label: "warehouses[1,A1]",
                filter: {
                  op: "and",
                  children: [{ column: "tenant_id", op: "eq", value: 1 }],
                },
              },
            ],
          },
        ],
        activeIndex: 0,
      }),
    ).toBeNull();
  });
});

describe("filteredTable round-trip — 4-hop trail (Phase 2.7)", () => {
  it("preserves a 4-hop breadcrumb trail through toPersistedPayload → loadPersistedTabs", () => {
    const trail = [
      {
        schema: "public",
        table: "customers",
        label: "customers[1]",
        filter: {
          op: "and" as const,
          children: [{ column: "id", op: "eq" as const, value: 1 }],
        },
      },
      {
        schema: "public",
        table: "orders",
        label: "orders[42]",
        filter: {
          op: "and" as const,
          children: [{ column: "id", op: "eq" as const, value: 42 }],
        },
      },
      {
        schema: "public",
        table: "order_items",
        label: "order_items[7]",
        filter: {
          op: "and" as const,
          children: [{ column: "id", op: "eq" as const, value: 7 }],
        },
      },
      {
        schema: "public",
        table: "products",
        label: "products[3]",
        filter: {
          op: "and" as const,
          children: [{ column: "id", op: "eq" as const, value: 3 }],
        },
      },
    ];

    const snapshot = {
      tabs: [
        {
          kind: "filteredTable" as const,
          id: "ft-multi",
          schema: "public",
          name: "products",
          filter: {
            op: "and" as const,
            children: [{ column: "id", op: "eq" as const, value: 3 }],
          },
          crumbs: trail,
        },
      ],
      activeIndex: 0,
    };

    const persisted = toPersistedPayload(snapshot);
    const restored = loadPersistedTabs(persisted);

    expect(restored).not.toBeNull();
    const tab = restored?.tabs[0];
    expect(tab?.kind).toBe("filteredTable");
    if (tab?.kind !== "filteredTable") return;
    expect(tab.crumbs).toHaveLength(4);
    expect(tab.crumbs.map((c) => c.table)).toEqual([
      "customers",
      "orders",
      "order_items",
      "products",
    ]);
    expect(tab.crumbs[3]?.filter.children[0]).toMatchObject({
      column: "id",
      op: "eq",
      value: 3,
    });
  });

  it("preserves compound-PK filters through 3+ hops", () => {
    const snapshot = {
      tabs: [
        {
          kind: "filteredTable" as const,
          id: "ft-compound",
          schema: "public",
          name: "warehouses",
          filter: {
            op: "and" as const,
            children: [
              { column: "tenant_id", op: "eq" as const, value: 1 },
              { column: "code", op: "eq" as const, value: "A1" },
            ],
          },
          crumbs: [
            {
              schema: "public",
              table: "customers",
              label: "customers[1]",
              filter: {
                op: "and" as const,
                children: [{ column: "id", op: "eq" as const, value: 1 }],
              },
            },
            {
              schema: "public",
              table: "inventory",
              label: "inventory[500]",
              filter: {
                op: "and" as const,
                children: [{ column: "id", op: "eq" as const, value: 500 }],
              },
            },
            {
              schema: "public",
              table: "warehouses",
              label: "warehouses[1,A1]",
              filter: {
                op: "and" as const,
                children: [
                  { column: "tenant_id", op: "eq" as const, value: 1 },
                  { column: "code", op: "eq" as const, value: "A1" },
                ],
              },
            },
          ],
        },
      ],
      activeIndex: 0,
    };
    const restored = loadPersistedTabs(toPersistedPayload(snapshot));
    const tab = restored?.tabs[0];
    if (tab?.kind !== "filteredTable") return;
    const tail = tab.crumbs[tab.crumbs.length - 1];
    expect(tail?.filter.children).toHaveLength(2);
  });
});

describe("toPersistedPayload", () => {
  it("wraps the snapshot with the current version tag", () => {
    expect(
      toPersistedPayload({
        tabs: [{ kind: "table", schema: "public", name: "a" }],
        activeIndex: 0,
      }),
    ).toEqual({
      v: TABS_VERSION,
      tabs: [{ kind: "table", schema: "public", name: "a" }],
      activeIndex: 0,
    });
  });
});
