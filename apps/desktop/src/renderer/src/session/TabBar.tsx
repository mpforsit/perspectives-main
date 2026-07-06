import { Eye, FileCode2, Filter, Table as TableIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { tabKey, type OpenTab } from "./types";

function tabIcon(tab: OpenTab) {
  if (tab.kind === "table") return TableIcon;
  if (tab.kind === "view") return Eye;
  if (tab.kind === "filteredTable") return Filter;
  return FileCode2;
}

function tabSchemaLabel(tab: OpenTab): string | null {
  if (tab.kind === "sql") return null;
  return tab.schema;
}

function tabNameLabel(tab: OpenTab): string {
  if (tab.kind === "sql") return tab.title;
  return tab.name;
}

function tabAriaLabel(tab: OpenTab): string {
  if (tab.kind === "sql") return tab.title;
  return `${tab.schema}.${tab.name}`;
}

interface TabBarProps {
  tabs: OpenTab[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onClose: (index: number) => void;
}

/**
 * Horizontal tab strip. Active tab is visually pinned to the content area
 * below; the X on each tab is a separate button so its click doesn't
 * register as a tab-select. Overflow scrolls horizontally — virtualization
 * isn't worth it at the per-user open-table count we expect.
 */
export function TabBar({ tabs, activeIndex, onSelect, onClose }: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      className="flex items-stretch overflow-x-auto border-b bg-muted/30"
    >
      {tabs.map((tab, idx) => {
        const isActive = idx === activeIndex;
        const Icon = tabIcon(tab);
        const schemaLabel = tabSchemaLabel(tab);
        const ariaLabel = tabAriaLabel(tab);
        return (
          <div
            key={tabKey(tab)}
            className={cn(
              "group flex shrink-0 items-center gap-2 border-r border-border/60 px-3 py-1.5 text-sm",
              isActive
                ? "border-b-2 border-b-primary bg-background"
                : "border-b-2 border-b-transparent hover:bg-muted/60",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(idx)}
              className="flex items-center gap-1.5 focus-visible:outline-none"
            >
              <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {schemaLabel !== null && (
                <span className="text-muted-foreground/80">{schemaLabel}.</span>
              )}
              <span>{tabNameLabel(tab)}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${ariaLabel}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(idx);
              }}
              className="rounded p-0.5 opacity-50 transition-opacity hover:bg-foreground/10 hover:opacity-100 group-hover:opacity-80"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
