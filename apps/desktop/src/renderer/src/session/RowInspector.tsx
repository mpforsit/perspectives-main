import { useMemo, useState } from "react";
import { Loader2, Sigma, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { RelationDef } from "@perspectives/engine";

import { CellDetailDialog, type CellDetailTarget } from "../grid/CellDetail";
import { Cell } from "../grid/cells";
import type { DataGridColumn, DataGridRow } from "../grid/types";

import { buildReferencingTarget, type RowValueMap } from "./inspector";
import type { BreadcrumbStep } from "./links";
import type { OpenTab } from "./types";

const NUMBER_FMT = new Intl.NumberFormat();

export interface RowInspectorProps {
  schema: string;
  table: string;
  /** Columns in the same order as the grid renders them. */
  columns: DataGridColumn[];
  /** The focused row's data. */
  row: DataGridRow;
  /** Primary-key column order for the focused table. Used for the panel
   *  header display only (the relation filters look up values by column
   *  name through `rowValues`, not by index). */
  pkOrder: readonly string[];
  /** Pre-filtered row values (primitives only). Same shape the engine
   *  receives over tRPC. */
  rowValues: RowValueMap;
  /** Every RelationDef for this connection (`relations.list`). The
   *  inspector filters down to the ones that reference the focused table. */
  relations: readonly RelationDef[];
  /** "Referenced by" counts from `data.getReferencingCounts`, keyed by
   *  relation id. */
  counts:
    | Array<{ relationId: string; count: number; estimated: boolean }>
    | null;
  isCountsLoading: boolean;
  isCountsError: boolean;
  countsErrorMessage: string | null;
  /** Optional callback to recompute counts (e.g. on Refresh). */
  onRefreshCounts?: () => void;
  /** Optional callback to escalate a single estimated relation to exact. */
  onEscalateToExact?: (relationId: string) => void;
  /** Open a navigation tab (filtered by the "Referenced by" target). */
  onOpenTab?: (tab: OpenTab) => void;
  /** Existing breadcrumb trail — empty for plain-table tabs, populated for
   *  filteredTable tabs. The inspector prepends the focused row's origin
   *  step when opening a new tab. */
  parentCrumbs?: BreadcrumbStep[];
  /** Close the inspector. */
  onClose: () => void;
}

/**
 * Right-side row inspector. Top half: row fields. Bottom half: "Referenced
 * by" entries with cardinality counts.
 *
 * Phase 2.3 surfaces inbound 1:n relations and m:n junctions. m:n entries
 * navigate to the junction table filtered by the focused row's PK (a
 * one-hop drill-in); the user follows the second FK to land at the
 * far-side table. Phase 2.5's display config will refine the labels.
 */
export function RowInspector({
  schema,
  table,
  columns,
  row,
  pkOrder,
  rowValues,
  relations,
  counts,
  isCountsLoading,
  isCountsError,
  countsErrorMessage,
  onRefreshCounts,
  onEscalateToExact,
  onOpenTab,
  parentCrumbs,
  onClose,
}: RowInspectorProps) {
  const [detailTarget, setDetailTarget] = useState<CellDetailTarget | null>(null);

  const countsByRelationId = useMemo(() => {
    const map = new Map<string, { count: number; estimated: boolean }>();
    for (const entry of counts ?? []) {
      map.set(entry.relationId, { count: entry.count, estimated: entry.estimated });
    }
    return map;
  }, [counts]);

  // Build "Referenced by" entries: walk every relation, compute a target
  // when applicable. Skip relations the engine has already suppressed (the
  // engine's getReferencingCounts drops junction-component 1:n's; we only
  // surface a row when the engine returned a count for it).
  const entries = useMemo(() => {
    const out: Array<{
      relation: RelationDef;
      count: number | null;
      estimated: boolean;
      caption: string;
      onOpen: () => void;
    }> = [];
    // PK values, derived from rowValues + pkOrder, for the breadcrumb-origin
    // crumb when this row's tab doesn't carry one yet.
    const pkValues = pkOrder.map((col) =>
      col in rowValues ? rowValues[col] ?? null : null,
    );
    for (const relation of relations) {
      const target = buildReferencingTarget(relation, schema, table, rowValues);
      if (target === null) continue;
      const c = countsByRelationId.get(relation.id);
      // The engine returns one entry per emitted relation. If we have no
      // entry here, the engine suppressed it (junction component) or the
      // counts haven't loaded — keep the entry out in both cases. Tests
      // assert this.
      if (c === undefined) continue;
      out.push({
        relation,
        count: c.count,
        estimated: c.estimated,
        caption: target.caption,
        onOpen: () => {
          if (onOpenTab === undefined) return;
          const baseCrumb: BreadcrumbStep | null =
            parentCrumbs === undefined || parentCrumbs.length === 0
              ? {
                  schema,
                  table,
                  label: `${table}[${pkValues
                    .map((v) => (v === null ? "∅" : String(v)))
                    .join(",")}]`,
                  filter: {
                    op: "and",
                    children: pkOrder.map((col, i) => ({
                      column: col,
                      op: "eq",
                      value: (pkValues[i] ?? null) as null | string | number | boolean,
                    })),
                  },
                }
              : null;
          const nextCrumbs: BreadcrumbStep[] = [
            ...(parentCrumbs ?? (baseCrumb !== null ? [baseCrumb] : [])),
            target.crumb,
          ];
          onOpenTab({
            kind: "filteredTable",
            id: `ft-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000).toString(36)}`,
            schema: target.schema,
            name: target.table,
            filter: target.filter,
            crumbs: nextCrumbs,
          });
        },
      });
    }
    return out;
  }, [
    relations,
    schema,
    table,
    pkOrder,
    rowValues,
    countsByRelationId,
    onOpenTab,
    parentCrumbs,
  ]);

  return (
    <aside
      aria-label={`Row inspector for ${schema}.${table}`}
      className="flex h-full w-96 shrink-0 flex-col overflow-hidden border-l bg-background"
    >
      <header className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex flex-col">
          <span className="text-xs font-medium">Row inspector</span>
          <span className="text-[11px] text-muted-foreground">
            {schema}.{table} —{" "}
            {pkOrder
              .map((col) =>
                col in rowValues ? String(rowValues[col] ?? "∅") : "∅",
              )
              .join(", ")}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          aria-label="Close inspector"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </header>

      <section className="border-b">
        <h3 className="px-3 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Fields
        </h3>
        <div className="max-h-[40vh] overflow-y-auto p-3">
          <dl className="space-y-1.5 text-xs">
            {columns.map((col) => {
              const value = row[col.name];
              const isLongText =
                typeof value === "string" && value.length > 60;
              return (
                <div key={col.name} className="flex items-start gap-2">
                  <dt
                    className="w-32 shrink-0 truncate font-mono text-[10px] text-muted-foreground"
                    title={col.name}
                  >
                    {col.name}
                  </dt>
                  <dd
                    className={cn(
                      "min-w-0 flex-1 break-words",
                      isLongText && "cursor-pointer hover:bg-muted/50",
                    )}
                    onClick={() => {
                      if (isLongText) {
                        setDetailTarget({
                          label: col.name,
                          dbType: col.dbType,
                          value,
                        });
                      }
                    }}
                  >
                    <Cell dbType={col.dbType} value={value} />
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </section>

      <section className="flex flex-1 flex-col overflow-hidden">
        <h3 className="flex items-center justify-between px-3 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Referenced by
          {onRefreshCounts !== undefined && (
            <button
              type="button"
              onClick={onRefreshCounts}
              className="text-[10px] normal-case text-muted-foreground/70 hover:text-foreground"
            >
              Refresh
            </button>
          )}
        </h3>
        <div className="flex-1 overflow-y-auto p-3">
          {isCountsLoading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Computing counts…
            </p>
          ) : isCountsError ? (
            <p className="text-xs text-destructive">
              Couldn&apos;t load counts — {countsErrorMessage ?? "unknown error"}
            </p>
          ) : entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No tables reference this row.
            </p>
          ) : (
            <ul className="space-y-1">
              {entries.map(({ relation, count, estimated, caption, onOpen }) => (
                <li key={relation.id}>
                  <button
                    type="button"
                    onClick={onOpen}
                    disabled={onOpenTab === undefined}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs",
                      "hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent",
                    )}
                  >
                    <span className="truncate">{caption}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono tabular-nums text-[11px]",
                        estimated && "text-muted-foreground",
                      )}
                    >
                      {estimated ? "~" : ""}
                      {count === null ? "?" : NUMBER_FMT.format(count)}
                      {estimated && onEscalateToExact !== undefined && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEscalateToExact(relation.id);
                          }}
                          className="ml-1.5 inline-flex items-center text-muted-foreground/60 hover:text-foreground"
                          aria-label="Compute exact count"
                          title="Compute exact count"
                        >
                          <Sigma className="h-3 w-3" aria-hidden />
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <CellDetailDialog target={detailTarget} onClose={() => setDetailTarget(null)} />
    </aside>
  );
}
