import { Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { ConnectionProfileSummary } from "./types";

interface ConnectionListProps {
  connections: ConnectionProfileSummary[];
  onAdd: () => void;
  onOpen: (profile: ConnectionProfileSummary) => void;
  onEdit: (profile: ConnectionProfileSummary) => void;
  onDelete: (profile: ConnectionProfileSummary) => void;
}

/**
 * The card-grid listing of every persisted connection. Clicking the card's
 * title region activates the connection (the parent then routes to the
 * session view). The edit / delete icons are siblings of the open-affordance
 * so their clicks don't bubble into the open path.
 */
export function ConnectionList({
  connections,
  onAdd,
  onOpen,
  onEdit,
  onDelete,
}: ConnectionListProps) {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
          <p className="text-sm text-muted-foreground">
            {connections.length === 1
              ? "1 saved connection"
              : `${connections.length} saved connections`}
          </p>
        </div>
        <Button onClick={onAdd}>
          <Plus className="h-4 w-4" aria-hidden />
          Add connection
        </Button>
      </header>

      <ul className="grid gap-3" aria-label="Saved connections">
        {connections.map((c) => (
          <li key={c.id}>
            <Card className="transition-colors hover:border-foreground/20">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <button
                  type="button"
                  onClick={() => onOpen(c)}
                  className="flex-1 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
                  aria-label={`Open ${c.name}`}
                >
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <CardDescription>
                    {c.user}@{c.host}:{c.port}/{c.database}
                  </CardDescription>
                </button>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${c.name}`}
                    onClick={() => onEdit(c)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${c.name}`}
                    onClick={() => onDelete(c)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground">
                  {c.environment} · SSL {c.ssl?.mode ?? "prefer"}
                </p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
