import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ValidationError, type ConnectionProfile } from "@perspectives/engine";

import { InMemoryCredentialStore, SqliteMetadataStore } from "../src";

/**
 * Password-leak guard.
 *
 * Saves a connection profile whose password is a high-entropy sentinel,
 * closes the DB, and then scans every file in the database directory for
 * the sentinel as raw bytes. Even WAL / shared-memory companion files are
 * caught: the test reads the whole directory.
 *
 * If this test ever fails, do NOT mute it — something is writing a
 * credential to disk that shouldn't be.
 */

describe("CredentialStore separation — password-leak guard", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "perspectives-meta-sqlite-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("never writes the connection password into the SQLite file", async () => {
    // Use a base64 sentinel so it's identifiable in arbitrary file contents.
    // Crucially, the entropy makes false positives effectively impossible.
    const password =
      "LEAK_GUARD_SENTINEL_" + randomBytes(16).toString("base64url");
    const filePath = join(tmpDir, "leak-guard.db");

    const credentialStore = new InMemoryCredentialStore();
    const store = new SqliteMetadataStore({
      filePath,
      credentialStore,
    });

    const profile: ConnectionProfile = {
      id: "conn_leak_guard",
      name: "Leak guard",
      dialect: "postgres",
      host: "localhost",
      port: 5432,
      database: "perspectives",
      user: "perspectives",
      password,
      environment: "development",
      createdAt: "2026-05-29T08:00:00.000Z",
      updatedAt: "2026-05-29T08:00:00.000Z",
    };

    await store.connections.create(profile);

    // Force a checkpoint by closing the database; any WAL data is folded
    // into the main file and the file handle is released.
    await store.close();

    const sentinel = Buffer.from(password, "utf8");
    const files = readdirSync(tmpDir);
    expect(files.length).toBeGreaterThan(0); // sanity: we actually wrote something

    for (const name of files) {
      const buf = readFileSync(join(tmpDir, name));
      expect(
        buf.includes(sentinel),
        `password sentinel was found in ${name}`,
      ).toBe(false);
    }

    // Cross-check: the credential store DOES still hold the password. If it
    // didn't, the test would only prove we lost the password, not that we
    // segregated it.
    expect(await credentialStore.get(profile.id)).toBe(password);
  });

  /**
   * Until Phase 4 ships a `CredentialStore`-routed secret path, every secret
   * field on the connection profile must be refused at the writer. This is
   * defense in depth on top of the IPC-boundary schema (see
   * `apps/desktop/src/main/trpc/inputs.ts`) — a bug there would otherwise
   * land plaintext secrets in the SQLite file.
   */
  it.each([
    {
      label: "ssl.clientKey",
      overrides: {
        ssl: {
          mode: "verify-full" as const,
          clientKey: "LEAK_GUARD_SENTINEL_CLIENT_KEY_PEM",
        },
      },
    },
    {
      label: "sshTunnel.password",
      overrides: {
        sshTunnel: {
          host: "bastion",
          port: 22,
          user: "deploy",
          authMethod: "password" as const,
          password: "LEAK_GUARD_SENTINEL_SSH_PASSWORD",
        },
      },
    },
    {
      label: "sshTunnel.privateKey",
      overrides: {
        sshTunnel: {
          host: "bastion",
          port: 22,
          user: "deploy",
          authMethod: "key" as const,
          privateKey: "LEAK_GUARD_SENTINEL_SSH_PRIVATE_KEY_PEM",
        },
      },
    },
    {
      label: "sshTunnel.passphrase",
      overrides: {
        sshTunnel: {
          host: "bastion",
          port: 22,
          user: "deploy",
          authMethod: "key" as const,
          passphrase: "LEAK_GUARD_SENTINEL_SSH_PASSPHRASE",
        },
      },
    },
  ])(
    "refuses to persist a profile carrying $label",
    async ({ overrides }) => {
      const filePath = join(tmpDir, `secret-leak-${randomBytes(4).toString("hex")}.db`);
      const credentialStore = new InMemoryCredentialStore();
      const store = new SqliteMetadataStore({ filePath, credentialStore });

      const profile: ConnectionProfile = {
        id: `conn_${randomBytes(4).toString("hex")}`,
        name: "Secret leak guard",
        dialect: "postgres",
        host: "localhost",
        port: 5432,
        database: "perspectives",
        user: "perspectives",
        password: "irrelevant",
        environment: "development",
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:00.000Z",
        ...overrides,
      };

      await expect(store.connections.create(profile)).rejects.toBeInstanceOf(
        ValidationError,
      );

      // Scan every file the store may have created for the sentinel — if the
      // write was aborted *after* a partial flush, this is what catches it.
      const files = readdirSync(tmpDir);
      for (const name of files) {
        const buf = readFileSync(join(tmpDir, name));
        for (const sentinel of [
          "LEAK_GUARD_SENTINEL_CLIENT_KEY_PEM",
          "LEAK_GUARD_SENTINEL_SSH_PASSWORD",
          "LEAK_GUARD_SENTINEL_SSH_PRIVATE_KEY_PEM",
          "LEAK_GUARD_SENTINEL_SSH_PASSPHRASE",
        ]) {
          expect(
            buf.includes(Buffer.from(sentinel, "utf8")),
            `${sentinel} was found in ${name}`,
          ).toBe(false);
        }
      }

      await store.close();
    },
  );

  it("round-trips the password back onto a profile on read", async () => {
    const filePath = join(tmpDir, "round-trip.db");
    const credentialStore = new InMemoryCredentialStore();
    const store = new SqliteMetadataStore({ filePath, credentialStore });

    const password = "round-trip-" + randomBytes(8).toString("hex");
    const profile: ConnectionProfile = {
      id: "conn_round_trip",
      name: "RT",
      dialect: "postgres",
      host: "localhost",
      port: 5432,
      database: "perspectives",
      user: "perspectives",
      password,
      environment: "development",
      createdAt: "2026-05-29T08:00:00.000Z",
      updatedAt: "2026-05-29T08:00:00.000Z",
    };

    await store.connections.create(profile);
    const back = await store.connections.get(profile.id);
    expect(back?.password).toBe(password);

    await store.close();
  });
});
