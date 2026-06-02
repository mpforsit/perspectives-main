/**
 * `SafeStorageCredentialStore` — the real Electron `CredentialStore`.
 *
 * Connection passwords are encrypted with `safeStorage.encryptString`, which
 * delegates to an OS-bound key (macOS Keychain, Windows DPAPI, libsecret on
 * Linux). The resulting ciphertext blobs are base64-encoded and held in a
 * single JSON file at `<userData>/credentials.json`:
 *
 *   {
 *     "01J9X...": "<base64 ciphertext>",
 *     "01J9Y...": "<base64 ciphertext>"
 *   }
 *
 * The file is written atomically (tmp + rename) with mode 0600. Plaintext
 * passwords are never serialized — they live on the heap only for the brief
 * window between `encryptString` and `decryptString`. We also never log them.
 *
 * Failure modes worth knowing about:
 *   - `safeStorage.isEncryptionAvailable()` returns false on some Linux
 *     sessions (no keyring) and headless CI runners. `set` throws in that
 *     case; the UI surfaces it as "encrypted storage unavailable" and
 *     refuses to persist the connection.
 *   - `decryptString` throws if the OS key rotated under us (e.g., user
 *     restored the file from another machine). We swallow that and return
 *     `null` — the UI then prompts for re-entry, which is the right outcome.
 *   - The file may be corrupted (truncated mid-write, hand-edited). We log
 *     a warning and start fresh; the user re-enters credentials.
 */

import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { app, safeStorage } from "electron";

import type { CredentialStore } from "@perspectives/engine";

type EncryptedSecrets = Record<string, string>;

export interface SafeStorageCredentialStoreOptions {
  /** Override the file path. Defaults to `<userData>/credentials.json`. */
  filePath?: string;
}

export class SafeStorageCredentialStore implements CredentialStore {
  private readonly filePath: string;
  private secrets: EncryptedSecrets;

  constructor(options: SafeStorageCredentialStoreOptions = {}) {
    this.filePath = options.filePath ?? join(app.getPath("userData"), "credentials.json");
    this.secrets = this.load();
  }

  set(connectionId: string, password: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      // Hard refusal. Better to fail loud than to store plaintext.
      return Promise.reject(
        new Error(
          "Electron safeStorage encryption is not available on this system. " +
            "Cannot persist connection credentials.",
        ),
      );
    }
    const ciphertext = safeStorage.encryptString(password);
    this.secrets[connectionId] = ciphertext.toString("base64");
    this.persist();
    return Promise.resolve();
  }

  get(connectionId: string): Promise<string | null> {
    const encoded = this.secrets[connectionId];
    if (encoded === undefined) return Promise.resolve(null);
    if (!safeStorage.isEncryptionAvailable()) return Promise.resolve(null);
    const ciphertext = Buffer.from(encoded, "base64");
    try {
      return Promise.resolve(safeStorage.decryptString(ciphertext));
    } catch {
      // OS key changed (e.g., user moved the userData directory between
      // machines, or the keychain was reset). Treat as "no credential" so
      // the UI prompts for re-entry — better than crashing.
      return Promise.resolve(null);
    }
  }

  delete(connectionId: string): Promise<void> {
    if (this.secrets[connectionId] === undefined) return Promise.resolve();
    delete this.secrets[connectionId];
    this.persist();
    return Promise.resolve();
  }

  // --------------------------------------------------------------------------
  // I/O
  // --------------------------------------------------------------------------

  private load(): EncryptedSecrets {
    try {
      statSync(this.filePath);
    } catch {
      // File doesn't exist yet — perfectly normal on first run.
      return {};
    }
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      // Shallow shape check: every value must be a string (base64 ciphertext).
      const result: EncryptedSecrets = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") result[k] = v;
      }
      return result;
    } catch {
      // Corrupted JSON; we'd rather start fresh than refuse to launch.
      return {};
    }
  }

  /** Atomic write: tmp file + rename. The rename is atomic on POSIX. */
  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    const json = JSON.stringify(this.secrets);
    // Create with mode 0600 — owner read/write only.
    const fd = openSync(tmpPath, "w", 0o600);
    try {
      writeFileSync(fd, json, "utf8");
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, this.filePath);
  }
}
