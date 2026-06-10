/**
 * Audit log — schema validation + round-trip tests. See AUDIT-CODEX.md
 * long-term #4.
 *
 * The metadata store's `auditLog.append` now runs through the canonical
 * `auditEventSchema`, so malformed events never reach the SQLite row.
 * We also verify the round-trip preserves every optional field.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ValidationError,
  type AuditEvent,
} from "@perspectives/engine";

import { InMemoryCredentialStore, SqliteMetadataStore } from "../src";

const NOW = "2026-06-10T00:00:00.000Z";

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "evt_01J9X2KZQ5N7P3VCM8B4ETRGYH",
    userId: "user_local",
    timestamp: NOW,
    connectionId: "conn_local",
    table: "public.customers",
    primaryKey: { id: 42 },
    action: "update",
    ...overrides,
  };
}

describe("AuditLogStore — schema validation", () => {
  let store: SqliteMetadataStore;

  beforeEach(() => {
    store = new SqliteMetadataStore({
      filePath: ":memory:",
      credentialStore: new InMemoryCredentialStore(),
      now: () => NOW,
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("accepts a complete event and round-trips it", async () => {
    const event = makeEvent({
      beforeValues: { email: "old@example.com" },
      afterValues: { email: "new@example.com" },
      perspectiveId: "01J9X2KZQ5N7P3VCM8B4ETRGYH",
      workspaceId: "ws_local",
    });
    await store.auditLog.append(event);
    const [back] = await store.auditLog.list();
    expect(back).toEqual(event);
  });

  it.each([
    { label: "missing userId", overrides: { userId: "" } },
    { label: "missing connectionId", overrides: { connectionId: "" } },
    { label: "missing table", overrides: { table: "" } },
    {
      label: "bad timestamp",
      overrides: { timestamp: "not-an-ISO-date" },
    },
    {
      label: "bad action",
      overrides: { action: "patch" as unknown as AuditEvent["action"] },
    },
  ])("rejects events with $label", async ({ overrides }) => {
    await expect(
      store.auditLog.append(makeEvent(overrides)),
    ).rejects.toBeInstanceOf(ValidationError);
    // And nothing landed.
    expect(await store.auditLog.list()).toEqual([]);
  });

  it("filters by since/until and respects limit/offset", async () => {
    const events = ["2026-06-09T00:00:00.000Z", "2026-06-10T00:00:00.000Z", "2026-06-11T00:00:00.000Z"]
      .map((ts, i) => makeEvent({ id: `evt_${i.toString().padStart(26, "0")}`, timestamp: ts }));
    for (const e of events) await store.auditLog.append(e);

    const since = await store.auditLog.list({ since: "2026-06-10T00:00:00.000Z" });
    expect(since.map((e) => e.timestamp)).toEqual([
      "2026-06-10T00:00:00.000Z",
      "2026-06-11T00:00:00.000Z",
    ]);

    const until = await store.auditLog.list({ until: "2026-06-10T00:00:00.000Z" });
    expect(until.map((e) => e.timestamp)).toEqual(["2026-06-09T00:00:00.000Z"]);

    const paged = await store.auditLog.list({ limit: 1, offset: 1 });
    expect(paged.map((e) => e.timestamp)).toEqual(["2026-06-10T00:00:00.000Z"]);
  });
});
