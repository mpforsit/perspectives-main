-- ============================================================================
-- 0001_initial.sql — bootstrap schema for the local SQLite metadata store.
-- ============================================================================
--
-- One table per first-class MetadataStore collection (connections,
-- perspectives, relations, display configs, audit log, settings). All DSL
-- objects (perspectives, relations, display configs) are stored as
-- JSON-encoded text and validated through the DSL Zod schemas at both write
-- and read time; the column type here is just opaque storage.
--
-- The `_migrations` table is created by the migration runner before any
-- numbered files run. We intentionally do NOT re-create it here so the
-- runner is the single source of truth for its shape.

-- ---------------------------------------------------------------------------
-- Connection profiles — credentials live in CredentialStore, NOT here.
-- ---------------------------------------------------------------------------
CREATE TABLE connections (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  dialect           TEXT NOT NULL,
  host              TEXT NOT NULL,
  port              INTEGER NOT NULL,
  database          TEXT NOT NULL,
  "user"            TEXT NOT NULL,
  application_name  TEXT,
  environment       TEXT NOT NULL,
  -- JSON-encoded SslOptions. Secret fields (ssl.clientKey, every
  -- sshTunnel.* secret) are refused at the writer in `connections.ts`:
  -- they would otherwise persist plaintext to this on-disk SQLite file.
  -- Phase 4 routes them through `CredentialStore`; the columns can carry
  -- their non-secret companions (caCert, clientCert, tunnel host/port/user)
  -- once that lands.
  ssl_json          TEXT,
  ssh_tunnel_json   TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- DSL collections — payload is JSON text, validated on the way in and out.
-- ---------------------------------------------------------------------------
CREATE TABLE perspectives (
  id          TEXT PRIMARY KEY,
  payload     TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE relations (
  id          TEXT PRIMARY KEY,
  payload     TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- DisplayConfig is keyed by (schema, table) in the DSL; the store flattens
-- that composite key into `"<schema>.<table>"` for `CRUDStore`'s string id.
CREATE TABLE display_configs (
  id          TEXT PRIMARY KEY,
  payload     TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Append-only audit log. Indexed for the common queries: by time and by
-- table. Workspace/user filtering will come when shared mode lands.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id                  TEXT PRIMARY KEY,
  workspace_id        TEXT,
  user_id             TEXT NOT NULL,
  timestamp           TEXT NOT NULL,
  connection_id       TEXT NOT NULL,
  perspective_id      TEXT,
  table_name          TEXT NOT NULL,
  primary_key_json    TEXT NOT NULL,
  action              TEXT NOT NULL,
  before_values_json  TEXT,
  after_values_json   TEXT
);

CREATE INDEX audit_log_timestamp_idx  ON audit_log (timestamp);
CREATE INDEX audit_log_table_name_idx ON audit_log (table_name);

-- ---------------------------------------------------------------------------
-- Settings: a string-keyed key/value store. Values are JSON-encoded.
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
