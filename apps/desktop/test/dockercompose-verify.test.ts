/**
 * Phase 1.5 acceptance check, run against the live `docker compose` Postgres
 * on localhost:5433. Verifies the four invariants from the prompt:
 *
 *   1. The dev Postgres can be reached from this stack.
 *   2. Creating a connection persists it to SQLite.
 *   3. Reopening the SQLite store sees the saved connection again.
 *   4. The plaintext password never appears in the SQLite file.
 *
 * (The Electron-only step — that SafeStorageCredentialStore persists the
 * password across an actual app relaunch via `safeStorage` — can't be
 * exercised from vitest; that's a manual click-through. This test covers the
 * data-layer half of the same acceptance.)
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { PostgresAdapter } from "@perspectives/adapter-postgres";
import {
  EngineService,
  type ConnectionProfile,
} from "@perspectives/engine";
import {
  InMemoryCredentialStore,
  SqliteMetadataStore,
} from "@perspectives/metadata-sqlite";

const PASSWORD_SENTINEL = `VERIFY_LEAK_SENTINEL_${randomBytes(16).toString("base64url")}`;
const tmpDir = mkdtempSync(join(tmpdir(), "perspectives-verify-"));
const dbPath = join(tmpDir, "metadata.sqlite");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeProfile(): ConnectionProfile {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: "Docker Compose Dev",
    dialect: "postgres",
    host: "localhost",
    port: 5433,
    database: "perspectives_dev",
    user: "perspectives",
    // Real dev password is "perspectives" per docker-compose.dev.yml, but for
    // the leak-guard half we save with a high-entropy sentinel that can't
    // accidentally collide with anything else in the file.
    password: "perspectives",
    applicationName: "Perspectives Verify",
    environment: "development",
    createdAt: now,
    updatedAt: now,
  };
}

// Only runs when the dev Postgres is up. Set `VERIFY_DOCKERCOMPOSE=1` after a
// `docker compose -f docker-compose.dev.yml up -d` to re-run on demand. CI
// skips it because there's no Postgres on `localhost:5433` there.
describe.skipIf(!process.env["VERIFY_DOCKERCOMPOSE"])("Phase 1.5 acceptance — docker compose Postgres", () => {
  it("(1) probes the live dev Postgres on localhost:5433", async () => {
    const adapter = new PostgresAdapter(makeProfile(), {
      connectionTimeoutMillis: 5_000,
    });
    try {
      const info = await adapter.testConnection();
      expect(info.serverName).toBe("PostgreSQL");
      expect(info.database).toBe("perspectives_dev");
      expect(info.user).toBe("perspectives");
      expect(info.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      await adapter.close();
    }
  });

  it("(2 + 3) creates a connection, reopens the store, and sees it again", async () => {
    const profile = { ...makeProfile(), password: PASSWORD_SENTINEL };
    const sharedCreds = new InMemoryCredentialStore();

    // ---- First "launch" ----
    {
      const store = new SqliteMetadataStore({
        filePath: dbPath,
        credentialStore: sharedCreds,
      });
      const engine = new EngineService({
        metadataStore: store,
        credentialStore: sharedCreds,
        adapterFactory: (p) => new PostgresAdapter(p),
      });
      const summary = await engine.createConnection(profile);
      expect(summary.id).toBe(profile.id);
      // The Summary surface must not leak the password back.
      expect("password" in summary).toBe(false);
      await engine.close();
      await store.close();
    }

    // ---- Second "launch" — fresh store instances, same file ----
    {
      const store = new SqliteMetadataStore({
        filePath: dbPath,
        credentialStore: sharedCreds,
      });
      const engine = new EngineService({
        metadataStore: store,
        credentialStore: sharedCreds,
        adapterFactory: (p) => new PostgresAdapter(p),
      });
      const list = await engine.listConnections();
      expect(list.length).toBe(1);
      expect(list[0]?.id).toBe(profile.id);
      expect(list[0]?.name).toBe(profile.name);
      expect("password" in (list[0] ?? {})).toBe(false);
      await engine.close();
      await store.close();
    }
  });

  it("(4) the SQLite file does not contain the plaintext password sentinel", () => {
    const sentinel = Buffer.from(PASSWORD_SENTINEL, "utf8");
    const files = readdirSync(tmpDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const buf = readFileSync(join(tmpDir, file));
      expect(
        buf.includes(sentinel),
        `password sentinel was found in ${file} (${buf.length} bytes)`,
      ).toBe(false);
    }
  });
});
