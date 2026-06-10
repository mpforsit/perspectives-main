import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  History,
  Loader2,
  Play,
  Trash2,
  X,
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { sql, PostgreSQL } from "@codemirror/lang-sql";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ResultSet } from "@perspectives/engine";

import { CellDetailDialog, type CellDetailTarget } from "../grid/CellDetail";
import { DataGrid } from "../grid/DataGrid";
import type { DataGridColumn } from "../grid/types";
import { trpc } from "../trpc/client";

import { buildSqlSchemaMap } from "./sql-completion";
import {
  loadHistory,
  pushHistory,
  sqlHistoryEnabledKey,
  sqlHistoryKey,
  toHistoryPayload,
} from "./sql-history";

interface SqlConsoleViewProps {
  connectionId: string;
}

interface RunOutcome {
  result: ResultSet;
  durationMs: number;
  ranAt: string;
}

const NUMBER_FMT = new Intl.NumberFormat();

/**
 * SQL console tab.
 *
 * Editor (CodeMirror 6 + lang-sql + PostgreSQL dialect) on top; result panel
 * (re-uses the DataGrid) below; collapsible history sidebar on the right.
 *
 * Read-only enforcement happens engine-side via
 * `BEGIN TRANSACTION READ ONLY` / `ROLLBACK`. The renderer just throws the
 * user's SQL at `data.runReadOnlySql` and surfaces what comes back.
 */
export function SqlConsoleView({ connectionId }: SqlConsoleViewProps) {
  const utils = trpc.useUtils();
  const schemaQuery = trpc.schema.get.useQuery({ connectionId });
  const schemaMap = useMemo(
    () => buildSqlSchemaMap(schemaQuery.data),
    [schemaQuery.data],
  );

  const [editorValue, setEditorValue] = useState<string>(
    "-- Read-only SQL console. Cmd/Ctrl+Enter to run.\n",
  );
  const [running, setRunning] = useState<boolean>(false);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  // Persistent SQL history is sensitive (customer ids, literals with
  // credentials, etc.) and is stored unencrypted in the settings KV. The
  // user can opt out per connection. See AUDIT-CODEX.md finding #6.
  const [historyEnabled, setHistoryEnabled] = useState<boolean>(true);
  const [detailTarget, setDetailTarget] = useState<CellDetailTarget | null>(null);

  // Restore the enabled flag + the history payload once per connection.
  useEffect(() => {
    let cancelled = false;
    const enabledKey = sqlHistoryEnabledKey(connectionId);
    Promise.all([
      utils.client.settings.get.query({ key: enabledKey }),
      utils.client.settings.get.query({ key: sqlHistoryKey(connectionId) }),
    ])
      .then(([enabledRaw, historyRaw]) => {
        if (cancelled) return;
        // Default to enabled when the setting has never been written.
        setHistoryEnabled(enabledRaw === false ? false : true);
        setHistory(loadHistory(historyRaw).entries);
      })
      .catch(() => {
        if (!cancelled) {
          setHistoryEnabled(true);
          setHistory([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, utils.client.settings.get]);

  // Persist after every change.
  const historyRestoredRef = useRef<boolean>(false);
  useEffect(() => {
    if (!historyRestoredRef.current) {
      // Skip the first render's empty-state write.
      historyRestoredRef.current = true;
      return;
    }
    void utils.client.settings.set.mutate({
      key: sqlHistoryKey(connectionId),
      value: toHistoryPayload({ entries: history }),
    });
  }, [history, connectionId, utils.client.settings.set]);

  const setHistoryEnabledPersisted = useCallback(
    async (next: boolean) => {
      setHistoryEnabled(next);
      await utils.client.settings.set.mutate({
        key: sqlHistoryEnabledKey(connectionId),
        value: next,
      });
      if (!next) {
        // Disabling history removes the existing payload too, so the user's
        // opt-out actually wipes what's already on disk.
        setHistory([]);
        await utils.client.settings.delete.mutate({
          key: sqlHistoryKey(connectionId),
        });
      }
    },
    [
      connectionId,
      utils.client.settings.set,
      utils.client.settings.delete,
    ],
  );

  const clearHistoryPersisted = useCallback(async () => {
    setHistory([]);
    // Clearing now removes the underlying KV entry, not just the in-memory
    // state — without this the entry remains on disk until the next push.
    await utils.client.settings.delete.mutate({
      key: sqlHistoryKey(connectionId),
    });
  }, [connectionId, utils.client.settings.delete]);

  // Token shared between `runReadOnlySql` and `cancelReadOnlySql`. Rotated
  // per call so a late cancel can't reach a subsequent query — see
  // AUDIT-CODEX.md finding #4.
  const activeCancelTokenRef = useRef<string | null>(null);

  const run = useCallback(async () => {
    const sqlToRun = editorValue.trim();
    if (sqlToRun.length === 0) return;
    setRunning(true);
    setError(null);
    const startedAt = performance.now();
    const cancelToken = randomToken();
    activeCancelTokenRef.current = cancelToken;
    try {
      const result = await utils.client.data.runReadOnlySql.mutate({
        connectionId,
        sql: sqlToRun,
        cancelToken,
      });
      const durationMs = performance.now() - startedAt;
      setOutcome({ result, durationMs, ranAt: new Date().toISOString() });
      setHistory((prev) => pushHistory(prev, sqlToRun, { enabled: historyEnabled }));
    } catch (cause: unknown) {
      const message =
        cause instanceof Error
          ? cause.message.replace(/^TRPCClientError:\s*/, "")
          : "Unknown error";
      setError(message);
      setOutcome(null);
    } finally {
      if (activeCancelTokenRef.current === cancelToken) {
        activeCancelTokenRef.current = null;
      }
      setRunning(false);
    }
  }, [editorValue, connectionId, utils.client.data.runReadOnlySql, historyEnabled]);

  const cancel = useCallback(async () => {
    const token = activeCancelTokenRef.current;
    if (token === null) return;
    activeCancelTokenRef.current = null;
    try {
      await utils.client.data.cancelReadOnlySql.mutate({ cancelToken: token });
    } catch {
      /* Cancellation is best-effort; if the query already finished, the
         token is gone server-side and the mutation no-ops. */
    }
  }, [utils.client.data.cancelReadOnlySql]);

  // Cmd/Ctrl+Enter while focus is inside the editor. The CodeMirror
  // extension below also wires this; we keep a window listener as a safety
  // net so it fires even when something inside the editor swallows
  // keydowns. `run` reads from state so always sees the current SQL.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void runRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const extensions = useMemo(
    () => [
      sql({ dialect: PostgreSQL, schema: schemaMap, upperCaseKeywords: false }),
      EditorView.lineWrapping,
      keymap.of([
        {
          key: "Mod-Enter",
          preventDefault: true,
          run: () => {
            void runRef.current();
            return true;
          },
        },
      ]),
    ],
    [schemaMap],
  );

  const gridColumns = useMemo<DataGridColumn[]>(() => {
    if (outcome === null) return [];
    return outcome.result.columns.map((col) => ({
      name: col.name,
      dbType: col.dataType,
    }));
  }, [outcome]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="default"
            className="h-7 gap-1.5 px-2.5 text-xs"
            onClick={() => void run()}
            disabled={running || editorValue.trim().length === 0}
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Play className="h-3.5 w-3.5" aria-hidden />
            )}
            Run
          </Button>
          {running && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2.5 text-xs"
              onClick={() => void cancel()}
              title="Cancel the in-flight query"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Cancel
            </Button>
          )}
          <span className="text-muted-foreground">
            <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">
              {navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl"}↩
            </kbd>{" "}
            to run
          </span>
        </div>
        <RunStatus outcome={outcome} running={running} error={error} />
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-pressed={historyOpen}
            title="Toggle query history"
          >
            <History className="h-3.5 w-3.5" aria-hidden />
            History ({history.length})
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b">
            <CodeMirror
              value={editorValue}
              onChange={setEditorValue}
              extensions={extensions}
              height="180px"
              theme="light"
              basicSetup={{
                lineNumbers: true,
                foldGutter: false,
                highlightActiveLine: true,
                bracketMatching: true,
                autocompletion: true,
              }}
              className="text-sm"
              placeholder="SELECT * FROM …"
            />
          </div>
          <div className="flex-1 overflow-hidden">
            {error !== null ? (
              <div className="p-4">
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Query failed</AlertTitle>
                  <AlertDescription className="font-mono text-xs">
                    {error}
                  </AlertDescription>
                </Alert>
              </div>
            ) : outcome === null && !running ? (
              <div className="flex h-full items-center justify-center p-8 text-xs text-muted-foreground">
                Write a SELECT and press <kbd className="mx-1 rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">⌘↩</kbd> to run.
              </div>
            ) : (
              <div className="flex h-full flex-col">
                {outcome?.result.truncated === true && (
                  <Alert className="m-3 mb-0" variant="default">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Results truncated</AlertTitle>
                    <AlertDescription className="text-xs">
                      Showing the first{" "}
                      {NUMBER_FMT.format(outcome.result.rows.length)} rows.
                      {outcome.result.truncationReason === "row-cap"
                        ? " The SQL console caps results to keep the app responsive — add a LIMIT or refine your WHERE clause to see more."
                        : " The result exceeded the byte budget — narrow the SELECT list or filter the result."}
                    </AlertDescription>
                  </Alert>
                )}
                <DataGrid
                  columns={gridColumns}
                  rows={outcome?.result.rows ?? []}
                  loading={running}
                  rowKey={(_row, idx) => idx}
                  emptyMessage="Query returned no rows."
                  onExpandCell={(col, value) =>
                    setDetailTarget({ label: col.name, dbType: col.dbType, value })
                  }
                />
              </div>
            )}
          </div>
        </div>

        {historyOpen && (
          <HistorySidebar
            entries={history}
            enabled={historyEnabled}
            onPick={(sqlText) => {
              setEditorValue(sqlText);
              setHistoryOpen(false);
            }}
            onClear={() => void clearHistoryPersisted()}
            onToggleEnabled={(next) => void setHistoryEnabledPersisted(next)}
          />
        )}
      </div>
      <CellDetailDialog target={detailTarget} onClose={() => setDetailTarget(null)} />
    </div>
  );
}

function RunStatus({
  outcome,
  running,
  error,
}: {
  outcome: RunOutcome | null;
  running: boolean;
  error: string | null;
}) {
  if (running) {
    return <span className="text-muted-foreground">running…</span>;
  }
  if (error !== null) {
    return <span className="text-destructive">error</span>;
  }
  if (outcome === null) return <span className="text-muted-foreground/60">idle</span>;
  return (
    <span className="text-muted-foreground">
      {NUMBER_FMT.format(outcome.result.rows.length)} rows · {formatDuration(outcome.durationMs)}
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function HistorySidebar({
  entries,
  enabled,
  onPick,
  onClear,
  onToggleEnabled,
}: {
  entries: readonly string[];
  enabled: boolean;
  onPick: (sql: string) => void;
  onClear: () => void;
  onToggleEnabled: (next: boolean) => void;
}) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l">
      <header className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-xs font-medium">History</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
          onClick={onClear}
          disabled={entries.length === 0}
          title="Clear query history"
        >
          <Trash2 className="h-3 w-3" aria-hidden />
          Clear
        </Button>
      </header>
      <label className="flex items-center gap-2 border-b px-3 py-1.5 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          className="h-3 w-3"
          checked={enabled}
          onChange={(e) => onToggleEnabled(e.target.checked)}
          aria-label="Save SQL history for this connection"
        />
        <span>Save SQL history for this connection</span>
      </label>
      <div className="flex-1 overflow-y-auto">
        {!enabled ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            History is disabled for this connection. New queries will not be
            saved; existing entries have been cleared.
          </p>
        ) : entries.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            Nothing yet. Successful queries land here.
          </p>
        ) : (
          <ul className="divide-y">
            {entries.map((entry, i) => (
              <li key={`${i}:${entry.slice(0, 16)}`}>
                <button
                  type="button"
                  onClick={() => onPick(entry)}
                  className={cn(
                    "block w-full truncate px-3 py-2 text-left font-mono text-[11px]",
                    "hover:bg-muted",
                  )}
                  title={entry}
                >
                  {oneLine(entry)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function oneLine(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function randomToken(): string {
  // 16 random bytes → 22-char base64url; collision-free across the small
  // pool of concurrent tabs we ever expect, and works in browser + jsdom
  // (crypto.getRandomValues is the universally-available API).
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let bin = "";
  for (const byte of buf) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
