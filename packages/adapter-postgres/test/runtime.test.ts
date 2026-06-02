import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  ColumnDef,
  Cursor,
  QueryPlan,
  SortDef,
} from "@perspectives/engine";

import { decodeCursor, encodeCursor, PostgresAdapter } from "../src";
import { withSeededPostgres } from "./helpers/container";

const handle = withSeededPostgres();

let adapter: PostgresAdapter;

beforeAll(() => {
  adapter = new PostgresAdapter(handle.profile);
});

afterAll(async () => {
  await adapter.close();
});

function makePlan(args: {
  table: string;
  columns: ColumnDef[];
  sort?: SortDef[];
  limit?: number;
  filters?: QueryPlan["filters"];
}): QueryPlan {
  const plan: QueryPlan = {
    planId: "test",
    base: { kind: "table", schema: "public", table: args.table },
    joins: [],
    columns: args.columns,
    sort: args.sort ?? [],
  };
  if (args.limit !== undefined) plan.limit = args.limit;
  if (args.filters !== undefined) plan.filters = args.filters;
  return plan;
}

async function paginateAll(args: {
  plan: QueryPlan;
  pageSize: number;
}): Promise<{ ids: number[]; pages: number }> {
  const ids: number[] = [];
  let cursor: Cursor | undefined;
  let pages = 0;
  const planWithLimit = { ...args.plan, limit: args.pageSize };
  while (true) {
    const page = cursor === undefined
      ? await adapter.paginateKeyset(planWithLimit)
      : await adapter.paginateKeyset(planWithLimit, cursor);
    pages++;
    for (const row of page.rows) {
      ids.push(Number(row["id"]));
    }
    if (page.nextCursor === undefined) break;
    cursor = page.nextCursor;
    // Safety: guard against infinite loops while iterating. Set well above
    // the largest expected page count (244 for the 37-rows-per-page test).
    if (pages > 1_000) throw new Error(`Pagination did not terminate after ${pages} pages`);
  }
  return { ids, pages };
}

async function directSelectAllOrderIds(): Promise<Set<number>> {
  // Bypass keyset pagination entirely: one big SELECT, no cursor, no limit.
  // The result is the ground truth that paginated runs must match.
  const direct = await adapter.runQuery(
    makePlan({
      table: "orders",
      columns: [{ source: { column: "id" } }],
      sort: [{ column: "id", direction: "asc" }],
      limit: 10_000, // > 9000, so every row comes back
    }),
  );
  return new Set(direct.rows.map((r) => Number(r["id"])));
}

describe("PostgresAdapter.paginateKeyset — orders (9000 rows, page size 500)", () => {
  it("visits every order id exactly once when sorting by the PK only", async () => {
    const truth = await directSelectAllOrderIds();
    expect(truth.size).toBe(9000);

    const { ids, pages } = await paginateAll({
      plan: makePlan({
        table: "orders",
        columns: [
          { source: { column: "id" } },
          { source: { column: "customer_id" } },
          { source: { column: "status" } },
          { source: { column: "placed_at" } },
        ],
      }),
      pageSize: 500,
    });

    const seen = new Set(ids);
    // Strong invariants: same cardinality, same set, no duplicates inside `ids`.
    expect(ids.length).toBe(9000);
    expect(seen.size).toBe(9000);
    expect(seen).toEqual(truth);
    expect(pages).toBe(18);
  }, 60_000);

  it("visits every order id exactly once when sorting by non-unique status + PK tiebreaker", async () => {
    const truth = await directSelectAllOrderIds();

    const plan = makePlan({
      table: "orders",
      columns: [
        { source: { column: "id" } },
        { source: { column: "status" } },
      ],
      sort: [{ column: "status", direction: "asc" }],
    });
    const { ids } = await paginateAll({ plan, pageSize: 500 });

    const seen = new Set(ids);
    expect(ids.length).toBe(9000);
    expect(seen.size).toBe(9000);
    expect(seen).toEqual(truth);
  }, 60_000);

  it("survives a non-divisor page size (37) and a non-PK descending sort", async () => {
    // A page size that doesn't divide 9000 evenly forces off-by-one bugs to
    // surface at the page boundary. DESC sort exercises the `<` branch of the
    // keyset predicate; PK tiebreaker is appended ASC regardless.
    const truth = await directSelectAllOrderIds();

    const plan = makePlan({
      table: "orders",
      columns: [
        { source: { column: "id" } },
        { source: { column: "placed_at" } },
      ],
      sort: [{ column: "placed_at", direction: "desc" }],
    });
    const { ids, pages } = await paginateAll({ plan, pageSize: 37 });

    const seen = new Set(ids);
    expect(ids.length).toBe(9000);
    expect(seen.size).toBe(9000);
    expect(seen).toEqual(truth);
    // ceil(9000 / 37) === 244 pages.
    expect(pages).toBe(244);
  }, 60_000);
});

describe("PostgresAdapter.countRows / estimateCount — customers", () => {
  const customersPlan = makePlan({
    table: "customers",
    columns: [{ source: { column: "id" } }],
  });

  it("countRows returns the exact 3000", async () => {
    expect(await adapter.countRows(customersPlan)).toBe(3000);
  });

  it("estimateCount returns a positive number of the right order of magnitude", async () => {
    const estimate = await adapter.estimateCount(customersPlan);
    expect(estimate).toBeGreaterThan(0);
    // pg_class.reltuples is an approximation but should be in the same ballpark.
    expect(estimate).toBeGreaterThanOrEqual(2_000);
    expect(estimate).toBeLessThanOrEqual(4_000);
  });

  it("countRows honours filters (country_code = 'DE' yields 300 rows)", async () => {
    const filtered = makePlan({
      table: "customers",
      columns: [{ source: { column: "id" } }],
      filters: {
        op: "and",
        children: [{ column: "country_code", op: "eq", value: "DE" }],
      },
    });
    expect(await adapter.countRows(filtered)).toBe(300);
  });
});

describe("PostgresAdapter.runQuery — filtered plan", () => {
  it("returns only matching rows when filtering on country_code = 'DE'", async () => {
    const plan = makePlan({
      table: "customers",
      columns: [
        { source: { column: "id" } },
        { source: { column: "country_code" } },
        { source: { column: "full_name" } },
      ],
      filters: {
        op: "and",
        children: [{ column: "country_code", op: "eq", value: "DE" }],
      },
      sort: [{ column: "id", direction: "asc" }],
      limit: 50,
    });
    const result = await adapter.runQuery(plan);
    expect(result.rows.length).toBe(50);
    for (const row of result.rows) {
      expect(row["country_code"]).toBe("DE");
    }
    expect(result.columns.map((c) => c.name)).toEqual([
      "id",
      "country_code",
      "full_name",
    ]);
  });
});

describe("PostgresAdapter.runReadOnlySql", () => {
  it("returns rows + column metadata for a SELECT", async () => {
    const result = await adapter.runReadOnlySql(
      "SELECT id, country_code FROM customers ORDER BY id LIMIT 3",
    );
    expect(result.rows.length).toBe(3);
    expect(result.columns.map((c) => c.name)).toEqual(["id", "country_code"]);
    // Column metadata comes from the pg result's field OIDs, not the schema
    // snapshot. customers.id is a bigint (int8) in the seed.
    const idCol = result.columns.find((c) => c.name === "id");
    expect(idCol?.dataType).toBe("int8");
  });

  it("rejects an UPDATE with a read-only-transaction error (SQLSTATE 25006)", async () => {
    // Mapped to ValidationError by errors.ts. The pg message contains the
    // string "read-only" verbatim in every Postgres version we target.
    await expect(
      adapter.runReadOnlySql("UPDATE customers SET country_code = 'XX' WHERE id = 1"),
    ).rejects.toThrowError(/read-only/i);
  });

  it("rejects DDL too (CREATE TABLE) — same read-only error", async () => {
    await expect(
      adapter.runReadOnlySql("CREATE TABLE perspectives_test_should_never_exist (x int)"),
    ).rejects.toThrowError(/read-only/i);
  });

  it("rolls back even on success, so any session GUC change is reverted", async () => {
    // Set a session-local GUC inside the read-only txn, then probe it after
    // the rollback — the second call must NOT see the change.
    await adapter.runReadOnlySql("SET LOCAL search_path TO public");
    const after = await adapter.runReadOnlySql("SHOW search_path");
    // The rolled-back SET LOCAL is gone; whatever the default is, it's not
    // a value we just set. The default in the seed is "$user", public.
    expect(String(after.rows[0]?.["search_path"])).toMatch(/\$user/);
  });

  it("propagates a syntax error as a ValidationError", async () => {
    await expect(
      adapter.runReadOnlySql("SLECT garbage FROM nowhere"),
    ).rejects.toThrowError(/syntax/i);
  });
});

describe("Cursor wire format", () => {
  it("round-trips through base64url-encoded JSON", () => {
    const original: Cursor = {
      values: ["pending", 123, null, true, "0:01:23.456"],
      direction: "forward",
    };
    const token = encodeCursor(original);
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
    expect(token).not.toContain("=");
    expect(decodeCursor(token)).toEqual(original);
  });
});
