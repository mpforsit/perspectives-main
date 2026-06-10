import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  FolderTree,
  FunctionSquare,
  Table as TableIcon,
} from "lucide-react";

import type {
  FunctionInfo,
  SchemaInfo,
  SchemaSnapshot,
  TableInfo,
  ViewInfo,
} from "@perspectives/engine";

import { cn } from "@/lib/utils";

import type { OpenTab } from "./types";

interface SchemaTreeProps {
  snapshot: SchemaSnapshot;
  /** When true, all branches render expanded regardless of user state — used
   *  by the parent when the search filter is active so matching items are
   *  always visible. */
  forceExpanded: boolean;
  onOpen: (tab: OpenTab) => void;
}

/**
 * Renders the schema → group → item tree. Plain DOM rendering — no
 * virtualization. The prompt says to keep it that way until a schema has
 * hundreds of tables; we'll revisit when an adapter starts surfacing that.
 */
export function SchemaTree({ snapshot, forceExpanded, onOpen }: SchemaTreeProps) {
  // Default-expanded: every schema and every group with content.
  const defaultExpanded = useMemo(() => {
    const e = new Set<string>();
    for (const schema of snapshot.schemas) {
      e.add(`schema:${schema.name}`);
      e.add(`group:${schema.name}:tables`);
      if ((schema.views?.length ?? 0) > 0) e.add(`group:${schema.name}:views`);
      if ((schema.functions?.length ?? 0) > 0)
        e.add(`group:${schema.name}:functions`);
    }
    return e;
    // We intentionally don't recompute on every snapshot — the user's
    // expand/collapse should persist across re-renders within a session.
  }, []);

  const [expanded, setExpanded] = useState<Set<string>>(defaultExpanded);

  const isOpen = (key: string): boolean => forceExpanded || expanded.has(key);
  const toggle = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (snapshot.schemas.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-muted-foreground">
        No matching schemas or items.
      </p>
    );
  }

  return (
    <ul className="space-y-0.5" role="tree">
      {snapshot.schemas.map((schema) => (
        <SchemaNode
          key={schema.name}
          schema={schema}
          isOpen={isOpen}
          toggle={toggle}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );
}

interface NodeProps {
  schema: SchemaInfo;
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  onOpen: (tab: OpenTab) => void;
}

function SchemaNode({ schema, isOpen, toggle, onOpen }: NodeProps) {
  const key = `schema:${schema.name}`;
  const open = isOpen(key);
  const views = schema.views ?? [];
  const functions = schema.functions ?? [];

  return (
    <li role="treeitem" aria-expanded={open}>
      <ExpandButton
        open={open}
        onClick={() => toggle(key)}
        icon={<FolderTree className="h-4 w-4 text-muted-foreground" />}
        label={schema.name}
        depth={0}
      />
      {open && (
        <ul className="ml-3 mt-0.5 space-y-0.5">
          <Group
            schemaName={schema.name}
            kind="tables"
            items={schema.tables}
            isOpen={isOpen}
            toggle={toggle}
            renderItem={(t) => (
              <ItemRow
                key={`t:${t.name}`}
                icon={
                  <TableIcon className="h-3.5 w-3.5 text-muted-foreground" />
                }
                label={t.name}
                onClick={() =>
                  onOpen({ kind: "table", schema: schema.name, name: t.name })
                }
              />
            )}
          />
          {views.length > 0 && (
            <Group
              schemaName={schema.name}
              kind="views"
              items={views}
              isOpen={isOpen}
              toggle={toggle}
              renderItem={(v) => (
                <ItemRow
                  key={`v:${v.name}`}
                  icon={<Eye className="h-3.5 w-3.5 text-muted-foreground" />}
                  label={v.name}
                  onClick={() =>
                    onOpen({ kind: "view", schema: schema.name, name: v.name })
                  }
                />
              )}
            />
          )}
          {functions.length > 0 && (
            <Group
              schemaName={schema.name}
              kind="functions"
              items={functions}
              isOpen={isOpen}
              toggle={toggle}
              renderItem={(f) => (
                <ItemRow
                  key={`f:${f.name}`}
                  icon={
                    <FunctionSquare className="h-3.5 w-3.5 text-muted-foreground" />
                  }
                  label={f.name}
                  onClick={undefined}
                  muted
                />
              )}
            />
          )}
        </ul>
      )}
    </li>
  );
}

interface GroupProps<T> {
  schemaName: string;
  kind: "tables" | "views" | "functions";
  items: T[];
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  renderItem: (item: T) => React.ReactNode;
}

function Group<T extends { name: string }>({
  schemaName,
  kind,
  items,
  isOpen,
  toggle,
  renderItem,
}: GroupProps<T>) {
  const key = `group:${schemaName}:${kind}`;
  const open = isOpen(key);
  const label =
    kind === "tables" ? "Tables" : kind === "views" ? "Views" : "Functions";
  if (items.length === 0) return null;
  return (
    <li role="treeitem" aria-expanded={open}>
      <ExpandButton
        open={open}
        onClick={() => toggle(key)}
        label={
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}{" "}
            <span className="ml-1 text-muted-foreground/70 normal-case">
              {items.length}
            </span>
          </span>
        }
        depth={1}
      />
      {open && (
        <ul className="ml-3 space-y-0.5" role="group">
          {items.map((item) => renderItem(item))}
        </ul>
      )}
    </li>
  );
}

function ExpandButton({
  open,
  onClick,
  icon,
  label,
  depth,
}: {
  open: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: React.ReactNode;
  depth: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-sm py-1 text-left text-sm hover:bg-accent",
        depth === 0 ? "px-1.5 font-medium" : "px-1",
      )}
    >
      <Chevron open={open} />
      {icon}
      {typeof label === "string" ? <span className="truncate">{label}</span> : label}
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return open ? (
    <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
  ) : (
    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
  );
}

function ItemRow({
  icon,
  label,
  onClick,
  muted = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: (() => void) | undefined;
  muted?: boolean;
}) {
  const className = cn(
    "flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-sm",
    onClick !== undefined ? "hover:bg-accent cursor-pointer" : "cursor-default",
    muted && "text-muted-foreground",
  );
  if (onClick === undefined) {
    return (
      <li role="treeitem">
        <div className={className}>
          <span className="w-3" />
          {icon}
          <span className="truncate">{label}</span>
        </div>
      </li>
    );
  }
  return (
    <li role="treeitem">
      <button type="button" onClick={onClick} className={className}>
        <span className="w-3" />
        {icon}
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}

// Re-export for convenience.
export type { SchemaInfo, TableInfo, ViewInfo, FunctionInfo };
