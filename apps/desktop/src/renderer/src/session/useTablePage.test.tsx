// @vitest-environment jsdom
import { describe, expect, it, vi, type Mock } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";

import type { Cursor, PageResult, ResultRow } from "@perspectives/engine";

import { useTablePage, type UseTablePageArgs } from "./useTablePage";

function makePage(
  startId: number,
  count: number,
  hasNext: boolean,
): PageResult {
  const rows: ResultRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({ id: startId + i, name: `row-${startId + i}` });
  }
  const result: PageResult = {
    columns: [
      { name: "id", dataType: "int4", jsType: "number", nullable: false },
      { name: "name", dataType: "text", jsType: "string", nullable: false },
    ],
    rows,
  };
  if (hasNext) {
    result.nextCursor = {
      values: [startId + count - 1],
      direction: "forward",
    };
  }
  return result;
}

interface Harness {
  fetchPage: Mock<UseTablePageArgs["fetchPage"]>;
  fetchEstimate: Mock<() => Promise<number>>;
  fetchExactCount: Mock<() => Promise<number>>;
  wrapper: ({ children }: { children: ReactNode }) => JSX.Element;
}

function harness(opts: {
  pages?: PageResult[];
  pageOverride?: UseTablePageArgs["fetchPage"];
  estimate?: number;
  exact?: number;
}): Harness {
  const fetchPage =
    opts.pageOverride !== undefined
      ? vi.fn(opts.pageOverride)
      : (() => {
          let i = 0;
          return vi.fn(async (_cursor: Cursor | undefined): Promise<PageResult> => {
            const page = (opts.pages ?? [])[i];
            i++;
            if (page === undefined) {
              throw new Error(`fetchPage called more than expected (${i})`);
            }
            return page;
          });
        })();

  const fetchEstimate = vi.fn(async () => opts.estimate ?? 0);
  const fetchExactCount = vi.fn(async () => opts.exact ?? 0);

  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

  return { fetchPage, fetchEstimate, fetchExactCount, wrapper };
}

describe("useTablePage", () => {
  it("returns the first page on initial load", async () => {
    const h = harness({ pages: [makePage(1, 50, true)], estimate: 9_000 });
    const { result } = renderHook(
      () =>
        useTablePage({
          queryKey: ["t1"],
          fetchPage: h.fetchPage,
          fetchEstimate: h.fetchEstimate,
          fetchExactCount: h.fetchExactCount,
          enabled: true,
        }),
      { wrapper: h.wrapper },
    );

    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.rows).toHaveLength(50);
    expect(result.current.rows[0]).toEqual({ id: 1, name: "row-1" });
    expect(result.current.serverColumns.map((c) => c.name)).toEqual(["id", "name"]);
    expect(result.current.hasNextPage).toBe(true);
    expect(h.fetchPage).toHaveBeenCalledTimes(1);
    expect(h.fetchPage).toHaveBeenCalledWith(undefined);
  });

  it("appends the next page when fetchNext is called, passing the prev cursor", async () => {
    const h = harness({
      pages: [makePage(1, 50, true), makePage(51, 50, true)],
      estimate: 9_000,
    });
    const { result } = renderHook(
      () =>
        useTablePage({
          queryKey: ["t2"],
          fetchPage: h.fetchPage,
          fetchEstimate: h.fetchEstimate,
          fetchExactCount: h.fetchExactCount,
          enabled: true,
        }),
      { wrapper: h.wrapper },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(50));

    act(() => result.current.fetchNext());
    await waitFor(() => expect(result.current.rows).toHaveLength(100));
    expect(h.fetchPage).toHaveBeenCalledTimes(2);
    // Second call receives the cursor returned by the first page.
    expect(h.fetchPage.mock.calls[1]?.[0]).toEqual({
      values: [50],
      direction: "forward",
    });
  });

  it("stops paging once hasNextPage is false", async () => {
    const h = harness({
      pages: [makePage(1, 25, true), makePage(26, 10, false)],
    });
    const { result } = renderHook(
      () =>
        useTablePage({
          queryKey: ["t3"],
          fetchPage: h.fetchPage,
          fetchEstimate: h.fetchEstimate,
          fetchExactCount: h.fetchExactCount,
          enabled: true,
        }),
      { wrapper: h.wrapper },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(25));

    act(() => result.current.fetchNext());
    await waitFor(() => expect(result.current.rows).toHaveLength(35));
    expect(result.current.hasNextPage).toBe(false);

    // Subsequent fetchNext calls are no-ops.
    act(() => result.current.fetchNext());
    act(() => result.current.fetchNext());
    expect(h.fetchPage).toHaveBeenCalledTimes(2);
  });

  it("fetches the estimate alongside the first page", async () => {
    const h = harness({ pages: [makePage(1, 10, false)], estimate: 1_234 });
    const { result } = renderHook(
      () =>
        useTablePage({
          queryKey: ["t4"],
          fetchPage: h.fetchPage,
          fetchEstimate: h.fetchEstimate,
          fetchExactCount: h.fetchExactCount,
          enabled: true,
        }),
      { wrapper: h.wrapper },
    );
    await waitFor(() => expect(result.current.estimate).toBe(1_234));
    expect(h.fetchEstimate).toHaveBeenCalledTimes(1);
  });

  it("does not call fetchExactCount until computeExact is invoked", async () => {
    const h = harness({
      pages: [makePage(1, 10, false)],
      estimate: 1_000,
      exact: 987,
    });
    const { result } = renderHook(
      () =>
        useTablePage({
          queryKey: ["t5"],
          fetchPage: h.fetchPage,
          fetchEstimate: h.fetchEstimate,
          fetchExactCount: h.fetchExactCount,
          enabled: true,
        }),
      { wrapper: h.wrapper },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(10));
    expect(h.fetchExactCount).not.toHaveBeenCalled();
    expect(result.current.exact).toBeNull();

    act(() => result.current.computeExact());
    await waitFor(() => expect(result.current.exact).toBe(987));
    expect(h.fetchExactCount).toHaveBeenCalledTimes(1);
  });

  it("refresh refetches from the first page and clears accumulated rows", async () => {
    // Three fetches: initial, next, then refresh re-fetches the first page only.
    const h = harness({
      pages: [
        makePage(1, 50, true),
        makePage(51, 50, true),
        makePage(1, 50, true), // refresh
      ],
    });
    const { result } = renderHook(
      () =>
        useTablePage({
          queryKey: ["t6"],
          fetchPage: h.fetchPage,
          fetchEstimate: h.fetchEstimate,
          fetchExactCount: h.fetchExactCount,
          enabled: true,
        }),
      { wrapper: h.wrapper },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    act(() => result.current.fetchNext());
    await waitFor(() => expect(result.current.rows).toHaveLength(100));

    await act(async () => {
      await result.current.refresh();
    });
    // After refresh we're back to just the first page.
    expect(result.current.rows).toHaveLength(50);
    expect(result.current.rows[0]).toEqual({ id: 1, name: "row-1" });
    expect(h.fetchPage).toHaveBeenCalledTimes(3);
  });

  it("resets the exact-count latch when the query key changes", async () => {
    const h = harness({
      pages: [makePage(1, 10, false), makePage(1, 10, false)],
      estimate: 100,
      exact: 100,
    });
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        useTablePage({
          queryKey: [key],
          fetchPage: h.fetchPage,
          fetchEstimate: h.fetchEstimate,
          fetchExactCount: h.fetchExactCount,
          enabled: true,
        }),
      { wrapper: h.wrapper, initialProps: { key: "kA" } },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(10));
    act(() => result.current.computeExact());
    await waitFor(() => expect(result.current.exact).toBe(100));

    rerender({ key: "kB" });
    // After a key change, exact resets and a fresh page fetch begins.
    expect(result.current.exact).toBeNull();
  });

  it("propagates fetch errors via isError/error", async () => {
    const h = harness({
      pageOverride: async () => {
        throw new Error("boom");
      },
    });
    const { result } = renderHook(
      () =>
        useTablePage({
          queryKey: ["t8"],
          fetchPage: h.fetchPage,
          fetchEstimate: h.fetchEstimate,
          fetchExactCount: h.fetchExactCount,
          enabled: true,
        }),
      { wrapper: h.wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("boom");
  });

  it("waits for `enabled` before firing any fetcher", async () => {
    const h = harness({ pages: [makePage(1, 5, false)] });
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useTablePage({
          queryKey: ["t9"],
          fetchPage: h.fetchPage,
          fetchEstimate: h.fetchEstimate,
          fetchExactCount: h.fetchExactCount,
          enabled,
        }),
      { wrapper: h.wrapper, initialProps: { enabled: false } },
    );
    // While disabled, nothing fires.
    expect(h.fetchPage).not.toHaveBeenCalled();
    expect(h.fetchEstimate).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.rows).toHaveLength(5));
    expect(h.fetchPage).toHaveBeenCalledTimes(1);
  });
});
