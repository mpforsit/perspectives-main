import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Settings,
  Sigma,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { FilterGroup, RelationDef, SortDef } from "@perspectives/engine";

import { CellDetailDialog, type CellDetailTarget } from "../grid/CellDetail";
import { DataGrid } from "../grid/DataGrid";
import type {
  DataGridColumn,
  DataGridRow,
  ForwardLink,
  SortSpec,
} from "../grid/types";
import { trpc } from "../trpc/client";

import {
  buildColumnLinkMap,
  buildLinkFilter,
  extractTargetPkValues,
  formatBreadcrumbLabel,
  type BreadcrumbStep,
} from "./links";
import { pickRowValues, type RowValueMap } from "./inspector";
import { RowInspector } from "./RowInspector";
import { TableSettingsDialog } from "./TableSettingsDialog";
import { collapseCrumbs } from "./crumbs";
import { useCrumbLabels } from "./useCrumbLabels";
import { useFkLabels } from "./useFkLabels";
import { useRowCardinalities } from "./useRowCardinalities";
import { useTablePage } from "./useTablePage";
import type { OpenTab } from "./types";

interface TableViewProps {
  connectionId: string;
  schema: string;
  table: string;
  /** Optional row-set filter — set when this tab is a filteredTable
   *  navigated to via forward-FK click. */
  filter?: FilterGroup;
  /** Optional breadcrumb trail — non-empty only on filteredTable tabs. */
  crumbs?: BreadcrumbStep[];
  /** Open a new tab. Phase 2 forward-FK navigation calls back here when
   *  the user clicks an FK cell or a non-tail breadcrumb step. */
  onOpenTab?: (tab: OpenTab) => void;
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
 *
 * Phase 2 additions:
 *   - Optional `filter` prop threads through the engine's getTablePage /
 *     countTable / estimateTable so filtered tabs show only the matching
 *     rows + counts.
 *   - Pulls the relations index and annotates per-column FK links so the
 *     grid can render forward-arrow indicators on clickable cells.
 *   - Handles onFollowLink: verifies the target row exists via
 *     data.getRowByKey, builds the new filteredTable OpenTab + breadcrumb
 *     step, and emits it through `onOpenTab`.
 *   - Renders the breadcrumb trail above the grid when `crumbs` is set.
 */
export function TableView({
  connectionId,
  schema,
  table,
  filter,
  crumbs,
  onOpenTab,
}: TableViewProps) {
  const utils = trpc.useUtils();
  const schemaQuery = trpc.schema.get.useQuery({ connectionId });
  const relationsQuery = trpc.relations.list.useQuery({ connectionId });

  const tableInfo = useMemo(() => {
    if (schemaQuery.data === undefined) return undefined;
    const s = schemaQuery.data.schemas.find((x) => x.name === schema);
    return s?.tables.find((t) => t.name === table);
  }, [schemaQuery.data, schema, table]);

  const linkMap = useMemo<Map<string, RelationDef>>(() => {
    if (relationsQuery.data === undefined) return new Map();
    return buildColumnLinkMap(relationsQuery.data, schema, table);
  }, [relationsQuery.data, schema, table]);

  // Lookup of target tables by `${schema}.${table}` so we can tell which
  // relations point at a target's PK (label-fetch eligible) vs at a unique
  // non-PK column (clickable, but no PK-keyed label lookup).
  const tablesByKey = useMemo(() => {
    const out = new Map<string, { primaryKey: readonly string[] }>();
    if (schemaQuery.data === undefined) return out;
    for (const s of schemaQuery.data.schemas) {
      for (const t of s.tables) {
        out.set(`${s.name}.${t.name}`, { primaryKey: t.primaryKey ?? [] });
      }
    }
    return out;
  }, [schemaQuery.data]);

  const gridColumns = useMemo<DataGridColumn[]>(() => {
    if (tableInfo === undefined) return [];
    return tableInfo.columns.map((col) => {
      const relation = linkMap.get(col.name);
      const base: DataGridColumn = {
        name: col.name,
        dbType: col.dataType,
      };
      if (relation !== undefined) {
        const target = tablesByKey.get(
          `${relation.to.schema}.${relation.to.table}`,
        );
        const pk = target?.primaryKey ?? [];
        const cols = relation.to.columns;
        const targetIsPk =
          pk.length === cols.length &&
          pk.every((c, i) => c === cols[i]);
        const link: ForwardLink = { relation, targetIsPk };
        return { ...base, link };
      }
      return base;
    });
  }, [tableInfo, linkMap, tablesByKey]);

  const [sort, setSort] = useState<SortSpec | null>(null);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [detailTarget, setDetailTarget] = useState<CellDetailTarget | null>(null);
  const [followError, setFollowError] = useState<string | null>(null);
  const [inspectedRow, setInspectedRow] = useState<{
    index: number;
    /** Pre-filtered primitive entries from the focused row, ready to send
     *  over the tRPC `getReferencingCounts` boundary. */
    rowValues: RowValueMap;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  const sortDefs = useMemo<SortDef[]>(() => {
    if (sort === null) return [];
    return [{ column: sort.column, direction: sort.direction }];
  }, [sort]);

  // Stable identity for the row-set: any change here resets pagination.
  // The filter participates by JSON identity so different equality
  // predicates produce different queries.
  const filterKey = useMemo(() => (filter === undefined ? null : JSON.stringify(filter)), [filter]);
  const queryKey = useMemo(
    () =>
      [
        "tablePage",
        connectionId,
        schema,
        table,
        sortDefs,
        pageSize,
        filterKey,
      ] as const,
    [connectionId, schema, table, sortDefs, pageSize, filterKey],
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
      if (filter !== undefined) input.filters = filter;
      return utils.client.data.getTablePage.query(input);
    },
    [connectionId, schema, table, sortDefs, pageSize, filter, utils.client.data.getTablePage],
  );

  const fetchEstimate = useCallback(async () => {
    const input: Parameters<typeof utils.client.data.estimateTable.query>[0] = {
      connectionId,
      schema,
      table,
    };
    if (filter !== undefined) input.filters = filter;
    return utils.client.data.estimateTable.query(input);
  }, [connectionId, schema, table, filter, utils.client.data.estimateTable]);

  const fetchExactCount = useCallback(async () => {
    const input: Parameters<typeof utils.client.data.countTable.query>[0] = {
      connectionId,
      schema,
      table,
    };
    if (filter !== undefined) input.filters = filter;
    return utils.client.data.countTable.query(input);
  }, [connectionId, schema, table, filter, utils.client.data.countTable]);

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

  const handleFollow = useCallback(
    async (link: ForwardLink, sourceRow: DataGridRow) => {
      if (onOpenTab === undefined) return;
      setFollowError(null);
      const relation = link.relation;
      const targetFilter = buildLinkFilter(relation, sourceRow);
      const pkValues = extractTargetPkValues(relation, sourceRow);
      try {
        // Fetch target-side existence + display label in parallel — both
        // hit the same DB but go through different engine paths, so we
        // pipeline them rather than serializing.
        const [row, labels] = await Promise.all([
          utils.client.data.getRowByKey.query({
            connectionId,
            schema: relation.to.schema,
            table: relation.to.table,
            pkValues,
          }),
          utils.client.data.getRowLabels
            .query({
              connectionId,
              schema: relation.to.schema,
              table: relation.to.table,
              pkTuples: [pkValues],
            })
            .catch(() => [] as string[]),
        ]);
        if (row === null) {
          setFollowError(
            `Target row in ${relation.to.schema}.${relation.to.table} not found — the schema may be stale.`,
          );
          return;
        }
        // Phase 2.5: prefer the DisplayConfig-resolved label; fall back
        // to the synthetic `table[pk1,pk2]` when no config is set.
        const resolved = labels[0];
        const crumbLabel =
          resolved !== undefined && resolved.length > 0
            ? resolved
            : formatBreadcrumbLabel(relation.to.table, pkValues);
        const newCrumb: BreadcrumbStep = {
          schema: relation.to.schema,
          table: relation.to.table,
          label: crumbLabel,
          filter: targetFilter,
        };
        const baseCrumb: BreadcrumbStep | null =
          crumbs === undefined || crumbs.length === 0
            ? {
                schema,
                table,
                label: `${table}`,
                filter:
                  filter ?? { op: "and", children: [] },
              }
            : null;
        const nextCrumbs: BreadcrumbStep[] = [
          ...(crumbs ?? (baseCrumb !== null ? [baseCrumb] : [])),
          newCrumb,
        ];
        const tab: OpenTab = {
          kind: "filteredTable",
          id: `ft-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000).toString(36)}`,
          schema: relation.to.schema,
          name: relation.to.table,
          filter: targetFilter,
          crumbs: nextCrumbs,
        };
        onOpenTab(tab);
      } catch (cause: unknown) {
        const message =
          cause instanceof Error
            ? cause.message.replace(/^TRPCClientError:\s*/, "")
            : "Unknown error";
        setFollowError(message);
      }
    },
    [
      onOpenTab,
      utils.client.data.getRowByKey,
      utils.client.data.getRowLabels,
      connectionId,
      schema,
      table,
      filter,
      crumbs,
    ],
  );

  const rows: DataGridRow[] = useMemo(
    () => pageState.rows.map((r) => r),
    [pageState.rows],
  );

  // Phase 2.5: batch-fetch human-readable labels for every visible FK
  // value. The hook owns its own session-scoped cache and returns a
  // synchronous lookup the grid uses on render.
  const linkLabelFor = useFkLabels(connectionId, gridColumns, rows);

  // Phase 2.6: cardinality preview. The DisplayConfig drives which
  // outbound relations to count; the hook batches one round trip per
  // relation per page.
  const displayConfigQuery = trpc.displayConfig.getForTable.useQuery({
    connectionId,
    schema,
    table,
  });
  const cardinalityRelationIds = useMemo(
    () => displayConfigQuery.data?.cardinalityRelations ?? [],
    [displayConfigQuery.data],
  );
  const cardinalitySource = useMemo(
    () => ({
      schema,
      table,
      primaryKey: tableInfo?.primaryKey ?? [],
    }),
    [schema, table, tableInfo?.primaryKey],
  );
  const { countsFor: cardinalityCountsFor, escalate: escalateCardinality } =
    useRowCardinalities({
      connectionId,
      schema: cardinalitySource.schema,
      table: cardinalitySource.table,
      primaryKey: cardinalitySource.primaryKey,
      relationIds: cardinalityRelationIds,
      rows,
    });

  // Per-relation label for the badge ("orders", "tags via …"). Falls back
  // to the target table name when no explicit `label.reverse` was set.
  const cardinalityLabels = useMemo<Map<string, string>>(() => {
    const out = new Map<string, string>();
    for (const id of cardinalityRelationIds) {
      const rel = relationsQuery.data?.find((r) => r.id === id);
      if (rel === undefined) continue;
      if (rel.cardinality === "many-to-many") {
        if (rel.from.schema === schema && rel.from.table === table) {
          out.set(id, rel.label?.forward ?? rel.to.table);
        } else {
          out.set(id, rel.label?.reverse ?? rel.from.table);
        }
      } else {
        out.set(id, rel.label?.reverse ?? rel.from.table);
      }
    }
    return out;
  }, [cardinalityRelationIds, relationsQuery.data, schema, table]);

  const badgeAreaWidth = cardinalityRelationIds.length * 110;
  const renderRowBadges = useCallback(
    (_idx: number, row: DataGridRow) => {
      const slots = cardinalityCountsFor(row);
      return slots.map((slot) => {
        const label = cardinalityLabels.get(slot.relationId) ?? "?";
        const isLoading = slot.count === null;
        const text = isLoading
          ? "—"
          : `${slot.estimated ? "~" : ""}${slot.count} ${label}`;
        const onClick = slot.estimated
          ? (e: React.MouseEvent) => {
              e.stopPropagation();
              void escalateCardinality(row, slot.relationId);
            }
          : undefined;
        return (
          <button
            key={slot.relationId}
            type="button"
            onClick={onClick}
            disabled={!slot.estimated}
            title={
              slot.estimated
                ? "Estimate — click to compute exact"
                : isLoading
                  ? "Loading…"
                  : `${slot.count} ${label}`
            }
            className={`shrink-0 truncate rounded border px-1.5 py-0.5 text-[10px] tabular-nums ${
              isLoading
                ? "border-border/30 text-muted-foreground/60"
                : slot.estimated
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                  : "border-border/40 bg-muted/40 text-foreground/80"
            } ${onClick !== undefined ? "cursor-pointer" : "cursor-default"}`}
          >
            {text}
          </button>
        );
      });
    },
    [cardinalityCountsFor, cardinalityLabels, escalateCardinality],
  );

  // Inspector wiring. Clicking the row-number gutter or pressing `i`
  // captures the row's primitive entries (we ship those over IPC; custom
  // relations may reference any unique column, not just the PK).
  const handleInspectRow = useCallback(
    (rowIndex: number, sourceRow: DataGridRow) => {
      if (tableInfo === undefined) return;
      const pk = tableInfo.primaryKey;
      if (pk === undefined || pk.length === 0) {
        setFollowError(
          `Table ${schema}.${table} has no primary key — row inspector is unavailable.`,
        );
        return;
      }
      setInspectedRow({ index: rowIndex, rowValues: pickRowValues(sourceRow) });
    },
    [tableInfo, schema, table],
  );

  // "Referenced by" counts via tRPC, keyed by the focused row's primitive
  // values. The row identity participates in the tRPC input → TanStack Query
  // deep-equals the cache key, so two opens of the same row hit the cache.
  const countsQuery = trpc.data.getReferencingCounts.useQuery(
    inspectedRow !== null
      ? {
          connectionId,
          schema,
          table,
          rowValues: inspectedRow.rowValues,
        }
      : undefined!, // never used when enabled=false; tRPC tolerates undefined
    { enabled: inspectedRow !== null && tableInfo !== undefined },
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
      {crumbs !== undefined && crumbs.length > 0 && (
        <BreadcrumbBarWithLabels
          crumbs={crumbs}
          connectionId={connectionId}
          tablesByKey={tablesByKey}
          {...(onOpenTab !== undefined ? { onOpenTab } : {})}
        />
      )}
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
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {followError !== null && (
        <div className="border-b bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          {followError}
          <button
            type="button"
            onClick={() => setFollowError(null)}
            className="ml-2 underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}
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
        <div className="flex flex-1 overflow-hidden">
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
              {...(onOpenTab !== undefined
                ? { onFollowLink: handleFollow }
                : {})}
              onInspectRow={handleInspectRow}
              linkLabelFor={linkLabelFor}
              badgeAreaWidth={badgeAreaWidth}
              {...(cardinalityRelationIds.length > 0
                ? {
                    badgeHeader: "Counts",
                    renderRowBadges,
                  }
                : {})}
            />
          </div>
          {inspectedRow !== null &&
            tableInfo !== undefined &&
            (() => {
              const inspected = rows[inspectedRow.index];
              if (inspected === undefined) return null;
              const pk = tableInfo.primaryKey ?? [];
              return (
                <RowInspector
                  schema={schema}
                  table={table}
                  columns={gridColumns}
                  row={inspected}
                  pkOrder={pk}
                  rowValues={inspectedRow.rowValues}
                  relations={relationsQuery.data ?? []}
                  counts={countsQuery.data ?? null}
                  isCountsLoading={countsQuery.isPending && countsQuery.isFetching}
                  isCountsError={countsQuery.isError}
                  countsErrorMessage={countsQuery.error?.message ?? null}
                  onRefreshCounts={() => void countsQuery.refetch()}
                  {...(onOpenTab !== undefined ? { onOpenTab } : {})}
                  {...(crumbs !== undefined ? { parentCrumbs: crumbs } : {})}
                  onClose={() => setInspectedRow(null)}
                />
              );
            })()}
        </div>
      )}
      <CellDetailDialog target={detailTarget} onClose={() => setDetailTarget(null)} />
      {tableInfo !== undefined && (
        <TableSettingsDialog
          open={settingsOpen}
          connectionId={connectionId}
          schema={schema}
          table={table}
          columns={tableInfo.columns}
          primaryKey={tableInfo.primaryKey ?? []}
          relations={relationsQuery.data ?? []}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Breadcrumb trail (Phase 2.2 foundation, 2.7 polish).
 *
 * Layout:
 *   [◀ back] [head] › (… hidden) › [tail-1] › [tail-0 (current, bold)]
 *
 *   - The back button re-opens the second-to-last crumb; also triggered
 *     by Cmd/Ctrl+[ while this tab is mounted.
 *   - Trails of 5+ hops collapse the middle behind a "…" dropdown; the
 *     dropdown lists every hidden step, each clickable.
 *   - Labels come from `data.getRowLabels` when the crumb's filter maps
 *     to a target PK tuple; otherwise the persisted PK-based label is
 *     used as a fallback. Self-referential chains render every hop —
 *     dedup would lie about the traversal depth.
 */
/** Wrapper that resolves labels through tRPC. Keeping the label lookup
 *  here lets the presentational `BreadcrumbBar` stay tRPC-free — the
 *  overflow-collapse renderer test mounts it directly without a query
 *  client or IPC bridge. */
function BreadcrumbBarWithLabels({
  crumbs,
  connectionId,
  tablesByKey,
  onOpenTab,
}: {
  crumbs: BreadcrumbStep[];
  connectionId: string;
  tablesByKey: ReadonlyMap<string, { primaryKey: readonly string[] }>;
  onOpenTab?: (tab: OpenTab) => void;
}) {
  const resolvedLabels = useCrumbLabels({
    connectionId,
    crumbs,
    tablesByKey,
  });
  return (
    <BreadcrumbBar
      crumbs={crumbs}
      resolvedLabels={resolvedLabels}
      {...(onOpenTab !== undefined ? { onOpenTab } : {})}
    />
  );
}

export function BreadcrumbBar({
  crumbs,
  resolvedLabels,
  onOpenTab,
}: {
  crumbs: BreadcrumbStep[];
  resolvedLabels: Map<number, string>;
  onOpenTab?: (tab: OpenTab) => void;
}) {
  const layout = useMemo(() => collapseCrumbs(crumbs), [crumbs]);

  const openCrumb = useCallback(
    (index: number) => {
      if (onOpenTab === undefined) return;
      const step = crumbs[index];
      if (step === undefined) return;
      onOpenTab({
        kind: "filteredTable",
        id: `ft-${Date.now().toString(36)}-${index}`,
        schema: step.schema,
        name: step.table,
        filter: step.filter,
        crumbs: crumbs.slice(0, index + 1),
      });
    },
    [crumbs, onOpenTab],
  );

  // Back-step: Cmd/Ctrl+[ opens the second-to-last crumb (same as
  // clicking it). The listener is document-scoped but only mounted
  // while this TableView is visible — SessionView unmounts inactive
  // tabs via its keyed conditional render, so we don't fire on the
  // wrong tab.
  useEffect(() => {
    if (onOpenTab === undefined || crumbs.length < 2) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "[") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      // Avoid stealing text-input shortcuts. Focused inputs / textareas
      // handle [ themselves.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }
      e.preventDefault();
      openCrumb(crumbs.length - 2);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [crumbs.length, onOpenTab, openCrumb]);

  const renderCrumb = (
    step: BreadcrumbStep,
    index: number,
    isTail: boolean,
  ) => {
    const label = resolvedLabels.get(index) ?? step.label;
    const inner = (
      <span
        className={cn(
          "whitespace-nowrap",
          isTail ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    );
    return isTail || onOpenTab === undefined ? (
      inner
    ) : (
      <button
        type="button"
        onClick={() => openCrumb(index)}
        className="rounded px-1 hover:bg-accent hover:text-foreground"
      >
        {inner}
      </button>
    );
  };

  const canGoBack = onOpenTab !== undefined && crumbs.length >= 2;

  return (
    <nav
      aria-label="Navigation trail"
      className="flex items-center gap-1 overflow-x-auto border-b bg-muted/30 px-2 py-1.5 text-xs"
    >
      <button
        type="button"
        onClick={() => openCrumb(crumbs.length - 2)}
        disabled={!canGoBack}
        title="Back one step (Cmd/Ctrl+[)"
        aria-label="Back one step"
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded",
          canGoBack
            ? "text-muted-foreground hover:bg-accent hover:text-foreground"
            : "cursor-not-allowed text-muted-foreground/30",
        )}
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      </button>

      <span className="flex items-center gap-1">
        {renderCrumb(layout.head, layout.head.index, crumbs.length === 1)}
      </span>

      {layout.collapsed && (
        <>
          <ChevronRight
            className="h-3 w-3 text-muted-foreground/60"
            aria-hidden
          />
          <CrumbOverflowMenu
            hidden={layout.hidden}
            resolvedLabels={resolvedLabels}
            onSelect={openCrumb}
            disabled={onOpenTab === undefined}
          />
        </>
      )}

      {layout.tail.map((step) => {
        const isTail = step.index === crumbs.length - 1;
        return (
          <span key={step.index} className="flex items-center gap-1">
            <ChevronRight
              className="h-3 w-3 text-muted-foreground/60"
              aria-hidden
            />
            {renderCrumb(step, step.index, isTail)}
          </span>
        );
      })}
    </nav>
  );
}

/** Ellipsis-dropdown of the crumbs that overflow collapse hides. */
function CrumbOverflowMenu({
  hidden,
  resolvedLabels,
  onSelect,
  disabled,
}: {
  hidden: Array<BreadcrumbStep & { index: number }>;
  resolvedLabels: Map<number, string>;
  onSelect: (index: number) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Show ${hidden.length} hidden step${hidden.length === 1 ? "" : "s"}`}
        title={`${hidden.length} hidden step${hidden.length === 1 ? "" : "s"}`}
        className="flex h-6 items-center gap-0.5 rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <MoreHorizontal className="h-3 w-3" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 w-56 rounded-md border bg-popover p-1 text-xs shadow-md"
        >
          {hidden.map((step) => {
            const label = resolvedLabels.get(step.index) ?? step.label;
            return (
              <button
                key={step.index}
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => {
                  setOpen(false);
                  onSelect(step.index);
                }}
                className="block w-full truncate rounded px-2 py-1.5 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                title={`${step.schema}.${step.table}`}
              >
                <span className="text-muted-foreground/70">
                  {step.schema}.{step.table}
                </span>{" "}
                <span className="text-foreground">{label}</span>
              </button>
            );
          })}
        </div>
      )}
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
  onOpenSettings: () => void;
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
  onOpenSettings,
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
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onOpenSettings}
          title="Table settings (display, junction policy, …)"
          aria-label="Table settings"
        >
          <Settings className="h-3.5 w-3.5" aria-hidden />
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
