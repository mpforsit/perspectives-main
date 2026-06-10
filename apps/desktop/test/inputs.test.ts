/**
 * IPC-boundary leak guard: the tRPC input schema for connection profiles
 * must reject every secret field that doesn't yet have an encrypted-storage
 * route. If this test ever fails, the IPC boundary has widened and the
 * downstream SQLite metadata store will land plaintext secrets on disk.
 *
 * Companion to `packages/metadata-sqlite/test/credentials.test.ts`, which
 * exercises the same guard at the persistence layer.
 */
import { describe, expect, it } from "vitest";

import { connectionProfileSchema } from "../src/main/trpc/inputs";

const NOW = "2026-06-03T00:00:00.000Z";

const baseProfile = {
  id: "01J9X2KZQ5N7P3VCM8B4ETRGYH",
  name: "Profile",
  dialect: "postgres" as const,
  host: "localhost",
  port: 5432,
  database: "perspectives",
  user: "perspectives",
  password: "irrelevant",
  environment: "development" as const,
  createdAt: NOW,
  updatedAt: NOW,
};

describe("connectionProfileSchema — secret-field leak guard", () => {
  it("accepts a baseline profile with no SSL or SSH", () => {
    expect(connectionProfileSchema.safeParse(baseProfile).success).toBe(true);
  });

  it("accepts an ssl block carrying only non-secret fields", () => {
    const result = connectionProfileSchema.safeParse({
      ...baseProfile,
      ssl: {
        mode: "verify-full",
        caCert: "-----BEGIN CERTIFICATE-----\n…",
        clientCert: "-----BEGIN CERTIFICATE-----\n…",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an ssl block carrying clientKey", () => {
    const result = connectionProfileSchema.safeParse({
      ...baseProfile,
      ssl: {
        mode: "verify-full",
        clientKey: "-----BEGIN PRIVATE KEY-----\nLEAK_GUARD_SENTINEL\n",
      },
    });
    expect(result.success).toBe(false);
  });

  it.each([
    {
      label: "sshTunnel.password",
      ssh: {
        host: "bastion",
        port: 22,
        user: "deploy",
        authMethod: "password",
        password: "LEAK_GUARD_SENTINEL_SSH_PASSWORD",
      },
    },
    {
      label: "sshTunnel.privateKey",
      ssh: {
        host: "bastion",
        port: 22,
        user: "deploy",
        authMethod: "key",
        privateKey: "LEAK_GUARD_SENTINEL_SSH_PRIVATE_KEY",
      },
    },
    {
      label: "sshTunnel.passphrase",
      ssh: {
        host: "bastion",
        port: 22,
        user: "deploy",
        authMethod: "key",
        passphrase: "LEAK_GUARD_SENTINEL_SSH_PASSPHRASE",
      },
    },
    {
      label: "any sshTunnel block at all (Phase 4 — not yet supported)",
      ssh: {
        host: "bastion",
        port: 22,
        user: "deploy",
        authMethod: "password",
      },
    },
  ])("rejects $label", ({ ssh }) => {
    const result = connectionProfileSchema.safeParse({
      ...baseProfile,
      sshTunnel: ssh,
    });
    expect(result.success).toBe(false);
  });
});
