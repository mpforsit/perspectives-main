/**
 * Tiny migration runner.
 *
 * Each migration is a `{ filename, sql }` record — the caller supplies the
 * list (see `migrations-index.ts` for the canonical bundled list). The
 * runner:
 *
 *   1. Creates `_migrations(filename TEXT PRIMARY KEY, applied_at TEXT)` if
 *      it doesn't already exist.
 *   2. Sorts the input list lexicographically by `filename` (so the caller
 *      doesn't have to remember to).
 *   3. Applies any migration whose filename isn't already in `_migrations`,
 *      inside a transaction, and records it on success.
 *
 * Idempotency falls out of step 3 — re-running with no new migrations is a
 * no-op because every filename is already in `_migrations`. Partial failures
 * don't half-apply because the SQL and the bookkeeping `INSERT` are in the
 * same transaction.
 *
 * Why a list, not a directory: the metadata-sqlite package gets bundled into
 * the Electron main process. After bundling, `import.meta.url` resolves to
 * the bundle's location, not the original source, so `readdirSync` against a
 * `migrations/` directory finds nothing. Passing the migrations as data
 * (loaded at compile time via `?raw` imports — see `migrations-index.ts`)
 * sidesteps the filesystem entirely.
 */

import type Database from "better-sqlite3";

export interface Migration {
  /** Name to record in `_migrations`. Used for ordering and idempotency. */
  filename: string;
  /** Raw SQL to execute inside the transaction. */
  sql: string;
}

export interface MigrationRunOptions {
  /** Migrations to consider applying, in any order. The runner sorts them. */
  migrations: Migration[];
  /** Clock for the `applied_at` timestamp. Tests can pin it. */
  now?: () => string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export function runMigrations(
  db: Database.Database,
  options: MigrationRunOptions,
): MigrationResult {
  const now = options.now ?? (() => new Date().toISOString());

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const alreadyApplied = new Set(
    db
      .prepare<[], { filename: string }>("SELECT filename FROM _migrations")
      .all()
      .map((row) => row.filename),
  );

  const sorted = [...options.migrations].sort((a, b) =>
    a.filename.localeCompare(b.filename),
  );

  const applied: string[] = [];
  const skipped: string[] = [];
  const insertMigration = db.prepare(
    "INSERT INTO _migrations (filename, applied_at) VALUES (?, ?)",
  );

  for (const migration of sorted) {
    if (alreadyApplied.has(migration.filename)) {
      skipped.push(migration.filename);
      continue;
    }
    db.transaction(() => {
      db.exec(migration.sql);
      insertMigration.run(migration.filename, now());
    })();
    applied.push(migration.filename);
  }

  return { applied, skipped };
}
