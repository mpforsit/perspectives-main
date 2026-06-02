/**
 * Public API for the DataGrid component. Kept deliberately small: a column is
 * { name, dbType, optional width/label/align }; a row is an opaque record
 * keyed by column name. The grid never fetches its own data — callers thread
 * rows through props.
 */

export type SortDirection = "asc" | "desc";

export interface SortSpec {
  column: string;
  direction: SortDirection;
}

export interface DataGridColumn {
  /** Logical column name; used as the key into row records. */
  name: string;
  /** Header label. Defaults to `name`. */
  label?: string;
  /** Database type (e.g. "int4", "timestamptz", "jsonb", "_text"). Drives cell rendering + alignment. */
  dbType: string;
  /** Initial column width in pixels. Defaults to 160. */
  width?: number;
  /** Minimum width when resizing. Defaults to 60. */
  minWidth?: number;
  /** Optional explicit alignment override. */
  align?: "left" | "right" | "center";
}

export type DataGridRow = Record<string, unknown>;

export interface DataGridProps {
  columns: DataGridColumn[];
  rows: DataGridRow[];
  /** Renders the loading skeleton in place of rows. */
  loading?: boolean;
  /** Current sort, controlled by the caller. `null` = unsorted. */
  sort?: SortSpec | null;
  /** Header clicks cycle asc → desc → null and emit through this callback. */
  onSortChange?: (next: SortSpec | null) => void;
  /** Fired when the user scrolls within `reachEndThreshold` rows of the bottom. */
  onReachEnd?: () => void;
  /** How close to the end before `onReachEnd` fires, measured in rows. Default 50. */
  reachEndThreshold?: number;
  /** Optional row identity for React key — defaults to row index. */
  rowKey?: (row: DataGridRow, index: number) => string | number;
  /** Message shown when `rows` is empty and `loading` is false. */
  emptyMessage?: string;
  /** Estimated row height for the virtualizer. Default 28. */
  rowHeight?: number;
  /**
   * Open the cell detail view for `(column, value)`. The grid emits this
   * from: (a) the expand affordance on truncated cells, and (b) the Enter
   * key while a cell is focused. The caller decides whether to render a
   * dialog, a side panel, or nothing.
   */
  onExpandCell?: (column: DataGridColumn, value: unknown) => void;
}
