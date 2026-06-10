/**
 * Pure helpers for the SQL console's local history. The session view
 * persists this through the same settings KV as the open-tabs payload.
 *
 * The history is move-to-front + deduplicated by exact SQL text, capped at
 * `MAX_HISTORY`. We dedupe so re-running the same query a hundred times
 * doesn't push everything else out.
 *
 * Sensitivity: SQL queries routinely contain customer ids, copied tokens,
 * literals with credentials, and otherwise sensitive table names. The
 * settings KV the history lives in is not encrypted. AUDIT-CODEX.md
 * finding #6 lists three controls; the renderer wires:
 *
 *  - **Disable**: when `historyEnabled` is `false`, `pushHistory` is a no-op
 *    and `loadHistory` returns the empty set. The user surface offers this
 *    as a per-connection toggle.
 *  - **Clear**: removes both the React state and the underlying KV entry.
 *  - **Tighter per-entry cap**: 64 KiB, down from 1 MiB. A single SELECT
 *    pasted from a script is well inside this; an unintended file drop
 *    is not.
 */

import { z } from "zod";

export const MAX_HISTORY = 50;
export const MAX_ENTRY_BYTES = 64 * 1024;
export const HISTORY_VERSION = 1 as const;

const persistedSchema = z.object({
  v: z.literal(HISTORY_VERSION),
  entries: z
    .array(z.string().min(1).max(MAX_ENTRY_BYTES))
    .max(MAX_HISTORY * 2),
});

export interface PersistedHistory {
  entries: string[];
}

export function sqlHistoryKey(connectionId: string): string {
  return `session:${connectionId}:sqlHistory.v${HISTORY_VERSION}`;
}

export function sqlHistoryEnabledKey(connectionId: string): string {
  return `session:${connectionId}:sqlHistoryEnabled`;
}

export function loadHistory(raw: unknown): PersistedHistory {
  if (raw === null || raw === undefined) return { entries: [] };
  const parsed = persistedSchema.safeParse(raw);
  if (!parsed.success) return { entries: [] };
  return { entries: parsed.data.entries.slice(0, MAX_HISTORY) };
}

export function toHistoryPayload(history: PersistedHistory) {
  return { v: HISTORY_VERSION, entries: history.entries };
}

export interface PushHistoryOptions {
  /** When `false`, `pushHistory` returns `prev` unchanged — the user has
   *  opted out of persistent history for this connection. */
  enabled?: boolean;
}

/**
 * Add `sql` to the front of `prev`. If it's already present anywhere in the
 * list, move it to the front. Whitespace-only entries are ignored. Entries
 * larger than `MAX_ENTRY_BYTES` are dropped (a 1 MB paste shouldn't fill the
 * KV store). Capped at `MAX_HISTORY`.
 */
export function pushHistory(
  prev: readonly string[],
  sql: string,
  options: PushHistoryOptions = {},
): string[] {
  if (options.enabled === false) return [...prev];
  const trimmed = sql.trim();
  if (trimmed.length === 0) return [...prev];
  // UTF-8 byte budget — guards against multi-byte glyph blow-out. Use
  // `TextEncoder` rather than `Buffer` because this file runs in the
  // renderer; Buffer isn't reliably polyfilled.
  if (new TextEncoder().encode(trimmed).byteLength > MAX_ENTRY_BYTES) {
    return [...prev];
  }
  const filtered = prev.filter((entry) => entry !== trimmed);
  filtered.unshift(trimmed);
  return filtered.slice(0, MAX_HISTORY);
}
