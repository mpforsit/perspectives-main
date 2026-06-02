import { Database } from "lucide-react";

import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  onAdd: () => void;
}

/**
 * Shown on a fresh install when the metadata store has no connections yet.
 * Single call-to-action — keeps the first run obvious.
 */
export function EmptyState({ onAdd }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-12 text-center">
      <div className="rounded-full bg-muted p-6">
        <Database className="h-10 w-10 text-muted-foreground" aria-hidden />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome to Perspectives
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Connect to your first PostgreSQL database to start browsing tables,
          building perspectives, and exploring relationships.
        </p>
      </div>
      <Button size="lg" onClick={onAdd}>
        Add your first connection
      </Button>
    </div>
  );
}
