/**
 * The `CredentialStore` interface lives in `@perspectives/engine` so the
 * engine's `EngineService` and any future store can talk to credentials
 * without going through this SQLite package. We re-export it here so the
 * rest of `metadata-sqlite` keeps its existing `from "./credentials"`
 * imports working.
 *
 * `InMemoryCredentialStore` stays here — it's a concrete (and admittedly
 * test-grade) implementation, and the engine package deliberately keeps
 * itself free of runtime classes that go on disk or over the network.
 */

import type { CredentialStore } from "@perspectives/engine";

export type { CredentialStore };

/**
 * Memory-only credential store. Lives for the lifetime of the process and is
 * what unit tests use. Never use this in production — credentials would be
 * lost on every restart.
 */
export class InMemoryCredentialStore implements CredentialStore {
  private readonly map = new Map<string, string>();

  set(connectionId: string, password: string): Promise<void> {
    this.map.set(connectionId, password);
    return Promise.resolve();
  }

  get(connectionId: string): Promise<string | null> {
    return Promise.resolve(this.map.get(connectionId) ?? null);
  }

  delete(connectionId: string): Promise<void> {
    this.map.delete(connectionId);
    return Promise.resolve();
  }
}
