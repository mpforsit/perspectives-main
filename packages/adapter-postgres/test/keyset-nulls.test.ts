/**
 * Null-aware keyset pagination — see AUDIT-CODEX.md finding #10.
 *
 * Pure compiler tests: the predicate is built without a database, asserting
 * the exact SQL shape for each combination of direction, NULLS placement,
 * and cursor value (null vs. non-null). The integration test inside
 * `runtime.test.ts` separately walks the pagination loop against a live
 * Postgres to verify that the predicate actually yields the right rows.
 */
import { describe, expect, it } from "vitest";

import type { QueryPlan, SortDef } from "@perspectives/engine";

import { compileSelectQuery, type KeysetPredicate } from "../src/compiler";

function basePlan(sort: SortDef[] = []): QueryPlan {
  return {
    planId: "p",
    base: { kind: "table", schema: "public", table: "customers" },
    joins: [],
    columns: [{ source: { column: "id" } }],
    sort,
  };
}

function compile(
  sort: SortDef[],
  values: ReadonlyArray<unknown>,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const predicate: KeysetPredicate = { sort, values };
  const sql = compileSelectQuery(basePlan(sort), params, {
    sortOverride: sort,
    keysetPredicate: predicate,
  });
  return { sql, params };
}

describe("compileKeysetPredicate — single-column, non-null cursor", () => {
  it("ASC default (NULLS LAST) — emits `> v OR IS NULL`", () => {
    const { sql, params } = compile(
      [{ column: "tier", direction: "asc" }],
      ["gold"],
    );
    expect(sql).toContain('(("tier" > $1 OR "tier" IS NULL))');
    expect(params).toEqual(["gold"]);
  });

  it("ASC NULLS FIRST — strict > only, NULLs already past", () => {
    const { sql } = compile(
      [{ column: "tier", direction: "asc", nulls: "first" }],
      ["gold"],
    );
    expect(sql).toContain('(("tier" > $1))');
    // ORDER BY annotates the column with `NULLS FIRST`, but the predicate
    // itself doesn't reference IS NULL. Check only the WHERE half.
    expect(sql.split("ORDER BY")[0]).not.toContain("IS NULL");
  });

  it("DESC default (NULLS FIRST) — strict < only", () => {
    const { sql } = compile(
      [{ column: "tier", direction: "desc" }],
      ["gold"],
    );
    expect(sql).toContain('(("tier" < $1))');
    expect(sql.split("ORDER BY")[0]).not.toContain("IS NULL");
  });

  it("DESC NULLS LAST — emits `< v OR IS NULL`", () => {
    const { sql } = compile(
      [{ column: "tier", direction: "desc", nulls: "last" }],
      ["gold"],
    );
    expect(sql).toContain('(("tier" < $1 OR "tier" IS NULL))');
  });
});

describe("compileKeysetPredicate — single-column, null cursor value", () => {
  it("ASC NULLS LAST + cursor NULL → no advance branch → predicate is FALSE", () => {
    const { sql, params } = compile(
      [{ column: "tier", direction: "asc" }],
      [null],
    );
    expect(sql).toContain("WHERE FALSE");
    expect(params).toEqual([]);
  });

  it("ASC NULLS FIRST + cursor NULL → advance to non-NULL rows", () => {
    const { sql, params } = compile(
      [{ column: "tier", direction: "asc", nulls: "first" }],
      [null],
    );
    expect(sql).toContain('WHERE (("tier" IS NOT NULL))');
    expect(params).toEqual([]);
  });

  it("DESC NULLS FIRST + cursor NULL → advance to non-NULL rows", () => {
    const { sql } = compile(
      [{ column: "tier", direction: "desc" }],
      [null],
    );
    expect(sql).toContain('WHERE (("tier" IS NOT NULL))');
  });

  it("DESC NULLS LAST + cursor NULL → no advance branch", () => {
    const { sql } = compile(
      [{ column: "tier", direction: "desc", nulls: "last" }],
      [null],
    );
    expect(sql).toContain("WHERE FALSE");
  });
});

describe("compileKeysetPredicate — equality of earlier columns", () => {
  it("NULL cursor value in earlier column compiles to `IS NULL`, not `= NULL`", () => {
    const sort: SortDef[] = [
      { column: "tier", direction: "asc" },
      { column: "id", direction: "asc" },
    ];
    const { sql, params } = compile(sort, [null, 42]);
    // The tier branch is "no advance" (NULLS LAST cursor sitting at NULL),
    // so only the id branch survives. Its equality predicate must use IS
    // NULL — `tier = NULL` would silently filter out the matching rows.
    expect(sql).toContain('"tier" IS NULL AND ("id" > $1');
    expect(params).toEqual([42]);
  });

  it("non-null cursor value in earlier column uses `= $n`", () => {
    const sort: SortDef[] = [
      { column: "country_code", direction: "asc" },
      { column: "id", direction: "asc" },
    ];
    const { sql, params } = compile(sort, ["DE", 42]);
    // Strict params come first in branch order, then the equality params for
    // prior columns. Order doesn't affect correctness, only placeholder
    // numbering.
    expect(sql).toContain('"country_code" > $1 OR "country_code" IS NULL');
    expect(sql).toContain('"country_code" = $3 AND ("id" > $2 OR "id" IS NULL)');
    expect(params).toEqual(["DE", 42, "DE"]);
  });
});

describe("compileKeysetPredicate — mixed ASC/DESC + NULLS treatments", () => {
  it("ASC NULLS LAST then DESC NULLS FIRST emits both null-aware branches", () => {
    const sort: SortDef[] = [
      { column: "tier", direction: "asc" }, // NULLS LAST (default)
      { column: "lifetime_value", direction: "desc" }, // NULLS FIRST (default)
    ];
    const { sql } = compile(sort, ["gold", 1000]);
    // First branch: tier > 'gold' OR tier IS NULL
    expect(sql).toContain('"tier" > $1 OR "tier" IS NULL');
    // Second branch: tier = 'gold' AND lifetime_value < 1000 (DESC NULLS
    // FIRST means NULLs are already past — strict-only).
    expect(sql).toContain('"tier" = $3 AND "lifetime_value" < $2');
  });
});
