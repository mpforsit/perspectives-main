/**
 * Public API for the DataGrid component. Kept deliberately small: a column is
 * { name, dbType, optional width/label/align }; a row is an opaque record
 * keyed by column name. The grid never fetches its own data — callers thread
 * rows through props.
 */

import type { RelationDef } from "@perspectives/engine";

/**
 * Forward-FK annotation on a column. When a column has a `link`, the grid
 * renders its cells as clickable links with a forward-arrow indicator;
 * `onFollowLink(link, row)` fires when the user clicks. The grid stays
 * presentational — it doesn't extract values, doesn't fetch, doesn't open
 * tabs; the TableView caller does all of that.
 *
 * Compound FKs share one ForwardLink across every member column on the
 * source side, so clicking any of them follows the same relation with the
 * same row payload.
 */
export interface ForwardLink {
  /** The relation this cell points to. The caller uses `relation.from.columns`
   *  to extract values from the row and `relation.to.{schema,table,columns}`
   *  to build the target-side filter. */
  relation: RelationDef;
  /** True when `relation.to.columns` is exactly the target table's primary
   *  key in PK order. Custom relations can reference unique non-PK columns;
   *  for those the cell is still navigable but PK-keyed label lookups
   *  (`data.getRowLabels`) don't apply. The label hook uses this flag to
   *  decide which relations participate in batch label fetching. */
  targetIsPk: boolean;
}

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
  /** When set, the grid renders this column's cells as clickable links and
   *  fires `onFollowLink(link, row)` on click. */
  link?: ForwardLink;
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
  /**
   * Follow a forward-FK link. Fired when the user clicks a cell on a
   * column that has a `link` annotation. The grid stays presentational —
   * the caller extracts target values from `link.relation.from.columns`
   * and opens whatever tab semantics it wants.
   */
  onFollowLink?: (link: ForwardLink, row: DataGridRow) => void;
  /**
   * Optional per-cell label lookup. Called only on cells whose column
   * has a `link` annotation; return a human-readable label and the grid
   * renders it in place of the raw FK value. Return `null` to fall back
   * to the raw value (e.g. label hasn't loaded yet).
   *
   * The caller manages the label map / batch fetching; the grid stays
   * presentational and just reads the result on render.
   */
  linkLabelFor?: (column: DataGridColumn, row: DataGridRow) => string | null;
  /**
   * Open the row inspector for `rowIndex`. The grid fires this from two
   * surfaces: the row-number button in the gutter, and the `i` key while
   * a cell in that row is focused. Like other callbacks, the grid stays
   * pure — the caller decides what "open inspector" means.
   */
  onInspectRow?: (rowIndex: number, row: DataGridRow) => void;
  /**
   * Optional fixed-width slot between the gutter and the first data column
   * for per-row badges (cardinality preview). When > 0 the grid reserves
   * the width in both header and body; `badgeHeader` renders into the
   * header slot and `renderRowBadges(idx, row)` into each row's slot.
   * Grid stays presentational — the caller does all formatting / click
   * wiring inside the returned `ReactNode`.
   */
  badgeAreaWidth?: number;
  badgeHeader?: import("react").ReactNode;
  renderRowBadges?: (
    rowIndex: number,
    row: DataGridRow,
  ) => import("react").ReactNode;
}
