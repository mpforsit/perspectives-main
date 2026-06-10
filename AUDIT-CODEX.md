# Perspectives Security and Code Audit

Date: 2026-06-03
Reviewer: Codex
Scope reviewed: tracked application source, package manifests/lockfile, Electron main/preload/renderer, tRPC IPC boundary, engine service, Postgres adapter/compiler, SQLite metadata store, CI, Docker dev config, and project docs that define intended security boundaries.

## Executive Summary

Perspectives has a sensible early security shape: Electron runs with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`; the renderer receives a narrow `contextBridge` API; normal table browsing compiles structured `QueryPlan` objects with quoted identifiers and bound values; passwords are not returned from tRPC list/create/update calls; and tracked-file secret scanning did not find committed API keys or private keys.

The highest-risk issues are around boundaries that are already beginning to widen: non-password connection secrets can still be accepted over IPC and written into SQLite JSON, dependency advisory scanning reports vulnerable Electron/build/test packages, raw SQL escape hatches are not consistently fenced with resource limits or read-only transactions, and Electron navigation/external-link handling needs a stricter allowlist before the app carries sensitive database access.

This review is limited by the current implementation stage. Authentication, authorization, server mode, metadata-remote, metadata-postgres, write mutations, webhooks, file uploads, OAuth, cookies, sessions, and permission enforcement are not implemented yet, so there was no live code to review in those areas.

## Verification Performed

- Read required context: `docs/plan.md`, `docs/architecture.md`, `packages/dsl/src/schemas.ts`, and `AGENT_LOG.md`.
- Inventory: `rg --files`, `git ls-files`, package manifests, lockfile, hidden CI/config files.
- Static searches: secrets, credential flows, IPC/electron APIs, raw SQL, eval/HTML sinks, env/config, unsafe casts.
- `pnpm typecheck`: passed. Turbo ran 4 typecheck tasks.
- `pnpm test`: passed from cache. 189 tests passed, 3 Docker-compose verification tests skipped.
- `pnpm lint`: exits 0 but ran 0 tasks, so it is currently a no-op.
- `pnpm audit`: initial sandbox run failed with `ENOTFOUND registry.npmjs.org`; escalated run completed and reported 20 advisories: 2 critical, 8 high, 8 moderate, 2 low.
- Tracked-file secret regex: no committed API keys, private keys, or high-entropy tokens found. Intentional local/dev Postgres passwords exist in docs/tests.

## Ranked Top Risks

1. Non-password connection secret fields are accepted over IPC and stored as plaintext JSON in SQLite.
2. Dependency audit reports vulnerable Electron and build/test toolchain packages, including critical Vitest and multiple high `tar`/`undici` advisories.
3. Electron can load an unvalidated `ELECTRON_RENDERER_URL` and opens external URLs without protocol/origin filtering.
4. SQL console results have no row cap, timeout, or cancellation, so a read-only query can still exhaust app/database resources.
5. Raw `computed` SQL in structured query compilation bypasses the app's "structured plans" model and is not run in a read-only transaction.
6. SQL history is persisted verbatim in the unencrypted settings store.
7. CI currently treats lint as successful while no lint tasks execute.

## Findings

### 1. Plaintext Persistence Path for SSL and SSH Secrets

- Severity: High
- Category: Security
- Affected files:
  - `apps/desktop/src/main/trpc/inputs.ts:36-50`, `apps/desktop/src/main/trpc/inputs.ts:53-65`
  - `packages/metadata-sqlite/src/connections.ts:115-116`, `packages/metadata-sqlite/src/connections.ts:202-224`
  - `packages/metadata-sqlite/src/migrations/0001_initial.sql:28-32`
  - `packages/engine/src/metadata.ts:173-193`

The connection input schema accepts `ssl.clientKey`, `sshTunnel.password`, `sshTunnel.privateKey`, and `sshTunnel.passphrase`. The SQLite connection store then serializes `ssl` and `sshTunnel` wholesale into `ssl_json` and `ssh_tunnel_json`. The migration comment says those secret fields "MUST be left out by the writer", but neither the tRPC input schema nor the store enforces that.

Practical impact: any renderer code that can invoke the bridge can create or update a connection profile containing these fields and cause private keys/passphrases to be written to the local metadata SQLite file in plaintext. The current UI only exposes password and SSL mode, but the IPC procedure is broader than the UI.

Recommended fix:

- Until richer secret storage exists, reject these fields at the IPC boundary and in `ConnectionsStore.validateProfileShape`.
- When Phase 4 adds SSH/client-cert support, introduce a `ConnectionSecrets` shape routed through `CredentialStore` or an encrypted secret store; store only non-secret metadata in SQLite.
- Add leak-guard tests for `ssl.clientKey`, `sshTunnel.password`, `sshTunnel.privateKey`, and `sshTunnel.passphrase`, not only `password`.

Example patch shape:

```ts
export const sslOptionsSchema = z.object({
  mode: z.enum(["disable", "prefer", "require", "verify-ca", "verify-full"]),
  caCert: z.string().optional(),
  clientCert: z.string().optional(),
}).strict();

export const sshTunnelOptionsSchema = z.never(); // until encrypted secret routing exists
```

### 2. Dependency Audit Finds Vulnerable Runtime and Tooling Packages

- Severity: High
- Category: Dependency
- Affected files:
  - `apps/desktop/package.json:55-57`
  - `pnpm-lock.yaml` entries for `electron@41.0.4`, `vite@5.4.21`, `vitest@2.1.9`, `tar@6.2.1`, `undici@5.29.0`, `esbuild@0.21.5`, `uuid@10.0.0`

`pnpm audit` reports 20 vulnerabilities: 2 critical, 8 high, 8 moderate, and 2 low. Notable advisories:

- Critical: `vitest <4.1.0`, GHSA-5xrq-8626-4rwp, arbitrary file read/execution when Vitest UI/API is listening.
- High: multiple `tar` advisories under `apps__desktop>@electron/rebuild>tar`, including GHSA-34x7-hfp2-rc4v.
- High/moderate: multiple `undici` advisories under `apps__desktop>testcontainers>undici`.
- Moderate/low: `electron 41.0.4` is below patched `41.1.0` for Electron advisories GHSA-f3pv-wv63-48x8, GHSA-8x5q-pvf5-64mp, and GHSA-f37v-82c4-4x64.
- Moderate: `vite <=6.4.1`, GHSA-4w7w-66w2-5vf9.
- Moderate: `esbuild <=0.24.2`, GHSA-67mh-4wv8-2f99.

Practical impact: most findings are development/build/test surface, but Electron is part of the desktop runtime and inherits Chromium/security-channel risk. Tooling advisories matter because the project runs Vite/Vitest/Electron rebuild tooling locally and in CI, and future contributors may expose dev servers or test UIs.

Recommended fix:

- Upgrade Electron to at least the patched 41.x release, preferably the current stable Electron line after compatibility testing.
- Upgrade Vitest to `>=4.1.0` or ensure Vitest UI/API is never exposed and add a tracked exception if upgrade is deferred.
- Upgrade Vite/electron-vite/esbuild path so esbuild is `>=0.25.0` and Vite is outside affected ranges.
- Upgrade `@electron/rebuild` or override `tar` to a patched version.
- Upgrade testcontainers or override transitive `undici`/`uuid` to patched versions.
- Add `pnpm audit --audit-level=high` to CI once the initial backlog is remediated.

### 3. Electron Navigation and External URL Handling Are Too Permissive

- Severity: Medium
- Category: Security
- Affected files:
  - `apps/desktop/src/main/index.ts:32-42`
  - `apps/desktop/src/renderer/index.html:7-25`

The main process loads `process.env["ELECTRON_RENDERER_URL"]` without checking `app.isPackaged` or constraining the URL to localhost. The same window has the privileged preload bridge. The `setWindowOpenHandler` sends every requested URL to `shell.openExternal(url)` without validating protocol or origin.

Practical impact: if a packaged app is launched with a malicious `ELECTRON_RENDERER_URL`, remote content could receive `window.perspectivesAPI.trpc` and invoke database operations that the bridge allows. Separately, arbitrary external protocols can be invoked if a renderer bug or future link renderer creates `window.open()` with `file:`, custom app protocols, or other unsafe schemes.

Recommended fix:

- Only use `ELECTRON_RENDERER_URL` when `!app.isPackaged`.
- Require dev URLs to be loopback HTTP origins.
- Add a `will-navigate` handler that denies unexpected top-level navigation.
- Allow only `http:` and `https:` in `openExternal`.
- Add a production Content Security Policy. The inline FOUC script currently makes a strict CSP harder; move it into a bundled script or use a hash.

Example:

```ts
function isAllowedExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

window.webContents.setWindowOpenHandler(({ url }) => {
  if (isAllowedExternalUrl(url)) void shell.openExternal(url);
  return { action: "deny" };
});
```

### 4. SQL Console Has No Result Cap, Timeout, or Cancellation

- Severity: Medium
- Category: Security
- Affected files:
  - `apps/desktop/src/main/trpc/inputs.ts:111-115`
  - `packages/engine/src/service.ts:241-249`
  - `packages/adapter-postgres/src/adapter.ts:161-184`
  - `apps/desktop/src/renderer/src/session/SqlConsoleView.tsx:103-116`, `apps/desktop/src/renderer/src/session/SqlConsoleView.tsx:249-258`

The SQL console limits SQL text to 1 MiB and enforces `BEGIN TRANSACTION READ ONLY`, which is good. It does not set `statement_timeout`, `idle_in_transaction_session_timeout`, a row cap, a byte cap, streaming, or cancellation. `client.query(sql)` collects the full result in memory, and the renderer passes all rows into `DataGrid`.

Practical impact: `SELECT * FROM huge_table`, `SELECT pg_sleep(...)`, large JSON aggregations, or cross joins can tie up a pool client, consume main/renderer memory, and make the app or target database sluggish. In future server/shared mode, the same pattern becomes an abuse vector.

Recommended fix:

- Add default `statement_timeout` and `idle_in_transaction_session_timeout` inside the read-only transaction.
- Introduce a SQL console max row count/byte count and mark results as `truncated`.
- Add cancellation support tied to the active backend PID.
- Consider requiring explicit confirmation for unbounded queries or auto-wrapping single SELECTs with a limit where safe.

Example:

```ts
await client.query("BEGIN TRANSACTION READ ONLY");
await client.query("SET LOCAL statement_timeout = '30000ms'");
await client.query("SET LOCAL idle_in_transaction_session_timeout = '35000ms'");
```

### 5. Raw `computed` SQL Bypasses Structured Query Safety

- Severity: Medium
- Category: Security
- Affected files:
  - `packages/dsl/src/schemas.ts:138-150`
  - `packages/adapter-postgres/src/compiler.ts:1-9`, `packages/adapter-postgres/src/compiler.ts:104-118`
  - `packages/adapter-postgres/src/adapter.ts:129-143`

The DSL allows `{ computed: string }`, and the Postgres compiler interpolates it directly into the SELECT list as `(${src.computed})`. The code comments call this an explicit trust boundary, but there is no current enforcement that only trusted/admin-authored perspectives can reach this path. Unlike SQL console execution, `runQuery` does not wrap structured reads in a read-only transaction.

Practical impact: a malicious or compromised persisted perspective can execute arbitrary SQL expressions/functions in the target database context. Even with Postgres permissions, this can expose data through functions, create heavy queries, or call volatile functions. The risk increases materially when AI-generated or shared/synced perspectives are implemented.

Recommended fix:

- Prefer a structured expression AST for computed columns.
- If raw computed SQL remains, add an explicit `trustedSql` marker only set by authorized writers and reject it in shared/AI-generated paths by default.
- Run all read queries through a read-only transaction, not only SQL console queries.
- Add tests that untrusted perspectives with computed SQL are rejected.

### 6. SQL History Is Persisted Verbatim in an Unencrypted Settings Store

- Severity: Medium
- Category: Security
- Affected files:
  - `apps/desktop/src/renderer/src/session/SqlConsoleView.tsx:89-100`, `apps/desktop/src/renderer/src/session/SqlConsoleView.tsx:115-117`
  - `apps/desktop/src/renderer/src/session/sql-history.ts:12-18`, `apps/desktop/src/renderer/src/session/sql-history.ts:35-49`
  - `packages/metadata-sqlite/src/settings.ts:60-62`

Successful SQL statements are saved into the generic SQLite settings KV. Each entry can be up to 1 MiB, with up to 50 retained. SQL history often contains customer identifiers, copied tokens, credentials in literals, or sensitive table names. The settings store is not encrypted.

Practical impact: local filesystem access to the metadata DB can reveal sensitive query history even though connection passwords are encrypted separately. This is common in database clients, but it should be an explicit product decision with controls.

Recommended fix:

- Add a setting to disable SQL history, defaulting to conservative behavior for production/shared contexts.
- Consider encrypting sensitive settings or using the same secret-store boundary for query history.
- Cap per-entry and total stored bytes more tightly.
- Add a "clear history" operation that deletes the underlying KV entry, not only clears in-memory state.

### 7. Connection Row and Credential Writes Are Not Atomic

- Severity: Medium
- Category: Code Quality
- Affected files:
  - `packages/metadata-sqlite/src/connections.ts:103-121`, `packages/metadata-sqlite/src/connections.ts:124-149`
  - `apps/desktop/src/main/credentials.ts:53-66`

`ConnectionsStore.create()` inserts the SQLite row before calling `credentials.set()`. `update()` updates SQLite before rewriting the credential. If `safeStorage.isEncryptionAvailable()` is false or `persist()` fails, the user-facing operation rejects but the metadata row may already be committed.

Practical impact: users can end up with connection profiles that appear saved but cannot connect because the encrypted credential was not saved. Updates can leave host/user metadata out of sync with the previous credential. This is not plaintext leakage, but it undermines the credential boundary and creates confusing recovery states.

Recommended fix:

- Save the credential first, then insert/update SQLite; if the SQLite write fails, delete the credential.
- For updates, preserve the old credential until the new row and new credential are both durable, or implement rollback/restore.
- Add tests with a credential store that throws on `set()` and assert no row is created/modified.

### 8. Lint and CI Quality Gates Are Currently Hollow

- Severity: Medium
- Category: Testing
- Affected files:
  - `package.json:14`
  - `turbo.json:13-15`
  - `.github/workflows/ci.yml:36-47`
  - workspace package manifests, for example `packages/dsl/package.json:10-12`

`pnpm lint` succeeds while Turbo runs zero lint tasks. CI has a lint job, but it only proves that no package exposes a lint script. Several packages also lack `typecheck` scripts, so root typecheck currently covers only packages that define the script.

Practical impact: the repository has a good ESLint config, but CI is not enforcing it. Rules such as no explicit `any` and no unused variables can silently regress in packages without scripts.

Recommended fix:

- Add `lint` scripts to every package that contains source/tests, or add a root lint command that directly runs ESLint over `apps` and `packages`.
- Add `typecheck` scripts to `@perspectives/dsl` and any package once source lands.
- Make CI fail if Turbo executes zero lint tasks.

### 9. Persisted Shapes Are Not All Backed by Canonical Zod Schemas

- Severity: Medium
- Category: Architecture
- Affected files:
  - `packages/engine/src/metadata.ts:141-193`, `packages/engine/src/audit.ts:22-46`
  - `apps/desktop/src/main/trpc/inputs.ts:36-68`
  - `packages/metadata-sqlite/src/connections.ts:162-224`
  - `packages/metadata-sqlite/src/audit.ts:44-64`, `packages/metadata-sqlite/src/audit.ts:90-128`
  - `packages/metadata-sqlite/src/settings.ts:47-62`

The project rule says Zod schemas in `packages/dsl` are the source of truth for every persisted shape. That is true for `PerspectiveDef`, `RelationDef`, and `DisplayConfig`, but not for `ConnectionProfile`, `AuditEvent`, or settings payloads. Runtime validation is ad hoc or duplicated: tRPC inputs define one schema, SQLite uses manual checks and casts, and audit/settings parse JSON without a canonical schema.

Practical impact: schema drift has already contributed to the secret-field issue above. As remote/server stores are added, parallel shapes increase the chance that sensitive fields or invalid records cross the wrong boundary.

Recommended fix:

- Move persisted metadata schemas into a canonical schema package, or expand `packages/dsl` to include metadata schemas if that remains the project rule.
- Derive `ConnectionProfile`, `ConnectionProfileSummary`, `AuditEvent`, and known settings payload types from Zod.
- Reuse the same schemas at tRPC, store read/write, and tests.

### 10. Keyset Pagination Does Not Handle Nullable Sort Keys Correctly

- Severity: Low
- Category: Code Quality
- Affected files:
  - `packages/adapter-postgres/src/compiler.ts:129-135`, `packages/adapter-postgres/src/compiler.ts:295-320`
  - `packages/adapter-postgres/src/pagination.ts:63-71`, `packages/adapter-postgres/src/pagination.ts:82-93`

`ORDER BY` supports `NULLS FIRST/LAST`, but the keyset predicate compiler only emits `col > $n`, `col < $n`, and equality branches. SQL comparisons with `NULL` evaluate to unknown, so nullable sort columns can skip rows or terminate pagination incorrectly.

Practical impact: table browsing can miss or duplicate rows when the user sorts by nullable columns. This is a correctness/maintainability bug rather than a direct security flaw.

Recommended fix:

- Either disallow keyset sorting by nullable columns until null-aware predicates are implemented, or compile null-aware branches that match the effective `NULLS FIRST/LAST` ordering.
- Add tests with nullable sorted values in both ascending and descending order.

### 11. Sensitive IPC Procedures Have No Per-Caller Authorization Context

- Severity: Low
- Category: Architecture
- Affected files:
  - `apps/desktop/src/main/trpc/router.ts:22-31`
  - `apps/desktop/src/main/trpc/ipc.ts:30-49`
  - `apps/desktop/src/preload/index.ts:20-25`

The current `Context` is intentionally empty, and the single bridge exposes every tRPC procedure to renderer code. In local single-user mode this is expected. It becomes risky if remote content, plugin content, iframes/webviews, or server-mode HTTP callers are introduced without adding caller identity and authorization checks.

Practical impact: any renderer compromise can invoke connection management, schema reads, table reads, settings writes, and raw read-only SQL against active connections. Today the renderer is local app code; this finding is about hardening the boundary before adding new content sources or shared mode.

Recommended fix:

- Keep the bridge narrow, but add procedure-level capability checks once more caller types exist.
- Do not expose this router over HTTP as-is.
- Add explicit comments/tests that the desktop bridge is local-trusted-renderer only.

### 12. Local Dev Database Uses Public Fixed Credentials

- Severity: Informational
- Category: Operational
- Affected files:
  - `docker-compose.dev.yml:7-11`, `docker-compose.dev.yml:25-28`

The dev Postgres service uses the documented `perspectives/perspectives` credential on host port 5433. This is acceptable for a local fixture, but it must never be reused for production or self-hostable server defaults.

Recommended fix:

- Keep it clearly documented as dev-only.
- For server/self-host mode, require user-supplied secrets and provide `.env.example` without real credentials.

## Positive Observations

- Electron window uses `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` in `apps/desktop/src/main/index.ts:22-27`.
- The preload exposes only `perspectivesAPI.trpc`, not raw `ipcRenderer`, in `apps/desktop/src/preload/index.ts:20-25`.
- Normal table query compilation quotes identifiers and binds filter/cursor values in `packages/adapter-postgres/src/compiler.ts`.
- Passwords are removed from connection summaries in `packages/engine/src/service.ts:314-320`.
- Password leak tests exist for the SQLite password path in `packages/metadata-sqlite/test/credentials.test.ts`.
- React rendering paths reviewed do not use `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or template execution sinks.

## Files and Modules Deserving Manual Follow-up

- `packages/metadata-sqlite/src/connections.ts`: secret-field handling and atomic writes.
- `apps/desktop/src/main/trpc/inputs.ts`: canonical schema drift and secret input acceptance.
- `apps/desktop/src/main/index.ts`: Electron navigation, external URL handling, CSP, packaged/dev split.
- `packages/adapter-postgres/src/adapter.ts`: read-only SQL resource limits, cancellation, read-only wrapping for all reads.
- `packages/adapter-postgres/src/compiler.ts`: raw computed SQL and nullable keyset predicates.
- `apps/desktop/src/renderer/src/session/SqlConsoleView.tsx`: query history sensitivity and result handling.
- `.github/workflows/ci.yml` and package manifests: lint, audit, secret scan, and build matrix hardening.
- `packages/metadata-remote` and `packages/metadata-postgres` when implemented: credential serialization tests and authz checks should be blocking requirements.

## Suggested Automated Tools

- Dependency scanning: `pnpm audit --audit-level=high`, Dependabot or Renovate for npm and GitHub Actions.
- Secret scanning: Gitleaks or TruffleHog in CI, plus GitHub secret scanning if available.
- SAST: Semgrep with TypeScript, Electron, React, and Node security rules.
- Electron hardening: Electronegativity or an equivalent Electron security checklist pass.
- Linting: ESLint actually wired into all workspaces; include `@typescript-eslint/no-unsafe-*` rules once practical.
- Type checking: `tsc --noEmit` scripts for all source-bearing packages.
- Tests: credential leak tests for every secret-bearing field, read-only SQL timeout/cap tests, keyset pagination null tests, Electron URL allowlist tests.
- Fuzzing/property tests: query compiler filter/value fuzzing to ensure values remain parameterized and identifiers are quoted.
- CI/CD: CodeQL for JavaScript/TypeScript, `actionlint`, pinned GitHub Action SHAs or Dependabot monitoring for actions.

## Remediation Roadmap

Immediate:

1. Reject or encrypted-route SSL/SSH secret fields; add leak-guard tests.
2. Upgrade Electron to a patched version and address `pnpm audit` high/critical findings.
3. Add real lint scripts and make CI fail on zero lint tasks.
4. Restrict Electron dev URL loading to non-packaged localhost and allowlist `openExternal` protocols.

Short-term:

1. Add SQL console statement timeouts, row/byte caps, and cancellation.
2. Decide whether SQL history is sensitive; add disable/clear/encrypt controls.
3. Make connection metadata and credential writes atomic with failure tests.
4. Move persisted metadata shapes to canonical Zod schemas and reuse them across tRPC/store/tests.
5. Add null-aware keyset pagination tests and implementation.

Longer-term:

1. Replace raw computed SQL strings with a structured expression model, or enforce explicit trusted-author boundaries.
2. Add a production CSP and Electron fuse/security checklist before distribution.
3. Design server/shared-mode authn/authz before exposing the tRPC router over HTTP.
4. Add audit logging for future mutations and permission-sensitive reads.
5. Add release signing/notarization, SBOM generation, and dependency provenance checks before public installers.

## External References Used

- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Electron releases/security backports: https://github.com/electron/electron/releases
- GitHub advisories surfaced by `pnpm audit`, including GHSA-5xrq-8626-4rwp, GHSA-34x7-hfp2-rc4v, GHSA-f3pv-wv63-48x8, GHSA-4w7w-66w2-5vf9, and GHSA-67mh-4wv8-2f99.
