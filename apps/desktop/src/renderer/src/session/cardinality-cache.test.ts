import { describe, expect, it } from "vitest";

import {
  distinctPkTuples,
  mergeResults,
  missingForRelation,
  tupleKey,
  type CardinalityCache,
} from "./cardinality-cache";

describe("tupleKey", () => {
  it("normalises string vs number PK values so 1 matches '1'", () => {
    expect(tupleKey([1])).toBe(tupleKey(["1"]));
  });

  it("preserves nulls without colliding with the string 'null'", () => {
    expect(tupleKey([null])).not.toBe(tupleKey(["null"]));
  });

  it("differentiates same-value single vs multi columns", () => {
    expect(tupleKey([1, 2])).not.toBe(tupleKey([1]));
    expect(tupleKey([1, 2])).not.toBe(tupleKey([2, 1]));
  });
});

describe("distinctPkTuples", () => {
  it("returns [] when the primary key is empty", () => {
    const out = distinctPkTuples([{ id: 1 }], []);
    expect(out).toEqual([]);
  });

  it("dedupes rows by tuple key (int8 string vs JS number)", () => {
    const rows = [{ id: 1 }, { id: "1" }, { id: 2 }];
    const out = distinctPkTuples(rows, ["id"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual([1]);
    expect(out[1]).toEqual([2]);
  });

  it("emits compound PK tuples in PK column order", () => {
    const rows = [{ tenant: 1, code: "A" }];
    const out = distinctPkTuples(rows, ["tenant", "code"]);
    expect(out).toEqual([[1, "A"]]);
  });

  it("substitutes null for missing PK values instead of undefined", () => {
    const rows = [{ id: 1 }, { id: undefined } as unknown as Record<string, unknown>];
    const out = distinctPkTuples(rows, ["id"]);
    expect(out).toContainEqual([1]);
    expect(out).toContainEqual([null]);
  });
});

describe("missingForRelation", () => {
  it("returns every tuple when the cache is empty", () => {
    const cache: CardinalityCache = new Map();
    const missing = missingForRelation(cache, "r1", [[1], [2], [3]]);
    expect(missing).toEqual([[1], [2], [3]]);
  });

  it("filters out tuples already present for the relation", () => {
    const cache: CardinalityCache = new Map();
    cache.set(
      "r1",
      new Map([
        [tupleKey([1]), { count: 3, estimated: false }],
        [tupleKey([2]), { count: 0, estimated: false }],
      ]),
    );
    const missing = missingForRelation(cache, "r1", [[1], [2], [3]]);
    expect(missing).toEqual([[3]]);
  });

  it("respects relation-scoped caches (r1 entries don't count for r2)", () => {
    const cache: CardinalityCache = new Map();
    cache.set("r1", new Map([[tupleKey([1]), { count: 3, estimated: false }]]));
    const missing = missingForRelation(cache, "r2", [[1]]);
    expect(missing).toEqual([[1]]);
  });
});

describe("mergeResults", () => {
  it("adds new entries under the relation without touching other relations", () => {
    const initial: CardinalityCache = new Map();
    initial.set(
      "r1",
      new Map([[tupleKey([1]), { count: 3, estimated: false }]]),
    );
    initial.set(
      "r2",
      new Map([[tupleKey([9]), { count: 99, estimated: true }]]),
    );

    const next = mergeResults(initial, "r1", [
      { pkTuple: [2], count: 7, estimated: false },
    ]);

    expect(next.get("r1")?.get(tupleKey([1]))).toEqual({
      count: 3,
      estimated: false,
    });
    expect(next.get("r1")?.get(tupleKey([2]))).toEqual({
      count: 7,
      estimated: false,
    });
    expect(next.get("r2")?.get(tupleKey([9]))).toEqual({
      count: 99,
      estimated: true,
    });
  });

  it("overwrites an estimate with an exact count on escalate", () => {
    const initial: CardinalityCache = new Map();
    initial.set(
      "r1",
      new Map([[tupleKey([1]), { count: 5300, estimated: true }]]),
    );
    const next = mergeResults(initial, "r1", [
      { pkTuple: [1], count: 5301, estimated: false },
    ]);
    expect(next.get("r1")?.get(tupleKey([1]))).toEqual({
      count: 5301,
      estimated: false,
    });
  });

  it("returns a new cache reference — never mutates the input", () => {
    const initial: CardinalityCache = new Map();
    initial.set("r1", new Map());
    const next = mergeResults(initial, "r1", [
      { pkTuple: [1], count: 3, estimated: false },
    ]);
    expect(next).not.toBe(initial);
    expect(next.get("r1")).not.toBe(initial.get("r1"));
    expect(initial.get("r1")?.size).toBe(0);
  });

  it("simulates the scroll flow (page 1 → page 2 dedupes cached entries)", () => {
    let cache: CardinalityCache = new Map();
    // Page 1 arrives.
    cache = mergeResults(cache, "orders", [
      { pkTuple: [1], count: 3, estimated: false },
      { pkTuple: [2], count: 3, estimated: false },
    ]);
    // Page 2 arrives: rows [2, 3, 4]. Only 3 and 4 are missing.
    const missing = missingForRelation(cache, "orders", [[2], [3], [4]]);
    expect(missing).toEqual([[3], [4]]);
    cache = mergeResults(cache, "orders", [
      { pkTuple: [3], count: 3, estimated: false },
      { pkTuple: [4], count: 3, estimated: false },
    ]);
    expect(cache.get("orders")?.size).toBe(4);
  });
});
