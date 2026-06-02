/**
 * Pure helpers for the SQL console's local history. The session view
 * persists this through the same settings KV as the open-tabs payload.
 *
 * The history is move-to-front + deduplicated by exact SQL text, capped at
 * `MAX_HISTORY`. We dedupe so re-running the same query a hundred times
 * doesn't push everything else out.
 */

import { z } from "zod";

export const MAX_HISTORY = 50;
export const HISTORY_VERSION = 1 as const;

const persistedSchema = z.object({
  v: z.literal(HISTORY_VERSION),
  entries: z.array(z.string().min(1).max(1_048_576)).max(MAX_HISTORY * 2),
});

export interface PersistedHistory {
  entries: string[];
}

export function sqlHistoryKey(connectionId: string): string {
  return `session:${connectionId}:sqlHistory.v${HISTORY_VERSION}`;
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

/**
 * Add `sql` to the front of `prev`. If it's already present anywhere in the
 * list, move it to the front. Whitespace-only entries are ignored. Capped
 * at `MAX_HISTORY`.
 */
export function pushHistory(prev: readonly string[], sql: string): string[] {
  const trimmed = sql.trim();
  if (trimmed.length === 0) return [...prev];
  const filtered = prev.filter((entry) => entry !== trimmed);
  filtered.unshift(trimmed);
  return filtered.slice(0, MAX_HISTORY);
}
