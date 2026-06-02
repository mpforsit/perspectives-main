import { Binary, Check, Maximize2, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  bytesLength,
  classifyCell,
  formatDate,
  formatJson,
  formatNumber,
  formatTimestamp,
  truncate,
  type CellKind,
} from "./format";

const TEXT_EXPAND_THRESHOLD = 80;

interface CellProps {
  dbType: string;
  value: unknown;
  /** Open the cell detail view. Surfaces the affordance on cells that have
   *  more to show than the inline truncation reveals. */
  onExpand?: () => void;
}

/**
 * Renders one cell. Knows nothing about layout or selection — that's the
 * grid's job. We classify once here and dispatch to a small set of
 * presentational sub-components so the markup stays grep-friendly when we
 * add type variants later.
 */
export function Cell({ dbType, value, onExpand }: CellProps) {
  const kind = classifyCell(dbType, value);
  switch (kind) {
    case "null":
      return <NullBadge />;
    case "boolean":
      return <BooleanCell value={value as boolean} />;
    case "number":
      return <span className="tabular-nums text-foreground">{formatNumber(value)}</span>;
    case "timestamp":
      return (
        <span className="tabular-nums text-foreground" title={String(value)}>
          {formatTimestamp(value)}
        </span>
      );
    case "date":
      return (
        <span className="tabular-nums text-foreground" title={String(value)}>
          {formatDate(value)}
        </span>
      );
    case "time":
      return <span className="tabular-nums text-foreground">{String(value)}</span>;
    case "json":
    case "array":
      return onExpand === undefined ? (
        <JsonCell value={value} />
      ) : (
        <JsonCell value={value} onExpand={onExpand} />
      );
    case "bytes":
      return onExpand === undefined ? (
        <BytesCell value={value} />
      ) : (
        <BytesCell value={value} onExpand={onExpand} />
      );
    case "text":
      return onExpand === undefined ? (
        <TextCell value={value} />
      ) : (
        <TextCell value={value} onExpand={onExpand} />
      );
  }
}

export function NullBadge() {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 italic">
      NULL
    </span>
  );
}

export function BooleanCell({ value }: { value: boolean }) {
  if (value === true) {
    return (
      <span className="inline-flex items-center gap-1 text-foreground">
        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <span className="text-xs">true</span>
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus className="h-3.5 w-3.5" aria-hidden />
        <span className="text-xs">false</span>
      </span>
    );
  }
  return <TextCell value={String(value)} />;
}

function TextCell({ value, onExpand }: { value: unknown; onExpand?: () => void }) {
  const s = typeof value === "string" ? value : String(value);
  const isLong = s.length > TEXT_EXPAND_THRESHOLD;
  return (
    <span className="inline-flex max-w-full items-center gap-1 text-foreground">
      <span
        className="overflow-hidden text-ellipsis whitespace-nowrap"
        title={isLong ? s : undefined}
      >
        {s}
      </span>
      {isLong && onExpand !== undefined && <ExpandButton onExpand={onExpand} />}
    </span>
  );
}

function BytesCell({ value, onExpand }: { value: unknown; onExpand?: () => void }) {
  const length = bytesLength(value);
  const label =
    length !== null
      ? `bytea ${length.toLocaleString()} B`
      : "bytea";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Binary className="h-3 w-3" aria-hidden />
      <span>{label}</span>
      {onExpand !== undefined && <ExpandButton onExpand={onExpand} alwaysVisible />}
    </span>
  );
}

function ExpandButton({
  onExpand,
  alwaysVisible = false,
}: {
  onExpand: () => void;
  alwaysVisible?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onExpand();
      }}
      className={cn(
        "shrink-0 rounded p-0.5 text-muted-foreground/60 transition-opacity",
        "hover:bg-foreground/10 hover:text-foreground",
        alwaysVisible
          ? "opacity-60 hover:opacity-100"
          : "opacity-0 group-hover:opacity-100",
      )}
      aria-label="Expand cell"
    >
      <Maximize2 className="h-3 w-3" />
    </button>
  );
}

function JsonCell({ value, onExpand }: { value: unknown; onExpand?: () => void }) {
  const serialized = formatJson(value);
  const truncated = truncate(serialized, 80);
  const isTruncated = truncated.length < serialized.length;
  return (
    <span className="inline-flex max-w-full items-center gap-1 font-mono text-[11px] text-foreground">
      <span className="overflow-hidden text-ellipsis whitespace-nowrap" title={serialized}>
        {truncated}
      </span>
      {onExpand !== undefined && (isTruncated || isComposite(value)) && (
        <ExpandButton onExpand={onExpand} />
      )}
    </span>
  );
}

function isComposite(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return true;
  return typeof value === "object";
}

/** Exported for tests; renders the expected kind name. */
export function _kindFor(dbType: string, value: unknown): CellKind {
  return classifyCell(dbType, value);
}
