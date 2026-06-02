import Database from "better-sqlite3";

import type { MetadataStore } from "@perspectives/engine";

import { AuditLogStore } from "./audit";
import { ConnectionsStore } from "./connections";
import type { CredentialStore } from "./credentials";
import { DisplayConfigsStore } from "./display-configs";
import { BUNDLED_MIGRATIONS } from "./migrations-index";
import {
  runMigrations,
  type Migration,
  type MigrationResult,
} from "./migrations";
import { PerspectivesStore } from "./perspectives";
import { RelationsStore } from "./relations";
import { SettingsStore } from "./settings";

export interface SqliteMetadataStoreOptions {
  /** Filesystem path to the SQLite file, or `":memory:"` for an ephemeral DB. */
  filePath: string;
  /** Where connection passwords go. Tests use `InMemoryCredentialStore`. */
  credentialStore: CredentialStore;
  /** Override the migration list. Defaults to `BUNDLED_MIGRATIONS` (the
   *  package's own numbered SQL files, imported with `?raw` so they're baked
   *  into the bundle). Tests can pass a smaller list. */
  migrations?: Migration[];
  /** Override the clock; tests pin it for reproducibility. */
  now?: () => string;
}

/**
 * `MetadataStore` backed by a local SQLite file via `better-sqlite3`.
 *
 * Construction is synchronous — calling `new SqliteMetadataStore(...)` opens
 * the file and applies pending migrations before returning. Use `close()` to
 * release the file handle.
 *
 * Migrations are loaded at bundle / vite-node time via `?raw` imports rather
 * than from disk at runtime; this matters because when this package gets
 * inlined into the Electron main process bundle, `import.meta.url` resolves
 * to the bundle's location and a filesystem `readdirSync` against
 * `migrations/` would find nothing.
 *
 * Workspaces / members / shares are intentionally not implemented. Local
 * mode has no workspaces; shared-mode stores live in
 * `@perspectives/metadata-postgres` and `@perspectives/metadata-remote`.
 */
export class SqliteMetadataStore implements MetadataStore {
  private readonly db: Database.Database;
  private readonly migrationResult: MigrationResult;

  readonly connections: ConnectionsStore;
  readonly perspectives: PerspectivesStore;
  readonly relations: RelationsStore;
  readonly displayConfig: DisplayConfigsStore;
  readonly auditLog: AuditLogStore;
  readonly settings: SettingsStore;

  constructor(options: SqliteMetadataStoreOptions) {
    this.db = new Database(options.filePath);

    // Predictable behaviour first, performance second — the local desktop
    // store is single-writer single-process so the trade-offs are mild.
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("synchronous = NORMAL");

    this.migrationResult = runMigrations(this.db, {
      migrations: options.migrations ?? BUNDLED_MIGRATIONS,
      ...(options.now !== undefined ? { now: options.now } : {}),
    });

    this.connections = new ConnectionsStore(this.db, options.credentialStore);
    this.perspectives = new PerspectivesStore(this.db);
    this.relations = new RelationsStore(this.db);
    this.displayConfig = new DisplayConfigsStore(this.db);
    this.auditLog = new AuditLogStore(this.db);
    this.settings = options.now !== undefined
      ? new SettingsStore(this.db, options.now)
      : new SettingsStore(this.db);
  }

  /** Migrations applied / skipped during this store's construction. Tests
   *  use it to verify the runner's idempotency. */
  getMigrationResult(): MigrationResult {
    return this.migrationResult;
  }

  close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }
}
