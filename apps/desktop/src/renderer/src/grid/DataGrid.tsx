import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
  type Header,
  type Row,
} from "@tanstack/react-table";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, MoreVertical } from "lucide-react";

import { cn } from "@/lib/utils";

import { Cell } from "./cells";
import { formatCell, isRightAligned, rowToJson, rowToTsv } from "./format";
import type {
  DataGridColumn,
  DataGridProps,
  DataGridRow,
  SortDirection,
  SortSpec,
} from "./types";

const DEFAULT_COL_WIDTH = 160;
const MIN_COL_WIDTH = 60;
const GUTTER_WIDTH = 56;

/**
 * The grid the rest of the product hangs off. Pure presentation +
 * interaction; never fetches data and never knows what database the rows
 * came from. See ./types.ts for the prop contract.
 *
 * Layout notes
 * ────────────
 * One scroll container holds both the sticky header row and the virtualized
 * body. Putting the header inside the same scroller means horizontal scroll
 * shifts header and rows together. A small left gutter (row numbers + row
 * context action) is rendered as its own column so we can give the header
 * cells widths that match the body cells without doing math.
 *
 * Virtualization
 * ──────────────
 * `@tanstack/react-virtual` measures the scroll container; we keep body
 * rows in an absolutely-positioned stack inside a sized spacer. 100k rows
 * is the explicit target, and at 28px rows that's ~2.8M px of virtual
 * height which all major browsers handle fine.
 *
 * Sort
 * ────
 * Stateless. Clicking a header emits the next SortSpec via `onSortChange`
 * and the caller decides whether to refetch. Cycle: unsorted → asc → desc →
 * unsorted again for the same column. Clicking a different column always
 * starts at asc.
 *
 * Selection + copy
 * ────────────────
 * Selection is one cell at a time, tracked locally. Arrow keys move it,
 * Home/End jump within row, PageUp/PageDown move ~one viewport, Cmd/Ctrl+C
 * copies the focused cell formatted through `formatCell` (so what you see
 * is what's on the clipboard). A kebab in each row's gutter opens a tiny
 * menu offering "Copy row as JSON" / "Copy row as TSV".
 *
 * The grid itself has tabIndex=0; arrow-key handlers only fire when the
 * grid (or something inside it) has focus, so it composes cleanly with
 * other focusable widgets on the page.
 */
export function DataGrid({
  columns,
  rows,
  loading = false,
  sort,
  onSortChange,
  onReachEnd,
  reachEndThreshold = 50,
  rowKey,
  emptyMessage = "No rows.",
  rowHeight = 28,
  onExpandCell,
}: DataGridProps) {
  const colDefs = useMemo<ColumnDef<DataGridRow>[]>(
    () =>
      columns.map((col) => ({
        id: col.name,
        accessorKey: col.name,
        size: col.width ?? DEFAULT_COL_WIDTH,
        minSize: col.minWidth ?? MIN_COL_WIDTH,
      })),
    [columns],
  );

  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});

  const table = useReactTable({
    data: rows,
    columns: colDefs,
    state: { columnSizing },
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    enableColumnResizing: true,
    columnResizeMode: "onChange",
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer<HTMLDivElement, Element>({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  // ── onReachEnd: fire once per row-count epoch when the viewport gets within
  // `reachEndThreshold` rows of the bottom. Reset on each new row-count value
  // so successive pages can be requested.
  const lastFiredForCountRef = useRef<number>(-1);
  const checkReachEnd = useCallback(() => {
    if (onReachEnd === undefined) return;
    if (rows.length === 0) return;
    if (lastFiredForCountRef.current === rows.length) return;
    const el = scrollRef.current;
    if (el === null) return;
    const remainingPx = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remainingPx <= reachEndThreshold * rowHeight) {
      lastFiredForCountRef.current = rows.length;
      onReachEnd();
    }
  }, [onReachEnd, reachEndThreshold, rowHeight, rows.length]);

  useEffect(() => {
    if (lastFiredForCountRef.current > rows.length) {
      lastFiredForCountRef.current = -1;
    }
    checkReachEnd();
  }, [rows.length, checkReachEnd]);

  // ── Header sort cycle. asc → desc → null (or → asc when switching columns).
  const onHeaderClick = useCallback(
    (col: DataGridColumn) => {
      if (onSortChange === undefined) return;
      const next = cycleSort(sort ?? null, col.name);
      onSortChange(next);
    },
    [onSortChange, sort],
  );

  // ── Cell selection + keyboard nav.
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Clamp selection if rows shrink underneath us.
    if (selected === null) return;
    if (selected.row >= rows.length || selected.col >= columns.length) {
      setSelected(null);
    }
  }, [rows.length, columns.length, selected]);

  const moveSelection = useCallback(
    (dr: number, dc: number) => {
      setSelected((current) => {
        const base = current ?? { row: 0, col: 0 };
        const nextRow = clamp(base.row + dr, 0, Math.max(0, rows.length - 1));
        const nextCol = clamp(base.col + dc, 0, Math.max(0, columns.length - 1));
        return { row: nextRow, col: nextCol };
      });
    },
    [rows.length, columns.length],
  );

  // Scroll the selected row into view whenever it changes.
  useLayoutEffect(() => {
    if (selected === null) return;
    virtualizer.scrollToIndex(selected.row, { align: "auto" });
  }, [selected, virtualizer]);

  const copyFocusedCell = useCallback(() => {
    if (selected === null) return;
    const row = rows[selected.row];
    const col = columns[selected.col];
    if (row === undefined || col === undefined) return;
    const text = formatCell(col.dbType, row[col.name]);
    void writeClipboard(text);
  }, [selected, rows, columns]);

  const expandFocusedCell = useCallback(() => {
    if (onExpandCell === undefined) return;
    if (selected === null) return;
    const row = rows[selected.row];
    const col = columns[selected.col];
    if (row === undefined || col === undefined) return;
    onExpandCell(col, row[col.name]);
  }, [onExpandCell, selected, rows, columns]);

  const expandCellAt = useCallback(
    (rowIdx: number, colIdx: number) => {
      if (onExpandCell === undefined) return;
      const row = rows[rowIdx];
      const col = columns[colIdx];
      if (row === undefined || col === undefined) return;
      onExpandCell(col, row[col.name]);
    },
    [onExpandCell, rows, columns],
  );

  const copyRow = useCallback(
    (index: number, format: "json" | "tsv") => {
      const row = rows[index];
      if (row === undefined) return;
      const text = format === "json" ? rowToJson(row, columns) : rowToTsv(row, columns);
      void writeClipboard(text);
    },
    [rows, columns],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (rows.length === 0 || columns.length === 0) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        if (selected !== null) {
          e.preventDefault();
          copyFocusedCell();
        }
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        // Space and Enter both open the detail view when a cell is focused.
        // Space is the convention for spreadsheet-style "edit/inspect", and
        // Enter pairs naturally with arrow-key navigation.
        if (selected !== null && onExpandCell !== undefined) {
          e.preventDefault();
          expandFocusedCell();
        }
        return;
      }
      const viewportRows = Math.max(
        1,
        Math.floor((scrollRef.current?.clientHeight ?? rowHeight) / rowHeight) - 1,
      );
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          moveSelection(1, 0);
          break;
        case "ArrowUp":
          e.preventDefault();
          moveSelection(-1, 0);
          break;
        case "ArrowLeft":
          e.preventDefault();
          moveSelection(0, -1);
          break;
        case "ArrowRight":
          e.preventDefault();
          moveSelection(0, 1);
          break;
        case "Home":
          e.preventDefault();
          moveSelection(0, -columns.length);
          break;
        case "End":
          e.preventDefault();
          moveSelection(0, columns.length);
          break;
        case "PageDown":
          e.preventDefault();
          moveSelection(viewportRows, 0);
          break;
        case "PageUp":
          e.preventDefault();
          moveSelection(-viewportRows, 0);
          break;
      }
    },
    [
      rows.length,
      columns.length,
      moveSelection,
      selected,
      copyFocusedCell,
      expandFocusedCell,
      onExpandCell,
      rowHeight,
    ],
  );

  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const totalWidth =
    GUTTER_WIDTH + headers.reduce((acc, h) => acc + h.getSize(), 0);

  const isEmpty = !loading && rows.length === 0;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative flex h-full flex-col bg-background text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
      role="grid"
      aria-rowcount={rows.length}
      aria-colcount={columns.length}
    >
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        onScroll={checkReachEnd}
      >
        <div style={{ width: totalWidth }}>
          <HeaderRow
            headers={headers}
            columns={columns}
            sort={sort ?? null}
            onHeaderClick={onHeaderClick}
          />
          {loading ? (
            <SkeletonBody columns={columns} totalWidth={totalWidth} rowHeight={rowHeight} />
          ) : isEmpty ? (
            <EmptyBody message={emptyMessage} />
          ) : (
            <Body
              virtualizer={virtualizer}
              rowsModel={table.getRowModel().rows}
              columns={columns}
              headers={headers}
              rowHeight={rowHeight}
              totalWidth={totalWidth}
              selected={selected}
              setSelected={setSelected}
              rowKey={rowKey}
              onCopyRow={copyRow}
              onExpandCell={onExpandCell === undefined ? undefined : expandCellAt}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Header row ─────────────────────────────────────────────────────────────

interface HeaderRowProps {
  headers: Header<DataGridRow, unknown>[];
  columns: DataGridColumn[];
  sort: SortSpec | null;
  onHeaderClick: (col: DataGridColumn) => void;
}

function HeaderRow({ headers, columns, sort, onHeaderClick }: HeaderRowProps) {
  return (
    <div
      role="row"
      className="sticky top-0 z-10 flex h-8 border-b bg-muted/70 backdrop-blur-sm"
    >
      <div
        className="flex shrink-0 items-center justify-center border-r text-xs text-muted-foreground/60"
        style={{ width: GUTTER_WIDTH }}
        role="columnheader"
        aria-label="Row number"
      >
        #
      </div>
      {headers.map((header, idx) => {
        const col = columns[idx];
        if (col === undefined) return null;
        const width = header.getSize();
        const dir = sort?.column === col.name ? sort.direction : null;
        const align = col.align ?? (isRightAligned(col.dbType) ? "right" : "left");
        return (
          <HeaderCell
            key={header.id}
            column={col}
            width={width}
            sortDir={dir}
            align={align}
            onClick={() => onHeaderClick(col)}
            onResizeStart={header.getResizeHandler()}
            isResizing={header.column.getIsResizing()}
            isLast={idx === headers.length - 1}
          />
        );
      })}
    </div>
  );
}

interface HeaderCellProps {
  column: DataGridColumn;
  width: number;
  sortDir: SortDirection | null;
  align: "left" | "right" | "center";
  onClick: () => void;
  onResizeStart: (e: React.MouseEvent | React.TouchEvent) => void;
  isResizing: boolean;
  isLast: boolean;
}

function HeaderCell({
  column,
  width,
  sortDir,
  align,
  onClick,
  onResizeStart,
  isResizing,
  isLast,
}: HeaderCellProps) {
  const Icon = sortDir === "asc" ? ArrowUp : sortDir === "desc" ? ArrowDown : ArrowUpDown;
  const iconClass =
    sortDir === null
      ? "opacity-0 group-hover:opacity-50"
      : "opacity-90 text-foreground";
  return (
    <div
      role="columnheader"
      aria-sort={sortDir === "asc" ? "ascending" : sortDir === "desc" ? "descending" : "none"}
      className="relative shrink-0 border-r"
      style={{ width }}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group flex h-full w-full items-center gap-1.5 px-2 text-left text-xs font-medium",
          "text-foreground/80 hover:bg-muted",
          align === "right" && "flex-row-reverse text-right",
          align === "center" && "justify-center",
        )}
      >
        <span className="truncate" title={column.label ?? column.name}>
          {column.label ?? column.name}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground/70">
          <Icon className={cn("h-3 w-3 transition-opacity", iconClass)} aria-hidden />
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50">
          {column.dbType}
        </span>
      </button>
      {!isLast && (
        <div
          onMouseDown={onResizeStart}
          onTouchStart={onResizeStart}
          onClick={(e) => e.stopPropagation()}
          role="separator"
          aria-orientation="vertical"
          className={cn(
            "absolute right-0 top-0 h-full w-1 cursor-col-resize select-none",
            "hover:bg-primary/40",
            isResizing && "bg-primary/60",
          )}
        />
      )}
    </div>
  );
}

// ─── Body (virtualized) ─────────────────────────────────────────────────────

interface BodyProps {
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  rowsModel: Row<DataGridRow>[];
  columns: DataGridColumn[];
  headers: Header<DataGridRow, unknown>[];
  rowHeight: number;
  totalWidth: number;
  selected: { row: number; col: number } | null;
  setSelected: (next: { row: number; col: number }) => void;
  rowKey: ((row: DataGridRow, index: number) => string | number) | undefined;
  onCopyRow: (index: number, format: "json" | "tsv") => void;
  onExpandCell: ((rowIdx: number, colIdx: number) => void) | undefined;
}

function Body({
  virtualizer,
  rowsModel,
  columns,
  headers,
  rowHeight,
  totalWidth,
  selected,
  setSelected,
  rowKey,
  onCopyRow,
  onExpandCell,
}: BodyProps) {
  const virtualItems = virtualizer.getVirtualItems();
  return (
    <div
      style={{ height: virtualizer.getTotalSize(), position: "relative", width: totalWidth }}
      role="rowgroup"
    >
      {virtualItems.map((vi) => {
        const row = rowsModel[vi.index];
        if (row === undefined) return null;
        const original = row.original;
        const key = rowKey !== undefined ? rowKey(original, vi.index) : vi.index;
        return (
          <BodyRow
            key={key}
            top={vi.start}
            height={rowHeight}
            index={vi.index}
            row={original}
            columns={columns}
            headers={headers}
            isSelectedRow={selected?.row === vi.index}
            selectedCol={selected?.row === vi.index ? selected.col : null}
            onSelectCell={(col) => setSelected({ row: vi.index, col })}
            onCopyRow={onCopyRow}
            onExpandCell={onExpandCell}
          />
        );
      })}
    </div>
  );
}

interface BodyRowProps {
  top: number;
  height: number;
  index: number;
  row: DataGridRow;
  columns: DataGridColumn[];
  headers: Header<DataGridRow, unknown>[];
  isSelectedRow: boolean;
  selectedCol: number | null;
  onSelectCell: (col: number) => void;
  onCopyRow: (index: number, format: "json" | "tsv") => void;
  onExpandCell: ((rowIdx: number, colIdx: number) => void) | undefined;
}

function BodyRow({
  top,
  height,
  index,
  row,
  columns,
  headers,
  isSelectedRow,
  selectedCol,
  onSelectCell,
  onCopyRow,
  onExpandCell,
}: BodyRowProps) {
  return (
    <div
      role="row"
      aria-rowindex={index + 1}
      className={cn(
        "group absolute left-0 flex border-b border-border/50",
        isSelectedRow && "bg-accent/40",
        index % 2 === 1 && !isSelectedRow && "bg-muted/20",
      )}
      style={{ top, height, width: "100%" }}
    >
      <RowGutter index={index} onCopyRow={(format) => onCopyRow(index, format)} />
      {headers.map((header, ci) => {
        const col = columns[ci];
        if (col === undefined) return null;
        const value = row[col.name];
        const align = col.align ?? (isRightAligned(col.dbType) ? "right" : "left");
        const isSelected = selectedCol === ci;
        return (
          <div
            key={header.id}
            role="gridcell"
            aria-selected={isSelected}
            onClick={() => onSelectCell(ci)}
            onDoubleClick={(e) => {
              onSelectCell(ci);
              if (onExpandCell === undefined) return;
              e.stopPropagation();
              onExpandCell(index, ci);
            }}
            className={cn(
              "relative flex shrink-0 cursor-default items-center overflow-hidden border-r border-border/40 px-2 text-xs",
              align === "right" && "justify-end",
              align === "center" && "justify-center",
              isSelected && "ring-2 ring-inset ring-primary",
            )}
            style={{ width: header.getSize() }}
          >
            <Cell
              dbType={col.dbType}
              value={value}
              {...(onExpandCell !== undefined
                ? { onExpand: () => onExpandCell(index, ci) }
                : {})}
            />
          </div>
        );
      })}
    </div>
  );
}

function RowGutter({
  index,
  onCopyRow,
}: {
  index: number;
  onCopyRow: (format: "json" | "tsv") => void;
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
    <div
      ref={wrapperRef}
      className="relative flex shrink-0 items-center justify-between border-r border-border/40 px-2 text-[10px] text-muted-foreground/60"
      style={{ width: GUTTER_WIDTH }}
    >
      <span className="tabular-nums">{index + 1}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label={`Row ${index + 1} actions`}
        aria-expanded={open}
        className={cn(
          "rounded p-0.5 opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground",
          "group-hover:opacity-100",
          open && "opacity-100",
        )}
      >
        <MoreVertical className="h-3 w-3" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-full top-0 z-20 ml-1 w-44 rounded-md border bg-popover p-1 text-xs shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onCopyRow("json");
              setOpen(false);
            }}
            className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent"
          >
            Copy row as JSON
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onCopyRow("tsv");
              setOpen(false);
            }}
            className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent"
          >
            Copy row as TSV
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Loading + empty states ─────────────────────────────────────────────────

function SkeletonBody({
  columns,
  totalWidth,
  rowHeight,
}: {
  columns: DataGridColumn[];
  totalWidth: number;
  rowHeight: number;
}) {
  return (
    <div role="status" aria-live="polite" style={{ width: totalWidth }}>
      <span className="sr-only">Loading rows…</span>
      {Array.from({ length: 16 }).map((_, i) => (
        <div
          key={i}
          className="flex border-b border-border/40"
          style={{ height: rowHeight }}
        >
          <div
            className="flex shrink-0 items-center justify-center border-r text-[10px] text-muted-foreground/40"
            style={{ width: GUTTER_WIDTH }}
          >
            {i + 1}
          </div>
          {columns.map((col, ci) => (
            <div
              key={col.name}
              className="flex shrink-0 items-center border-r border-border/40 px-2"
              style={{ width: col.width ?? DEFAULT_COL_WIDTH }}
            >
              <div
                className="h-3 animate-pulse rounded bg-muted-foreground/15"
                style={{ width: `${30 + ((ci * 17) % 40)}%` }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyBody({ message }: { message: string }) {
  return (
    <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
      {message}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function cycleSort(current: SortSpec | null, column: string): SortSpec | null {
  if (current === null || current.column !== column) {
    return { column, direction: "asc" };
  }
  if (current.direction === "asc") return { column, direction: "desc" };
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

async function writeClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some Electron contexts deny clipboard.writeText without user gesture
      // grants; fall through to the synchronous fallback below.
    }
  }
  if (typeof document !== "undefined") {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
  }
}
