import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, FileCode2, GitBranch } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { trpc } from "../trpc/client";

import { RelationsManager } from "./relations/RelationsManager";
import { SchemaSidebar } from "./SchemaSidebar";
import { SqlConsoleView } from "./SqlConsoleView";
import { TabBar } from "./TabBar";
import { TableView } from "./TableView";
import { EmptyTabContent, TablePlaceholder } from "./TablePlaceholder";
import {
  loadPersistedTabs,
  persistedTabsKey,
  type PersistedTabs,
} from "./tabs-storage";
import { findTab, type OpenTab } from "./types";

interface SessionViewProps {
  connectionId: string;
  connectionName: string;
  onLeave: () => void;
}

type ConnectState =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "failed"; message: string };

/**
 * The "connected" view: tries to bring up the engine adapter for this
 * connection on mount, then renders sidebar + tabs + main panel once the
 * connection is live. On disconnect, releases the adapter via tRPC before
 * surfacing the empty-state list again upstream.
 */
export function SessionView({
  connectionId,
  connectionName,
  onLeave,
}: SessionViewProps) {
  const utils = trpc.useUtils();
  const [connectState, setConnectState] = useState<ConnectState>({
    kind: "connecting",
  });
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState<number>(-1);
  // Until the persisted-tab restore round-trip completes, hold off on writing
  // back so we don't clobber the saved payload with the empty initial state.
  const [restored, setRestored] = useState<boolean>(false);
  const [relationsManagerOpen, setRelationsManagerOpen] = useState<boolean>(false);

  // Activate the engine adapter exactly once per connectionId. tRPC's
  // imperative client (via `utils.client`) is stable across renders, so this
  // effect has no churn on re-render.
  useEffect(() => {
    let cancelled = false;
    setConnectState({ kind: "connecting" });
    utils.client.connections.connect
      .mutate({ connectionId })
      .then(() => {
        if (!cancelled) setConnectState({ kind: "connected" });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const message =
          cause instanceof Error
            ? cause.message.replace(/^TRPCClientError:\s*/, "")
            : "Unknown error";
        setConnectState({ kind: "failed", message });
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, utils.client.connections.connect]);

  // Restore persisted tabs once per connection. We deliberately reset the
  // `restored` latch on every connectionId change so the *next* connection's
  // empty initial state doesn't get written into the previous one's storage.
  useEffect(() => {
    let cancelled = false;
    setRestored(false);
    setTabs([]);
    setActiveTabIndex(-1);
    utils.client.settings.get
      .query({ key: persistedTabsKey(connectionId) })
      .then((raw) => {
        if (cancelled) return;
        const loaded = loadPersistedTabs(raw);
        if (loaded !== null) {
          setTabs(loaded.tabs);
          setActiveTabIndex(loaded.activeIndex);
        }
        setRestored(true);
      })
      .catch(() => {
        // A failed restore should not block the session — just start empty
        // and allow future writes once the user opens something.
        if (!cancelled) setRestored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, utils.client.settings.get]);

  // Persist on every change once we've finished the restore phase. The KV
  // upsert is cheap; no need to debounce at the row counts we expect here
  // (≤64 tabs per connection, enforced by the loader's schema).
  useEffect(() => {
    if (!restored) return;
    const payload: PersistedTabs = { tabs, activeIndex: activeTabIndex };
    void utils.client.settings.set.mutate({
      key: persistedTabsKey(connectionId),
      value: { v: 1, tabs: payload.tabs, activeIndex: payload.activeIndex },
    });
  }, [restored, tabs, activeTabIndex, connectionId, utils.client.settings.set]);

  const openTab = useCallback(
    (tab: OpenTab) => {
      setTabs((prev) => {
        const existing = findTab(prev, tab);
        if (existing >= 0) {
          setActiveTabIndex(existing);
          return prev;
        }
        const next = [...prev, tab];
        setActiveTabIndex(next.length - 1);
        return next;
      });
    },
    [],
  );

  const closeTab = useCallback(
    (index: number) => {
      setTabs((prev) => prev.filter((_, i) => i !== index));
      setActiveTabIndex((current) => {
        if (current === index) return Math.max(0, index - 1);
        if (current > index) return current - 1;
        return current;
      });
    },
    [],
  );

  // Each "+ SQL" click opens a fresh console with its own id so multiple
  // consoles can coexist with independent drafts. Numbered titles keep the
  // tab strip readable. The id uses a coarse millisecond timestamp + the
  // tab count to stay stable across persistence.
  const openSqlConsole = useCallback(() => {
    setTabs((prev) => {
      const id = `sql-${Date.now().toString(36)}-${prev.length}`;
      const sqlCount = prev.filter((t) => t.kind === "sql").length;
      const next: OpenTab = {
        kind: "sql",
        id,
        title: `SQL ${sqlCount + 1}`,
      };
      const updated = [...prev, next];
      setActiveTabIndex(updated.length - 1);
      return updated;
    });
  }, []);

  const handleLeave = async () => {
    try {
      await utils.client.connections.disconnect.mutate({ connectionId });
    } catch {
      // Disconnect failed — proceed anyway. The adapter pool will clean up
      // when the engine shuts down.
    }
    onLeave();
  };

  const activeTab =
    activeTabIndex >= 0 && activeTabIndex < tabs.length
      ? tabs[activeTabIndex]
      : undefined;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-3 py-2 [-webkit-app-region:drag]">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLeave}
          className="gap-1.5 [-webkit-app-region:no-drag]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Connections
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{connectionName}</span>
          {connectState.kind === "connecting" && (
            <span className="text-xs text-muted-foreground">connecting…</span>
          )}
        </div>
        <div className="flex items-center justify-end gap-1.5" style={{ minWidth: 220 }}>
          {connectState.kind === "connected" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRelationsManagerOpen(true)}
                className="h-7 gap-1.5 px-2 text-xs [-webkit-app-region:no-drag]"
                title="Manage relations (schema-derived + custom)"
              >
                <GitBranch className="h-3.5 w-3.5" aria-hidden />
                Relations
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={openSqlConsole}
                className="h-7 gap-1.5 px-2 text-xs [-webkit-app-region:no-drag]"
                title="Open a new SQL console"
              >
                <FileCode2 className="h-3.5 w-3.5" aria-hidden />
                New SQL
              </Button>
            </>
          )}
        </div>
      </header>

      {connectState.kind === "failed" ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <Alert variant="destructive" className="max-w-md">
            <AlertTitle>Could not connect</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{connectState.message}</p>
              <Button variant="outline" size="sm" onClick={onLeave}>
                Back to connections
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-72 shrink-0 border-r">
            {connectState.kind === "connected" ? (
              <SchemaSidebar connectionId={connectionId} onOpen={openTab} />
            ) : (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                Activating connection…
              </p>
            )}
          </aside>
          <main className="flex flex-1 flex-col overflow-hidden">
            <TabBar
              tabs={tabs}
              activeIndex={activeTabIndex}
              onSelect={setActiveTabIndex}
              onClose={closeTab}
            />
            <div className="flex-1 overflow-hidden">
              {activeTab === undefined ? (
                <EmptyTabContent />
              ) : activeTab.kind === "table" ? (
                <TableView
                  key={`${activeTab.kind}:${activeTab.schema}.${activeTab.name}`}
                  connectionId={connectionId}
                  schema={activeTab.schema}
                  table={activeTab.name}
                  onOpenTab={openTab}
                />
              ) : activeTab.kind === "filteredTable" ? (
                <TableView
                  key={`filteredTable:${activeTab.id}`}
                  connectionId={connectionId}
                  schema={activeTab.schema}
                  table={activeTab.name}
                  filter={activeTab.filter}
                  crumbs={activeTab.crumbs}
                  onOpenTab={openTab}
                />
              ) : activeTab.kind === "sql" ? (
                <SqlConsoleView
                  key={`sql:${activeTab.id}`}
                  connectionId={connectionId}
                />
              ) : (
                <TablePlaceholder tab={activeTab} />
              )}
            </div>
          </main>
        </div>
      )}
      <RelationsManager
        open={relationsManagerOpen}
        connectionId={connectionId}
        onClose={() => setRelationsManagerOpen(false)}
      />
    </div>
  );
}
