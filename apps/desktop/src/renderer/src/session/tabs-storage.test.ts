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
