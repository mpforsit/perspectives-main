import { Construction, Eye, Table as TableIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { OpenTab } from "./types";

/**
 * Placeholder shown for tab kinds that don't yet have a real renderer —
 * today that's `view` (until Phase 3 wires SQL-base perspectives through to
 * views). `table` goes through `TableView` and `sql` through
 * `SqlConsoleView`, so this component never sees those kinds.
 */
type PlaceholderTab = Extract<OpenTab, { kind: "table" | "view" }>;

export function TablePlaceholder({ tab }: { tab: PlaceholderTab }) {
  const Icon = tab.kind === "table" ? TableIcon : Eye;
  return (
    <div className="flex h-full items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Icon className="h-5 w-5 text-muted-foreground" />
            <span>
              <span className="text-muted-foreground/70">{tab.schema}.</span>
              {tab.name}
            </span>
          </CardTitle>
          <CardDescription>
            {tab.kind === "table" ? "Table" : "View"} selected from the schema
            sidebar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <Construction className="h-4 w-4" />
            <AlertTitle>Grid coming soon</AlertTitle>
            <AlertDescription>
              The paginated row grid lands in Phase 1.8. For now this placeholder
              confirms the schema sidebar wired through correctly.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Shown when no tabs are open in the session view.
 */
export function EmptyTabContent() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
      Select a table or view in the sidebar to open it.
    </div>
  );
}
