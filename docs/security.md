# Security model

This document is the design target for Perspectives' security boundaries.
v1 (local desktop, single user) implements only the parts marked **today**;
the rest is the deliberate plan for Phases 5–7 so the foundation isn't
re-litigated when sync, sharing, and AI ship.

Treat this file as load-bearing: every PR that widens an attack surface
should cite the relevant section and either match the plan or update it.

## Layers and seams

The system has three trust boundaries; everything else is application
plumbing on top of them.

```
       ┌──────────────────────────────────────────────┐
       │  RENDERER  (React, browser-tier privileges)  │  ← untrusted
       └────────────────────┬─────────────────────────┘
                            │  tRPC over IPC (desktop)
                            │  tRPC over HTTPS (server) — Phase 5
       ┌────────────────────▼─────────────────────────┐
       │  ENGINE    (Node, holds DB credentials)      │  ← privileged
       └────────────────────┬─────────────────────────┘
                            │  pg, ssh2, …
       ┌────────────────────▼─────────────────────────┐
       │  TARGET DB (user's own database)             │  ← out of scope
       └──────────────────────────────────────────────┘
```

- **Renderer ↔ Engine** is the trust boundary the desktop app already cares
  about. The renderer never sees raw credentials, never constructs SQL,
  and reaches the engine only through the typed tRPC surface.
- **Engine ↔ Target DB** is the user's own perimeter. We pass through
  their credentials; their database's own permission model is the
  authoritative authorization layer. Perspectives never tries to be a
  policy layer on top of the user's DB.
- **Renderer ↔ Engine over HTTPS** is the *future* shared-mode boundary —
  the one Phase 5 introduces. Everything below in §"Shared mode" assumes
  this boundary exists.

## Threat model

| Adversary | In scope | Mitigation |
|---|---|---|
| Malicious local file on disk | **Today** | Encrypted credential store (Electron `safeStorage`, OS keychain); plaintext metadata SQLite contains no secrets. |
| Renderer XSS (third-party CSS / shadcn dep, etc.) | **Today** | Strict CSP, `contextIsolation: true`, `sandbox: true`, narrow `contextBridge`, Electron fuses (no `ELECTRON_RUN_AS_NODE`, no `--inspect`, ASAR integrity). |
| Malicious env var on packaged launch | **Today** | `ELECTRON_RENDERER_URL` honored only when `!app.isPackaged` AND points at loopback. |
| Untrusted perspective JSON (AI / share / import) | **Today** | `trustedSql: true` marker; otherwise no `computed` columns or `kind: "sql"` bases. |
| Untrusted target DB (compromised connection) | Partial | Read paths run in `BEGIN TRANSACTION READ ONLY`. Phase 4+ writes will require explicit user confirmation for `production`-tagged connections. |
| Malicious workspace peer in shared mode | **Phase 6** | See §"Shared mode" below. |
| Anonymous attacker reaching server | **Phase 5** | See §"Authentication". |
| Compromised registry / supply-chain attack on a dep | **Today** (partial) | `pnpm audit --audit-level=high` gates CI; SBOM generated per release; Renovate / Dependabot for ongoing updates. |
| Compromised release binary | Partial | Electron fuses (ASAR integrity) today; code signing + notarization in Phase 9. |

Out of scope:

- Physical access to the user's machine. The on-disk credential store is
  protected by the OS keychain — that's the contract the host OS provides
  and we don't reinvent it.
- Side-channel attacks (Spectre, timing) against the renderer process.
  Electron's process model + Chromium's mitigations are the layer.

## Today — local single-user mode

### Authentication
There is none. The single OS user *is* the principal. There's nothing to
authenticate to — the engine runs in the user's own Electron process and
the user trusts their OS account.

### Authorization
There is none. The user is trusted-omnipotent. The engine has a stub
`Context` interface in `apps/desktop/src/main/trpc/router.ts` that will
carry caller identity once shared mode lands; today every tRPC procedure
executes with effective root.

### Credentials
- Connection passwords live in
  [`SafeStorageCredentialStore`](../apps/desktop/src/main/credentials.ts).
  `safeStorage.encryptString` ties them to the OS keychain key; the
  ciphertext blobs land in `<userData>/credentials.json`. SQLite metadata
  carries no secret fields.
- The `ConnectionProfile.password` field is structurally present (the DSL
  schema requires `password: string`) but the SQLite store routes it
  through `CredentialStore.set()` rather than into the JSON row. The
  password-leak guard test runs every CI build.
- SSL `clientKey` and the entire `sshTunnel` block are refused at the IPC
  boundary AND in the SQLite store's `validateProfileShape`. Phase 4 lands
  these via the credential store under a separate `ConnectionSecrets`
  type.

### Renderer ↔ Engine boundary
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` —
  the renderer has no Node privileges.
- The only bridge is `window.perspectivesAPI.trpc`, exposing one IPC
  channel that takes typed tRPC envelopes. Raw `ipcRenderer` is *not*
  exposed.
- `ELECTRON_RENDERER_URL` is honored only when `!app.isPackaged` and
  points at a loopback HTTP origin. `setWindowOpenHandler` and
  `will-navigate` allowlist `http(s):` for `shell.openExternal` and deny
  everything else.
- Content-Security-Policy is installed via
  `session.webRequest.onHeadersReceived` (works for both `file://` and
  `http://localhost` loads). Production: `script-src 'self'`, no eval, no
  remote connect. Dev: scoped to the Vite loopback origin only.

### SQL safety
- Structured `QueryPlan` is the canonical request shape; the
  `adapter-postgres` compiler is the only code that renders SQL.
- Identifiers go through `quoteIdentifier`; filter values are bound as
  `$N` parameters. The only raw-SQL interpolation site is `computed`
  column sources — gated behind `trustedSql: true`.
- Every read path runs inside `BEGIN TRANSACTION READ ONLY`. A regression
  in the compiler that tried to emit an `INSERT` would surface as a
  SQLSTATE 25006 (`read_only_sql_transaction`).
- The SQL console adds `statement_timeout`, `idle_in_transaction_session_timeout`,
  a row cap, a byte cap, and AbortSignal → `pg_cancel_backend(pid)`
  cancellation. Result truncation surfaces in the UI with a banner.

## Phase 5 — Shared metadata service

When the desktop app links to a workspace, the metadata store switches
from local SQLite to `RemoteMetadataStore` (an HTTPS client) and the
server runs the same engine code behind an authenticated HTTP surface.

### Authentication
- **Primary**: email + password (Argon2id, parameters as recommended by
  OWASP at implementation time). Sessions via Better Auth or Lucia —
  decide before Phase 5 lands, not in the PR.
- **OAuth**: GitHub, Google. Standard PKCE flow, no implicit grants.
- **Magic links**: optional, gated on rate limit + replay protection.
- Sessions are HTTP-only, `SameSite=Lax`, `Secure`, with a CSRF token
  rotation per request for mutating endpoints. The tRPC client adds the
  token to a custom header (`X-Perspectives-CSRF`); the server compares
  it to the session token.
- TOTP / WebAuthn second factor — Phase 6 nice-to-have.

### Authorization (workspace-scoped)
- Membership: every user has zero or more workspaces. Each membership
  carries one of four base roles: `owner`, `admin`, `editor`, `viewer`.
  Roles bound what's editable in the *workspace itself* (perspectives,
  relations, display configs, member list) — they do not grant or deny
  raw target-DB access.
- The tRPC `Context` grows three fields: `userId`, `workspaceId`,
  `role`. The middleware that fills them runs on every authenticated
  procedure; unauthenticated procedures fail closed.
- The router is split into three slices — `local` (anything OK to run in
  single-user mode), `member` (anything that requires a workspace), and
  `admin` (workspace-management). The middleware enforces the slice
  the procedure was declared in.

### Connection credentials in shared mode
- A connection profile can be marked `workspaceShared: true`. Shared
  connections live on the server with their credentials encrypted at
  rest using a workspace-scoped key derived from the server's master
  key. The decryption only happens inside the engine process when a
  query is being executed for a member of the workspace.
- Non-owners never see the raw credentials. They submit a tRPC query;
  the server resolves the connection, decrypts in memory, runs the
  query, and discards the plaintext. The desktop UI for non-owners
  shows the connection's *metadata* (host, db, environment tag) and a
  "Test connection" affordance that runs server-side.
- This is the bridge Phase 6 collaboration depends on.

### Wire format
- tRPC over HTTPS — the same router that runs in Electron's main
  process. The transport is the only difference; the schemas
  (`@perspectives/dsl`'s canonical Zod) are shared verbatim.
- Sync model: pull-on-open + ETag round-trips. Long-poll or SSE for
  near-live updates is Phase 6+. Mutations are individual REST-style
  calls; the server is the conflict authority.

## Phase 6 — Permissions on perspectives

The `PermissionDef` from the DSL becomes load-bearing once perspectives
can be shared.

```ts
type PermissionDef = {
  read:   "allow" | "rule";
  insert: "allow" | "deny" | "rule";
  update: "allow" | "deny" | "rule" | "columns";
  delete: "allow" | "deny" | "rule";
  rowFilter?: FilterGroup;
  columnRules?: Record<string, { read: boolean; write: boolean }>;
};
```

### Permission compiler
- A separate engine module (`packages/engine/src/permissions.ts`, not
  yet implemented) compiles a `PermissionDef` against the caller's
  `Context` into a `FilterGroup` that is *injected* into every plan
  before it reaches the adapter.
- Row filters use `{ kind: "currentUser" }` dynamic values — the
  compiler swaps these for the `Context.userId` at plan time.
- Column rules drop read-denied columns from the projection and
  reject mutations that touch write-denied columns with a typed
  `PermissionDeniedError`.

### Server-side enforcement is the only enforcement
- The UI's permission state is for UX hints (greying out fields,
  hiding tabs). The server re-evaluates on every request — the client
  is never trusted with the policy.
- Relation traversal is permission-gated: a user without read access
  to `orders` can't reach a customer row's "View 47 orders" affordance
  because the engine refuses to resolve a `JoinDef` whose target table
  is not in the user's accessible set.

### Audit log
- Every write goes through `EngineService.recordAuditEvent()`. The
  event is validated against the canonical `auditEventSchema` before
  hitting the `auditLog` `AppendStore`. Each event carries the
  perspective id the write went through, the user id, the connection
  id, the table, the primary-key tuple, the action, and the
  before/after value snapshots. See
  [`packages/dsl/src/metadata.ts`](../packages/dsl/src/metadata.ts).
- Permission-sensitive reads (anything that hits a perspective with
  non-trivial `rowFilter` or `columnRules`) emit a read-audit event
  too. Sampled — full per-row logging would crush the audit table —
  but rate is config-tunable.

## Open decisions

These need answers before the relevant phase ships; today they are
deliberately unspecified.

- **Server-side master key rotation.** Encryption-at-rest of shared
  connection credentials needs a re-keying ceremony that doesn't
  require downtime. Likely: envelope encryption with a periodic data-
  encryption-key rotation, master key kept in KMS or HashiCorp Vault.
- **Custom roles.** Phase 6 ships fixed roles. If a paying customer
  asks for custom roles, the permission compiler is already the right
  hook — we'd add a `roleId` field to membership and a `permissions
  matrix` table.
- **Cross-workspace sharing.** Out of scope today; the share model
  assumes one workspace per perspective. If we add it, `Share.audience`
  grows a `{ kind: "workspace"; workspaceId: string }` variant.
- **AI safety rails.** Phase 7 will let AI emit perspectives. Those
  perspectives go through `validatePerspective` which already refuses
  raw-SQL fields on untrusted (default) perspectives — but generated
  mutations need their own confirmation flow. Sketch in Phase 7's
  design doc when it lands.

## Cross-references

- [docs/architecture.md](architecture.md) — three-layer architecture
- [docs/plan.md](plan.md) — phased roadmap
- [AUDIT-CODEX.md](../AUDIT-CODEX.md) — security audit driving these
  decisions
- [packages/dsl/src/metadata.ts](../packages/dsl/src/metadata.ts) — the
  Zod schemas this document operates on
