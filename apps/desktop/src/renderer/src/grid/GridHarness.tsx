import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

import { CellDetailDialog, type CellDetailTarget } from "./CellDetail";
import { DataGrid } from "./DataGrid";
import { MOCK_COLUMNS, makeMockRows } from "./mock";
import type { DataGridRow, SortSpec } from "./types";

const INITIAL_COUNT = 200;
const PAGE_SIZE = 500;

/**
 * Dev-only harness for the grid. Mounted by `App.tsx` when
 * `window.location.hash === "#grid"`. Renders mock rows so the grid can be
 * developed and demoed without a database. Append-on-reach-end + sort wired
 * so the full interaction loop is exercised.
 */
export function GridHarness({ onLeave }: { onLeave: () => void }) {
  const [count, setCount] = useState<number>(INITIAL_COUNT);
  const [sort, setSort] = useState<SortSpec | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [emptyMode, setEmptyMode] = useState<boolean>(false);
  const [detail, setDetail] = useState<CellDetailTarget | null>(null);

  // Generate then optionally sort. Sort is in-memory — it's a dev harness.
  const baseRows = useMemo(() => makeMockRows(count), [count]);
  const rows: DataGridRow[] = useMemo(() => {
    if (sort === null) return baseRows;
    const sorted = [...baseRows].sort((a, b) => compareCells(a[sort.column], b[sort.column]));
    if (sort.direction === "desc") sorted.reverse();
    return sorted;
  }, [baseRows, sort]);

  const onReachEnd = useCallback(() => {
    setCount((c) => c + PAGE_SIZE);
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-3 py-2">
        <Button variant="ghost" size="sm" onClick={onLeave}>
          ← Back
        </Button>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{rows.length.toLocaleString()} rows</span>
          {sort !== null && (
            <span>
              sort: <code className="rounded bg-muted px-1">{sort.column}</code> {sort.direction}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLoading((v) => !v)}
          >
            {loading ? "Stop loading" : "Toggle loading"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEmptyMode((v) => !v)}
          >
            {emptyMode ? "Refill" : "Empty"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCount((c) => c + 10_000)}
          >
            +10k rows
          </Button>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <DataGrid
          columns={MOCK_COLUMNS}
          rows={emptyMode ? [] : rows}
          loading={loading}
          sort={sort}
          onSortChange={setSort}
          onReachEnd={onReachEnd}
          rowKey={(row, idx) =>
            typeof row.id === "number" || typeof row.id === "string"
              ? row.id
              : idx
          }
          emptyMessage="No mock rows. Toggle 'Refill' to add some."
          onExpandCell={(col, value) =>
            setDetail({ label: col.name, dbType: col.dbType, value })
          }
        />
      </main>
      <footer className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        Click a header to sort • drag the right edge to resize • arrows to
        navigate • Enter on a cell to inspect • Cmd/Ctrl+C to copy • hover a
        row&apos;s gutter for &quot;Copy as JSON/TSV&quot;
      </footer>
      <CellDetailDialog target={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function compareCells(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}
