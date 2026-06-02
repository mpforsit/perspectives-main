import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InMemoryCredentialStore, SqliteMetadataStore } from "../src";

describe("MigrationRunner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "perspectives-meta-mig-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("applies the bundled migrations cleanly to a fresh file", async () => {
    const filePath = join(tmpDir, "fresh.db");
    const store = new SqliteMetadataStore({
      filePath,
      credentialStore: new InMemoryCredentialStore(),
    });

    const result = store.getMigrationResult();
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.applied).toContain("0001_initial.sql");
    expect(result.skipped).toEqual([]);

    await store.close();
  });

  it("is idempotent — re-opening the same file applies nothing new", async () => {
    const filePath = join(tmpDir, "idempotent.db");

    const first = new SqliteMetadataStore({
      filePath,
      credentialStore: new InMemoryCredentialStore(),
    });
    const firstResult = first.getMigrationResult();
    await first.close();

    const second = new SqliteMetadataStore({
      filePath,
      credentialStore: new InMemoryCredentialStore(),
    });
    const secondResult = second.getMigrationResult();
    await second.close();

    expect(secondResult.applied).toEqual([]);
    expect(secondResult.skipped.sort()).toEqual(firstResult.applied.sort());
  });
});
