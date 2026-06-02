import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  History,
  Loader2,
  Play,
  Trash2,
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
  const [detailTarget, setDetailTarget] = useState<CellDetailTarget | null>(null);

  // Restore history once per connection.
  useEffect(() => {
    let cancelled = false;
    utils.client.settings.get
      .query({ key: sqlHistoryKey(connectionId) })
      .then((raw) => {
        if (cancelled) return;
        setHistory(loadHistory(raw).entries);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
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

  const run = useCallback(async () => {
    const sqlToRun = editorValue.trim();
    if (sqlToRun.length === 0) return;
    setRunning(true);
    setError(null);
    const startedAt = performance.now();
    try {
      const result = await utils.client.data.runReadOnlySql.mutate({
        connectionId,
        sql: sqlToRun,
      });
      const durationMs = performance.now() - startedAt;
      setOutcome({ result, durationMs, ranAt: new Date().toISOString() });
      setHistory((prev) => pushHistory(prev, sqlToRun));
    } catch (cause: unknown) {
      const message =
        cause instanceof Error
          ? cause.message.replace(/^TRPCClientError:\s*/, "")
          : "Unknown error";
      setError(message);
      setOutcome(null);
    } finally {
      setRunning(false);
    }
  }, [editorValue, connectionId, utils.client.data.runReadOnlySql]);

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
            )}
          </div>
        </div>

        {historyOpen && (
          <HistorySidebar
            entries={history}
            onPick={(sqlText) => {
              setEditorValue(sqlText);
              setHistoryOpen(false);
            }}
            onClear={() => setHistory([])}
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
  onPick,
  onClear,
}: {
  entries: readonly string[];
  onPick: (sql: string) => void;
  onClear: () => void;
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
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
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
