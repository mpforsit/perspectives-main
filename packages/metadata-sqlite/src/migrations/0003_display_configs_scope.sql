-- 0003_display_configs_scope.sql
-- Phase 2.5 — scope DisplayConfig rows by database identity.
--
-- The Phase 1.3 table keyed DisplayConfig by `id = "<schema>.<table>"`,
-- which doesn't survive once two databases share the same schema layout
-- (e.g. prod + staging with identical tables but different display
-- preferences). The new shape adds `scope` (the engine's
-- `relationScopeKey(profile)` — same key the custom-relations table uses)
-- and switches the PK to the composite `(scope, schema_name, table_name)`.
--
-- SQLite can't ALTER the primary key in place, so we drop + recreate. The
-- 1.3 UI never wrote to display_configs, but the migration still preserves
-- any rows defensively by parsing the legacy `id` (`<schema>.<table>`) and
-- assigning them to the empty-string scope. The engine's writers always
-- pass a real scope key — the empty bucket is just for "rows that
-- predate the column".

CREATE TABLE display_configs_new (
  scope       TEXT NOT NULL DEFAULT '',
  schema_name TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  payload     TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (scope, schema_name, table_name)
);

-- `instr(id, '.')` locates the schema/table separator. Schema names with
-- embedded dots are pathological enough that we accept slight breakage
-- here in exchange for a simple migration; the engine's writers never
-- emit such ids.
INSERT INTO display_configs_new (scope, schema_name, table_name, payload, updated_at)
SELECT
  '',
  substr(id, 1, instr(id, '.') - 1),
  substr(id, instr(id, '.') + 1),
  payload,
  updated_at
FROM display_configs
WHERE instr(id, '.') > 0;

DROP TABLE display_configs;
ALTER TABLE display_configs_new RENAME TO display_configs;

CREATE INDEX idx_display_configs_scope ON display_configs(scope);
