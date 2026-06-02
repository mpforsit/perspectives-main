/**
 * The pagination + count state machine behind the table view.
 *
 * It owns three TanStack Query handles — an infinite query for paged rows,
 * a query for the cheap estimate, and an on-demand exact count — and exposes
 * a flat row list plus the verbs the view needs ("fetch next", "refresh",
 * "compute exact count").
 *
 * Fetchers are passed in rather than baked against tRPC so the hook can be
 * unit-tested against in-memory mocks. The real caller wires them up via
 * `utils.client.data.*.query(...)` from `trpc/client.ts`.
 */

import { useCallback, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";

import type {
  Cursor,
  PageResult,
  ResultColumn,
  ResultRow,
} from "@perspectives/engine";

export interface UseTablePageArgs {
  /** Stable identity for the row-set; anything that changes here resets pagination. */
  queryKey: readonly unknown[];
  fetchPage: (cursor: Cursor | undefined) => Promise<PageResult>;
  fetchEstimate: () => Promise<number>;
  fetchExactCount: () => Promise<number>;
  /** Disable the queries until a connection is live. */
  enabled: boolean;
}

export interface TablePageState {
  /** All rows accumulated so far across fetched pages. */
  rows: ResultRow[];
  /** Columns reported by the first page (authoritative for the live result set). */
  serverColumns: ResultColumn[];
  isInitialLoading: boolean;
  isFetchingNext: boolean;
  isError: boolean;
  error: Error | null;
  hasNextPage: boolean;
  /** Fire-and-forget; no-op if a fetch is already in flight or no pages remain. */
  fetchNext: () => void;
  /** Refetch from the first page, clearing accumulated rows. */
  refresh: () => Promise<void>;
  estimate: number | null;
  exact: number | null;
  isExactLoading: boolean;
  exactError: Error | null;
  /** Trigger the slow count; updates `exact` when done. */
  computeExact: () => void;
}

const PAGE_KEY_PREFIX = "tablePage";
const ESTIMATE_KEY_PREFIX = "tableEstimate";
const COUNT_KEY_PREFIX = "tableCount";

export function useTablePage({
  queryKey,
  fetchPage,
  fetchEstimate,
  fetchExactCount,
  enabled,
}: UseTablePageArgs): TablePageState {
  const qc = useQueryClient();

  // TanStack Query deep-equals query keys, so we can build these inline each
  // render without churning the cache. The reset latch below uses a stable
  // string hash to detect *value* changes (queryKey may be a new array each
  // render even when its contents are unchanged — common in tests and
  // callers that build the array inline).
  const pagesKey = [PAGE_KEY_PREFIX, ...queryKey] as readonly unknown[];
  const estimateKey = [ESTIMATE_KEY_PREFIX, ...queryKey] as readonly unknown[];
  const countKey = [COUNT_KEY_PREFIX, ...queryKey] as readonly unknown[];
  const keyHash = JSON.stringify(queryKey);

  const pages = useInfiniteQuery<
    PageResult,
    Error,
    InfiniteData<PageResult, Cursor | undefined>,
    readonly unknown[],
    Cursor | undefined
  >({
    queryKey: pagesKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? null,
    enabled,
    // Pagination cursors are tied to a snapshot; staleness is the user's call
    // via the explicit Refresh button. No automatic background refetch.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const estimate = useQuery<number, Error>({
    queryKey: estimateKey,
    queryFn: fetchEstimate,
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Exact count is opt-in (expensive). We manage it as a manually-triggered
  // query stored under its own key — `enabled: false` means it never fires
  // until `computeExact` runs `qc.fetchQuery`.
  const [exactRequested, setExactRequested] = useState<boolean>(false);
  const exactCount = useQuery<number, Error>({
    queryKey: countKey,
    queryFn: fetchExactCount,
    enabled: enabled && exactRequested,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const computeExact = useCallback(() => {
    setExactRequested(true);
    // If we've already counted this same query key, refetch — covers "click
    // Refresh, then click Count" after pages have shifted.
    if (exactRequested) void qc.refetchQueries({ queryKey: countKey });
  }, [countKey, exactRequested, qc]);

  // Reset the exact-count latch whenever the query identity changes — e.g.
  // a new sort or page size: a stale exact is misleading. React's
  // "store previous prop in state" pattern: assignment during render is
  // allowed when the value differs, and React re-renders cleanly. We compare
  // hashes so the latch doesn't trip on identity-only changes to queryKey.
  const [prevHash, setPrevHash] = useState<string>(keyHash);
  if (prevHash !== keyHash) {
    setPrevHash(keyHash);
    setExactRequested(false);
  }

  const refresh = useCallback(async () => {
    setExactRequested(false);
    // `resetQueries` clears the accumulated pages back to a single page, then
    // the observer's enabled subscription triggers an immediate refetch — so
    // the user lands back at page 1 instead of seeing the previously-loaded
    // pages refresh in place. Estimate is just re-pulled.
    await qc.resetQueries({ queryKey: pagesKey });
    await estimate.refetch();
  }, [estimate, pagesKey, qc]);

  const fetchNext = useCallback(() => {
    if (pages.isFetchingNextPage) return;
    if (pages.hasNextPage !== true) return;
    void pages.fetchNextPage();
  }, [pages]);

  const flatRows = useMemo<ResultRow[]>(() => {
    if (pages.data === undefined) return [];
    return pages.data.pages.flatMap((p) => p.rows);
  }, [pages.data]);

  const serverColumns = pages.data?.pages[0]?.columns ?? [];

  return {
    rows: flatRows,
    serverColumns,
    isInitialLoading: pages.isPending,
    isFetchingNext: pages.isFetchingNextPage,
    isError: pages.isError,
    error: pages.error ?? null,
    hasNextPage: pages.hasNextPage === true,
    fetchNext,
    refresh,
    estimate: estimate.data ?? null,
    exact: exactCount.data ?? null,
    isExactLoading: exactCount.isFetching && exactRequested,
    exactError: exactCount.error ?? null,
    computeExact,
  };
}
