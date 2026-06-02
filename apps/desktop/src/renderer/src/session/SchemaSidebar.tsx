import { useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { trpc } from "../trpc/client";

import { filterSchema } from "./filter";
import { SchemaTree } from "./SchemaTree";
import type { OpenTab } from "./types";

interface SchemaSidebarProps {
  connectionId: string;
  onOpen: (tab: OpenTab) => void;
}

/**
 * Self-contained schema sidebar: fetches the schema for the active
 * connection via tRPC, lets the user filter it by name, surfaces a manual
 * "Refresh schema" button that calls the cache-invalidating refresh on the
 * engine, and forwards table / view clicks up to the parent via `onOpen`.
 */
export function SchemaSidebar({ connectionId, onOpen }: SchemaSidebarProps) {
  const [query, setQuery] = useState("");
  const utils = trpc.useUtils();
  const schemaQuery = trpc.schema.get.useQuery({ connectionId });
  const refreshMutation = trpc.schema.refresh.useMutation({
    onSuccess: (snapshot) => {
      // Avoid a second round-trip — write the new snapshot directly into the
      // get-query cache so the tree re-renders immediately.
      utils.schema.get.setData({ connectionId }, snapshot);
    },
  });

  const filtered = useMemo(() => {
    if (schemaQuery.data === undefined) return undefined;
    return filterSchema(schemaQuery.data, query);
  }, [schemaQuery.data, query]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-2 border-b px-2 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter schemas…"
            aria-label="Filter schemas"
            className="h-8 pl-7 text-sm"
          />
        </div>
        <Button
          onClick={() => refreshMutation.mutate({ connectionId })}
          variant="ghost"
          size="sm"
          disabled={refreshMutation.isPending || schemaQuery.isPending}
          className="h-7 justify-start gap-2 px-2 text-xs"
        >
          <RefreshCw
            className={
              refreshMutation.isPending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"
            }
            aria-hidden
          />
          Refresh schema
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {schemaQuery.isPending ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            Loading schema…
          </p>
        ) : schemaQuery.isError ? (
          <div className="space-y-2 px-1 py-2">
            <p className="text-xs text-destructive">
              Could not load schema — {schemaQuery.error.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void schemaQuery.refetch()}
              className="h-7 text-xs"
            >
              Try again
            </Button>
          </div>
        ) : filtered !== undefined ? (
          <SchemaTree
            snapshot={filtered}
            forceExpanded={query.trim().length > 0}
            onOpen={onOpen}
          />
        ) : null}
      </div>
    </div>
  );
}
