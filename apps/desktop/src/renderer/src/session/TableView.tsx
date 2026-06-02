import { useCallback, useMemo, useState } from "react";
import { Loader2, RefreshCw, Sigma } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { SortDef } from "@perspectives/engine";

import { CellDetailDialog, type CellDetailTarget } from "../grid/CellDetail";
import { DataGrid } from "../grid/DataGrid";
import type {
  DataGridColumn,
  DataGridRow,
  SortSpec,
} from "../grid/types";
import { trpc } from "../trpc/client";

import { useTablePage } from "./useTablePage";

interface TableViewProps {
  connectionId: string;
  schema: string;
  table: string;
}

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
const DEFAULT_PAGE_SIZE: PageSize = 100;

const NUMBER_FMT = new Intl.NumberFormat();

/**
 * Live table tab: schema-driven column headers + virtualized rows + keyset
 * pagination via `useTablePage`. Owns the local sort/page-size state, builds
 * the fetcher closures the hook needs, and reflects the sort cycle back into
 * the grid.
 */
export function TableView({ connectionId, schema, table }: TableViewProps) {
  const utils = trpc.useUtils();
  const schemaQuery = trpc.schema.get.useQuery({ connectionId });

  const tableInfo = useMemo(() => {
    if (schemaQuery.data === undefined) return undefined;
    const s = schemaQuery.data.schemas.find((x) => x.name === schema);
    return s?.tables.find((t) => t.name === table);
  }, [schemaQuery.data, schema, table]);

  const gridColumns = useMemo<DataGridColumn[]>(() => {
    if (tableInfo === undefined) return [];
    return tableInfo.columns.map((col) => ({
      name: col.name,
      dbType: col.dataType,
    }));
  }, [tableInfo]);

  const [sort, setSort] = useState<SortSpec | null>(null);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [detailTarget, setDetailTarget] = useState<CellDetailTarget | null>(null);

  const sortDefs = useMemo<SortDef[]>(() => {
    if (sort === null) return [];
    return [{ column: sort.column, direction: sort.direction }];
  }, [sort]);

  // Stable identity for the row-set: any change here resets pagination.
  const queryKey = useMemo(
    () =>
      [
        "tablePage",
        connectionId,
        schema,
        table,
        sortDefs,
        pageSize,
      ] as const,
    [connectionId, schema, table, sortDefs, pageSize],
  );

  const fetchPage = useCallback<
    Parameters<typeof useTablePage>[0]["fetchPage"]
  >(
    async (cursor) => {
      const input: Parameters<typeof utils.client.data.getTablePage.query>[0] = {
        connectionId,
        schema,
        table,
        sort: sortDefs,
        pageSize,
      };
      if (cursor !== undefined) input.cursor = cursor;
      return utils.client.data.getTablePage.query(input);
    },
    [connectionId, schema, table, sortDefs, pageSize, utils.client.data.getTablePage],
  );

  const fetchEstimate = useCallback(async () => {
    return utils.client.data.estimateTable.query({ connectionId, schema, table });
  }, [connectionId, schema, table, utils.client.data.estimateTable]);

  const fetchExactCount = useCallback(async () => {
    return utils.client.data.countTable.query({ connectionId, schema, table });
  }, [connectionId, schema, table, utils.client.data.countTable]);

  const pageState = useTablePage({
    queryKey,
    fetchPage,
    fetchEstimate,
    fetchExactCount,
    enabled: tableInfo !== undefined,
  });

  const onReachEnd = useCallback(() => {
    if (!pageState.hasNextPage) return;
    if (pageState.isFetchingNext) return;
    pageState.fetchNext();
  }, [pageState]);

  const rows: DataGridRow[] = useMemo(
    () => pageState.rows.map((r) => r),
    [pageState.rows],
  );

  if (schemaQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Could not load schema</AlertTitle>
          <AlertDescription>{schemaQuery.error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (tableInfo === undefined && !schemaQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Table not found</AlertTitle>
          <AlertDescription>
            {schema}.{table} is not in the current schema snapshot. Refresh
            the schema sidebar.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TableHeader
        schema={schema}
        table={table}
        estimate={pageState.estimate}
        exact={pageState.exact}
        isExactLoading={pageState.isExactLoading}
        rowsLoadedCount={pageState.rows.length}
        hasNextPage={pageState.hasNextPage}
        isFetchingNext={pageState.isFetchingNext}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
        onRefresh={() => void pageState.refresh()}
        onComputeExact={pageState.computeExact}
      />
      {pageState.isError ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <Alert variant="destructive" className="max-w-md">
            <AlertTitle>Could not load rows</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{pageState.error?.message ?? "Unknown error"}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void pageState.refresh()}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <DataGrid
            columns={gridColumns}
            rows={rows}
            loading={pageState.isInitialLoading || schemaQuery.isPending}
            sort={sort}
            onSortChange={setSort}
            onReachEnd={onReachEnd}
            rowKey={(_row, idx) => idx}
            emptyMessage={`No rows in ${schema}.${table}.`}
            onExpandCell={(col, value) =>
              setDetailTarget({ label: col.name, dbType: col.dbType, value })
            }
          />
        </div>
      )}
      <CellDetailDialog target={detailTarget} onClose={() => setDetailTarget(null)} />
    </div>
  );
}

interface TableHeaderProps {
  schema: string;
  table: string;
  estimate: number | null;
  exact: number | null;
  isExactLoading: boolean;
  rowsLoadedCount: number;
  hasNextPage: boolean;
  isFetchingNext: boolean;
  pageSize: PageSize;
  onPageSizeChange: (next: PageSize) => void;
  onRefresh: () => void;
  onComputeExact: () => void;
}

function TableHeader({
  schema,
  table,
  estimate,
  exact,
  isExactLoading,
  rowsLoadedCount,
  hasNextPage,
  isFetchingNext,
  pageSize,
  onPageSizeChange,
  onRefresh,
  onComputeExact,
}: TableHeaderProps) {
  const countDisplay = formatCount({ estimate, exact, isExactLoading });
  return (
    <div className="flex items-center justify-between gap-3 border-b px-3 py-1.5 text-xs">
      <div className="flex items-baseline gap-2 truncate">
        <span className="font-medium">
          <span className="text-muted-foreground">{schema}.</span>
          {table}
        </span>
        <span className="text-muted-foreground">{countDisplay}</span>
        <span className="text-muted-foreground/70">
          {NUMBER_FMT.format(rowsLoadedCount)} loaded
          {isFetchingNext && " • fetching…"}
          {!hasNextPage && rowsLoadedCount > 0 && " • end reached"}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={onComputeExact}
          disabled={isExactLoading || exact !== null}
          title={exact !== null ? "Exact count loaded" : "Compute exact row count"}
        >
          {isExactLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <Sigma className="h-3 w-3" aria-hidden />
          )}
          Exact count
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={onRefresh}
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
          Refresh
        </Button>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => {
            const n = Number(v);
            if (PAGE_SIZE_OPTIONS.includes(n as PageSize)) {
              onPageSizeChange(n as PageSize);
            }
          }}
        >
          <SelectTrigger className="h-7 w-24 px-2 text-xs">
            <SelectValue placeholder={`${pageSize} / page`} />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={String(opt)} className="text-xs">
                {opt} / page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function formatCount({
  estimate,
  exact,
  isExactLoading,
}: {
  estimate: number | null;
  exact: number | null;
  isExactLoading: boolean;
}): string {
  if (exact !== null) return `${NUMBER_FMT.format(exact)} rows`;
  if (isExactLoading) return "counting…";
  if (estimate !== null) return `~${NUMBER_FMT.format(estimate)} rows`;
  return "…";
}
