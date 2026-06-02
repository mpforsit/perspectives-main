import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Recursive JSON tree with per-node disclosure. Composite nodes (objects /
 * arrays) toggle individually; leaves render inline.
 *
 * Color tokens echo the cell renderer's: numbers blue, booleans amber,
 * strings emerald, null muted-italic. Object keys are foreground/80.
 *
 * Initial expand-depth is configurable so the dialog can default to "first
 * level expanded" without forcing the caller to walk the tree.
 */
export function JsonTree({
  value,
  initiallyExpandedDepth = 2,
}: {
  value: unknown;
  initiallyExpandedDepth?: number;
}) {
  return (
    <div className="font-mono text-xs leading-relaxed">
      <JsonNode value={value} depth={0} initiallyExpandedDepth={initiallyExpandedDepth} />
    </div>
  );
}

interface JsonNodeProps {
  value: unknown;
  depth: number;
  initiallyExpandedDepth: number;
}

function JsonNode({ value, depth, initiallyExpandedDepth }: JsonNodeProps) {
  if (value === null) return <span className="italic text-muted-foreground">null</span>;
  if (value === undefined) return <span className="italic text-muted-foreground">undefined</span>;
  if (typeof value === "boolean") {
    return <span className="text-amber-600 dark:text-amber-400">{String(value)}</span>;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return <span className="text-blue-600 dark:text-blue-400">{String(value)}</span>;
  }
  if (typeof value === "string") {
    return (
      <span className="break-words text-emerald-700 dark:text-emerald-400">
        &quot;{value}&quot;
      </span>
    );
  }
  if (Array.isArray(value)) {
    return (
      <ArrayNode value={value} depth={depth} initiallyExpandedDepth={initiallyExpandedDepth} />
    );
  }
  if (typeof value === "object") {
    return (
      <ObjectNode
        value={value as Record<string, unknown>}
        depth={depth}
        initiallyExpandedDepth={initiallyExpandedDepth}
      />
    );
  }
  return <span>{String(value)}</span>;
}

function ArrayNode({ value, depth, initiallyExpandedDepth }: { value: unknown[] } & Omit<JsonNodeProps, "value">) {
  const [expanded, setExpanded] = useState<boolean>(depth < initiallyExpandedDepth);

  if (value.length === 0) {
    return <span className="text-muted-foreground">[ ]</span>;
  }

  return (
    <span>
      <Toggle expanded={expanded} onClick={() => setExpanded((v) => !v)} />
      <span>[</span>
      {expanded ? (
        <span className="block pl-4">
          {value.map((item, i) => (
            <span key={i} className="block">
              <span className="mr-2 select-none text-muted-foreground/50 tabular-nums">{i}:</span>
              <JsonNode value={item} depth={depth + 1} initiallyExpandedDepth={initiallyExpandedDepth} />
              {i < value.length - 1 && <span className="text-muted-foreground">,</span>}
            </span>
          ))}
        </span>
      ) : (
        <span className="px-1 text-muted-foreground">… {value.length} item{value.length === 1 ? "" : "s"} …</span>
      )}
      <span>]</span>
    </span>
  );
}

function ObjectNode({
  value,
  depth,
  initiallyExpandedDepth,
}: { value: Record<string, unknown> } & Omit<JsonNodeProps, "value">) {
  const [expanded, setExpanded] = useState<boolean>(depth < initiallyExpandedDepth);
  const keys = Object.keys(value);

  if (keys.length === 0) {
    return <span className="text-muted-foreground">{"{ }"}</span>;
  }

  return (
    <span>
      <Toggle expanded={expanded} onClick={() => setExpanded((v) => !v)} />
      <span>{"{"}</span>
      {expanded ? (
        <span className="block pl-4">
          {keys.map((k, i) => (
            <span key={k} className="block">
              <span className="text-foreground/80">&quot;{k}&quot;</span>
              <span className="text-muted-foreground">: </span>
              <JsonNode value={value[k]} depth={depth + 1} initiallyExpandedDepth={initiallyExpandedDepth} />
              {i < keys.length - 1 && <span className="text-muted-foreground">,</span>}
            </span>
          ))}
        </span>
      ) : (
        <span className="px-1 text-muted-foreground">… {keys.length} key{keys.length === 1 ? "" : "s"} …</span>
      )}
      <span>{"}"}</span>
    </span>
  );
}

function Toggle({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={expanded ? "Collapse" : "Expand"}
      aria-expanded={expanded}
      className={cn(
        "mr-1 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground/70",
        "hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}
