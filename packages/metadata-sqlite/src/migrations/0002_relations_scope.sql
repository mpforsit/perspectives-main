-- 0002_relations_scope.sql
-- Phase 2.1 — scope custom RelationDefs by database identity.
--
-- A custom relation is tied to a `(dialect, host, port, database)` tuple,
-- not to a ConnectionProfile id. Renaming a connection profile, or adding a
-- second profile that points at the same DB, must leave its relations
-- intact and discoverable. The `scope` column stores the
-- `relationScopeKey()` output from packages/engine; the metadata store
-- treats it as opaque.
--
-- DEFAULT '' covers any pre-existing rows from Phase 1 (none in practice,
-- since the table was created but never written to outside tests). The
-- engine never queries for scope = ''; it always passes a real scope key.

ALTER TABLE relations ADD COLUMN scope TEXT NOT NULL DEFAULT '';

-- The single read pattern is "list all custom relations for one scope" —
-- one row per relation, so the index is small. A second pattern (get-by-id)
-- already uses the PRIMARY KEY index.
CREATE INDEX idx_relations_scope ON relations(scope);
