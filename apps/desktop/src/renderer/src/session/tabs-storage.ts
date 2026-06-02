/**
 * Tab persistence: shape, key namespace, and a defensive loader that
 * tolerates anything the SQLite KV might return (older versions, unrelated
 * payloads, hand-edited files).
 *
 * Writing is deliberately *not* abstracted — the session view writes through
 * `utils.client.settings.set` directly, because the call site needs to debounce
 * and stay aware of pending mutations. The loader, on the other hand, only
 * runs once per mount so we centralise its parsing here.
 */

import { z } from "zod";

import type { OpenTab } from "./types";

export interface PersistedTabs {
  tabs: OpenTab[];
  activeIndex: number;
}

export const TABS_VERSION = 1 as const;

const tableTabSchema = z.object({
  kind: z.literal("table"),
  schema: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
});
const viewTabSchema = z.object({
  kind: z.literal("view"),
  schema: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
});
const sqlTabSchema = z.object({
  kind: z.literal("sql"),
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
});

const openTabSchema = z.discriminatedUnion("kind", [
  tableTabSchema,
  viewTabSchema,
  sqlTabSchema,
]);

const persistedSchema = z.object({
  v: z.literal(TABS_VERSION),
  tabs: z.array(openTabSchema).max(64),
  activeIndex: z.number().int().min(-1),
});

export type PersistedPayload = z.infer<typeof persistedSchema>;

export function persistedTabsKey(connectionId: string): string {
  return `session:${connectionId}:tabs.v${TABS_VERSION}`;
}

/**
 * Parse anything that came back from the settings store. Returns `null` if
 * the payload is missing, the wrong shape, or has an index outside the tab
 * range — never throws.
 */
export function loadPersistedTabs(raw: unknown): PersistedTabs | null {
  if (raw === null || raw === undefined) return null;
  const parsed = persistedSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { tabs, activeIndex } = parsed.data;
  if (tabs.length === 0) {
    return { tabs: [], activeIndex: -1 };
  }
  const clamped = Math.max(0, Math.min(activeIndex, tabs.length - 1));
  return { tabs, activeIndex: clamped };
}

export function toPersistedPayload(snapshot: PersistedTabs): PersistedPayload {
  return {
    v: TABS_VERSION,
    tabs: snapshot.tabs,
    activeIndex: snapshot.activeIndex,
  };
}
