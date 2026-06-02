/**
 * Hand-maintained list of bundled migrations.
 *
 * Each entry is imported with Vite's `?raw` suffix so the SQL becomes a
 * string literal in the compiled output — no `fs.readdirSync`, no
 * `import.meta.url` path tricks, no migration files-on-disk needed at
 * runtime. The list is in lex order (matching what the filesystem scanner
 * used to do); add new migrations at the bottom and they'll apply after the
 * existing ones.
 */

import init0001 from "./migrations/0001_initial.sql?raw";

import type { Migration } from "./migrations";

export const BUNDLED_MIGRATIONS: Migration[] = [
  { filename: "0001_initial.sql", sql: init0001 },
];
