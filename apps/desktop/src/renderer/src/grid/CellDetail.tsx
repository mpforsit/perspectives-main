import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  bytesLength,
  bytesPreview,
  classifyCell,
  formatCell,
  formatJson,
  type CellKind,
} from "./format";
import { JsonTree } from "./JsonTree";

export interface CellDetailTarget {
  /** Display label, typically the column name. */
  label: string;
  /** Database type as reported by the column metadata. */
  dbType: string;
  /** The raw value. */
  value: unknown;
}

interface CellDetailDialogProps {
  /** When non-null, the dialog is open and shows this cell. */
  target: CellDetailTarget | null;
  onClose: () => void;
}

/**
 * Modal cell-detail view: long text wraps + scrolls, JSON renders as a
 * collapsible tree, arrays render as a numbered list (via JsonTree), and
 * binary values surface a hex dump and a `<bytea, N bytes>` note rather
 * than letting raw bytes turn into mojibake. Read-only — Copy raw is the
 * only output.
 */
export function CellDetailDialog({ target, onClose }: CellDetailDialogProps) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="flex h-[70vh] max-h-[700px] w-[min(72vw,900px)] max-w-none flex-col gap-3 p-0"
        // The grid container has tabIndex=0 + keyboard handlers; let radix
        // restore focus to it when we close so arrow keys keep working.
      >
        {target !== null && <CellDetailBody target={target} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function CellDetailBody({
  target,
  onClose,
}: {
  target: CellDetailTarget;
  onClose: () => void;
}) {
  const kind = classifyCell(target.dbType, target.value);
  const rawString = rawForClipboard(target.value, target.dbType);

  return (
    <>
      <DialogHeader className="border-b px-4 py-3 text-left">
        <DialogTitle className="flex items-baseline gap-2">
          <span>{target.label}</span>
          <span className="text-xs font-normal uppercase tracking-wider text-muted-foreground">
            {target.dbType}
          </span>
          <span className="text-xs font-normal text-muted-foreground/60">
            ({kindLabel(kind)})
          </span>
        </DialogTitle>
        <DialogDescription className="sr-only">Cell detail view</DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-auto px-4 py-3">
        <CellDetailContent kind={kind} value={target.value} />
      </div>

      <DialogFooter className="border-t px-4 py-2.5">
        <div className="flex items-center justify-between gap-2 sm:justify-end sm:gap-2">
          <CopyButton text={rawString} />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

function CellDetailContent({ kind, value }: { kind: CellKind; value: unknown }) {
  switch (kind) {
    case "null":
      return (
        <p className="text-sm italic text-muted-foreground">
          NULL — this cell has no value.
        </p>
      );
    case "boolean":
    case "number":
    case "date":
    case "time":
      return (
        <pre className="whitespace-pre-wrap break-words font-mono text-sm">
          {formatCell("text", value)}
        </pre>
      );
    case "timestamp":
      return (
        <pre className="whitespace-pre-wrap break-words font-mono text-sm">
          {String(value)}
        </pre>
      );
    case "bytes":
      return <BytesPreview value={value} />;
    case "json":
    case "array":
      return <JsonTree value={parseIfString(value)} />;
    case "text":
      return (
        <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed">
          {typeof value === "string" ? value : String(value)}
        </pre>
      );
  }
}

function BytesPreview({ value }: { value: unknown }) {
  const length = bytesLength(value);
  const preview = bytesPreview(value, 256);
  return (
    <div className="space-y-3 text-sm">
      <p className="rounded border border-muted-foreground/20 bg-muted/30 px-3 py-2 text-muted-foreground">
        Binary data — {length !== null ? `${length.toLocaleString()} bytes` : "unknown length"}.
        Perspectives doesn&apos;t render binary content in v1; the first 256 bytes are
        shown below as hex for sanity checking.
      </p>
      {preview.length > 0 && (
        <pre className="whitespace-pre-wrap break-all rounded border bg-muted/20 px-3 py-2 font-mono text-xs leading-relaxed">
          {preview}
        </pre>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState<boolean>(false);
  const copy = useCallback(() => {
    void writeClipboard(text).then((ok) => {
      if (!ok) return;
      setDone(true);
      window.setTimeout(() => setDone(false), 1_200);
    });
  }, [text]);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      className="gap-1.5"
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copied" : "Copy raw"}
    </Button>
  );
}

/**
 * Some drivers hand JSON columns back already-parsed (objects/arrays) and
 * some hand back strings. For the tree view, parse strings if possible —
 * but leave invalid input as a string so the user still sees *something*.
 */
function parseIfString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return value;
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/**
 * The raw value placed on the clipboard. For text, the verbatim string. For
 * structured types, the JSON serialisation that round-trips. For bytes, a
 * lossy summary — the alternative (raw bytes on the clipboard) is not what
 * the user typically wants when "Copy raw" is offered in a SQL client.
 */
function rawForClipboard(value: unknown, dbType: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const length = bytesLength(value);
    const preview = bytesPreview(value, 64);
    return `<bytea, ${length ?? "?"} bytes>\n${preview}`;
  }
  if (typeof value === "object") {
    return formatJson(value);
  }
  return formatCell(dbType, value);
}

function kindLabel(kind: CellKind): string {
  return kind;
}

async function writeClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through */
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
      return true;
    } finally {
      document.body.removeChild(ta);
    }
  }
  return false;
}
