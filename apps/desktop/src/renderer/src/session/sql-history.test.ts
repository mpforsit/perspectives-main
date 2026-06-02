import { describe, expect, it } from "vitest";

import {
  HISTORY_VERSION,
  loadHistory,
  MAX_HISTORY,
  pushHistory,
  sqlHistoryKey,
  toHistoryPayload,
} from "./sql-history";

describe("sqlHistoryKey", () => {
  it("namespaces by connection id and version", () => {
    expect(sqlHistoryKey("conn-x")).toBe(`session:conn-x:sqlHistory.v${HISTORY_VERSION}`);
  });
});

describe("loadHistory", () => {
  it("returns empty for null / undefined / malformed payloads", () => {
    expect(loadHistory(null).entries).toEqual([]);
    expect(loadHistory(undefined).entries).toEqual([]);
    expect(loadHistory("garbage").entries).toEqual([]);
    expect(loadHistory({ entries: ["x"] }).entries).toEqual([]); // missing version
  });

  it("parses a valid payload and truncates past MAX_HISTORY", () => {
    const big = Array.from({ length: MAX_HISTORY + 10 }, (_, i) => `q${i}`);
    const out = loadHistory({ v: HISTORY_VERSION, entries: big });
    expect(out.entries.length).toBe(MAX_HISTORY);
    expect(out.entries[0]).toBe("q0");
  });
});

describe("toHistoryPayload", () => {
  it("attaches the current version tag", () => {
    expect(toHistoryPayload({ entries: ["a"] })).toEqual({
      v: HISTORY_VERSION,
      entries: ["a"],
    });
  });
});

describe("pushHistory", () => {
  it("prepends to the front", () => {
    expect(pushHistory(["a", "b"], "c")).toEqual(["c", "a", "b"]);
  });

  it("moves an existing entry to the front (dedupe)", () => {
    expect(pushHistory(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("trims whitespace and ignores empty entries", () => {
    expect(pushHistory(["a"], "   ")).toEqual(["a"]);
    expect(pushHistory(["a"], "  b  ")).toEqual(["b", "a"]);
  });

  it("caps at MAX_HISTORY entries", () => {
    const start = Array.from({ length: MAX_HISTORY }, (_, i) => `q${i}`);
    const out = pushHistory(start, "new");
    expect(out.length).toBe(MAX_HISTORY);
    expect(out[0]).toBe("new");
    expect(out[out.length - 1]).toBe(`q${MAX_HISTORY - 2}`);
  });
});
