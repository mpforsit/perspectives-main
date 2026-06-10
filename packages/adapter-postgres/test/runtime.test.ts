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

describe("PostgresAdapter.paginateKeyset — nullable sort column", () => {
  // Customers has a `tier` column that the seed leaves entirely null for
  // every row. To exercise the null-aware predicate we promote a known
  // subset to non-null tiers, then paginate by `tier` and confirm every
  // row is visited exactly once. AUDIT-CODEX.md finding #10.

  it("walks every customer exactly once when sorting by a nullable column", async () => {
    // 600 rows get 'gold' / 'silver' / 'bronze'; the remaining 2400 stay
    // NULL. The pagination must visit all 3000.
    const setupSql = `
      UPDATE customers SET tier = 'gold'   WHERE id <= 200;
      UPDATE customers SET tier = 'silver' WHERE id BETWEEN 201 AND 400;
      UPDATE customers SET tier = 'bronze' WHERE id BETWEEN 401 AND 600;
      UPDATE customers SET tier = NULL     WHERE id > 600;
    `;
    // Direct query — we need write access to seed test data. The adapter's
    // pool client is fine; the harness DB is mutable.
    const adminClient = new PostgresAdapter(handle.profile);
    try {
      // Run inside a non-read-only path. `runMutation` isn't implemented yet
      // so use the pg pool through `pool.query` via a small escape.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing utility
      await (adminClient as any).pool.query(setupSql);
    } finally {
      await adminClient.close();
    }

    const plan = makePlan({
      table: "customers",
      columns: [
        { source: { column: "id" } },
        { source: { column: "tier" } },
      ],
      sort: [{ column: "tier", direction: "asc" }],
    });

    const { ids } = await paginateAll({ plan, pageSize: 250 });
    expect(ids.length).toBe(3000);
    // Every id appears exactly once.
    expect(new Set(ids).size).toBe(3000);
  }, 60_000);

  it("walks every row when sorting DESC NULLS LAST on a nullable column", async () => {
    const plan = makePlan({
      table: "customers",
      columns: [
        { source: { column: "id" } },
        { source: { column: "tier" } },
      ],
      sort: [{ column: "tier", direction: "desc", nulls: "last" }],
    });
    const { ids } = await paginateAll({ plan, pageSize: 350 });
    expect(ids.length).toBe(3000);
    expect(new Set(ids).size).toBe(3000);
  }, 60_000);
});

describe("PostgresAdapter — read-only envelope on every read path", () => {
  // Defense-in-depth check from AUDIT-CODEX.md finding #5: a structured
  // QueryPlan can't write, but `withReadOnlyClient` is the safety net if
  // the compiler ever regresses. We exercise that net by hand-rolling a
  // raw write inside `runQuery`'s envelope via the same internal helper.
  it("runQuery's helper rejects writes even when the SQL contains an INSERT", async () => {
    // Reach into the private helper to feed it a write directly. If the
    // BEGIN READ ONLY isn't in place, this would succeed and pollute the
    // table — the read-only envelope must reject it.
    const promise = (
      adapter as unknown as {
        withReadOnlyClient: (
          body: (c: import("pg").PoolClient) => Promise<unknown>,
          msg: string,
        ) => Promise<unknown>;
      }
    ).withReadOnlyClient(
      (client) =>
        client.query("INSERT INTO customers (full_name) VALUES ('leak-test')"),
      "rw probe",
    );
    await expect(promise).rejects.toThrowError(/read-only/i);

    // Confirm the row didn't land.
    const check = await adapter.runReadOnlySql(
      "SELECT COUNT(*)::int AS c FROM customers WHERE full_name = 'leak-test'",
    );
    expect(Number(check.rows[0]?.["c"])).toBe(0);
  });
});

describe("PostgresAdapter.runReadOnlySql — resource limits + cancellation", () => {
  // Each test exercises one of the four "Short-term #1" guardrails from
  // AUDIT-CODEX.md: server-side timeout, row cap, byte cap, AbortSignal.

  it("aborts via statement_timeout when the user query runs too long", async () => {
    await expect(
      adapter.runReadOnlySql("SELECT pg_sleep(5)", { statementTimeoutMs: 150 }),
    ).rejects.toThrowError(/(timeout|cancel)/i);
  });

  it("truncates with row-cap when more rows are produced than maxRows", async () => {
    const result = await adapter.runReadOnlySql(
      "SELECT id FROM customers ORDER BY id",
      { maxRows: 7 },
    );
    expect(result.rows.length).toBe(7);
    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toBe("row-cap");
  });

  it("leaves a result alone when maxRows is not exceeded", async () => {
    const result = await adapter.runReadOnlySql(
      "SELECT id FROM customers ORDER BY id LIMIT 4",
      { maxRows: 10 },
    );
    expect(result.rows.length).toBe(4);
    expect(result.truncated).toBe(false);
    expect(result.truncationReason).toBeUndefined();
  });

  it("truncates with byte-cap when row sizes blow past maxBytes", async () => {
    // Each row is ~256 chars of text; with a 100-byte cap the first row
    // alone won't trip it (we always include row 0) but the second will.
    const result = await adapter.runReadOnlySql(
      "SELECT repeat('a', 256) AS payload FROM generate_series(1, 50)",
      { maxBytes: 100 },
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.length).toBeLessThan(50);
    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toBe("byte-cap");
  });

  it("cancels an in-flight query when the AbortSignal fires", async () => {
    const controller = new AbortController();
    const queryPromise = adapter.runReadOnlySql("SELECT pg_sleep(5)", {
      statementTimeoutMs: 10_000,
      signal: controller.signal,
    });
    // Give the backend a moment to receive the query so the cancel can
    // target an actually-running statement.
    setTimeout(() => controller.abort(), 100);
    await expect(queryPromise).rejects.toThrowError(/(cancel|abort)/i);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      adapter.runReadOnlySql("SELECT pg_sleep(5)", {
        statementTimeoutMs: 10_000,
        signal: controller.signal,
      }),
    ).rejects.toThrowError(/(cancel|abort)/i);
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
