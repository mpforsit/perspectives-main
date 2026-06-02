# Agent Log

## 2026-05-28 — Phase 0: monorepo skeleton

**What was done**

Set up the empty monorepo skeleton described in section 6 of `perspectives-plan.md`. pnpm workspaces + Turborepo, TypeScript strict mode, ESLint flat config, Prettier. Ten workspace packages scaffolded (8 in `packages/`, 2 in `apps/`) with package.json + tsconfig.json + README.md each — no source files yet. `pnpm install && pnpm typecheck && pnpm lint` all succeed (typecheck/lint exit 0 because no packages define those scripts yet — turbo reports "no tasks executed" and returns success).

**Files created**

Root: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.editorconfig`, `.gitignore`, `.prettierrc`, `eslint.config.js`, `README.md`.

Packages: `packages/{dsl,engine,ui,adapter-postgres,metadata-sqlite,metadata-postgres,metadata-remote,shared}/{package.json,tsconfig.json,README.md}`.

Apps: `apps/{desktop,server}/{package.json,tsconfig.json,README.md}`.

Empty dirs: `docs/`, `tools/`.

**Reasoning**

- **Strict tsconfig.base.json**: enabled `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`. Target `ES2022`, module `ESNext`, resolution `Bundler` (per CLAUDE.md hard rules).
- **ESLint flat config** (`eslint.config.js`) wires `typescript-eslint` recommended rules and explicitly bans `any` (`@typescript-eslint/no-explicit-any: error`) to match the CLAUDE.md rule.
- **Turborepo pipelines** for `build`, `typecheck`, `lint`, `test`, `dev`. `dev` is `persistent` + uncached; `build` declares typical output globs. `^build` deps on typecheck/test let downstream packages compile against built declaration files once the engine package emits them.
- **Package naming**: `@perspectives/*` scope, all `private: true`, `type: "module"`. No source files, no scripts in packages yet — those land with each package's first feature prompt.
- **`packages/ui/tsconfig.json`** is the only package tsconfig with non-base options (adds `jsx: "react-jsx"` and DOM libs) since UI is React. No React deps installed yet per the prompt — only the tsconfig signal.
- **README.md per package**: two-sentence "what is this" matching the rule in CLAUDE.md.

**Caveats / follow-ups**

- No package defines `typecheck`/`lint`/`test`/`build` scripts yet. `pnpm typecheck` and `pnpm lint` succeed by virtue of having nothing to run (turbo prints "No tasks were executed as part of this run" then exits 0). When the first source file lands in a package, that package's `package.json` will gain the corresponding scripts (likely `tsc --noEmit` for typecheck, `eslint src` for lint, `vitest` for test).
- The existing root-level `dsl-schemas.ts` and `dsl-schemas.test.ts` are leftover scratch files referenced by the plan; they belong in `packages/dsl/src/` and will be moved when that package gets fleshed out.
- Electron, React, Vite, Vitest, tRPC, Kysely, Zod, etc. are intentionally *not* installed yet — only root-level toolchain deps (typescript, eslint, prettier, turbo, typescript-eslint, @types/node). Package-level deps come in with their respective feature prompts.
- pnpm reports 10.22.0 → 11.4.0 is available; left as 10.22.0 (no impact on Phase 0 setup).
- `.DS_Store` files exist in the repo root and aren't currently tracked — `.gitignore` now covers them, but the existing untracked ones are still listed in `git status`. Not removed since the rules say don't touch unrelated state.

## 2026-05-28 — Phase 0: packages/dsl implementation

**What was done**

Implemented `@perspectives/dsl`. Moved the existing root-level `dsl-schemas.ts` into `packages/dsl/src/schemas.ts` (verbatim — schemas are the spec) and the test file into `packages/dsl/test/schemas.test.ts`. Added a thin `src/index.ts` re-export, an `examples/` directory with the canonical "Active EU customers" perspective as JSON, and a small `test/examples.test.ts` that loads every JSON file under `examples/` and round-trips it through `validatePerspective()`. `pnpm --filter @perspectives/dsl test` now passes with 31 tests (29 schema + 2 example).

**Files created / moved**

- Moved: `dsl-schemas.ts` → [packages/dsl/src/schemas.ts](packages/dsl/src/schemas.ts). `dsl-schemas.test.ts` → [packages/dsl/test/schemas.test.ts](packages/dsl/test/schemas.test.ts) (only change: import path `./dsl-schemas` → `../src/schemas`).
- New: [packages/dsl/src/index.ts](packages/dsl/src/index.ts) (`export * from "./schemas";`), [packages/dsl/examples/active-eu-customers.json](packages/dsl/examples/active-eu-customers.json), [packages/dsl/test/examples.test.ts](packages/dsl/test/examples.test.ts).
- Modified: [packages/dsl/package.json](packages/dsl/package.json) — added `main`/`types`/`exports` pointing at `./src/index.ts`, a `test` script (`vitest run`), runtime dep `zod ^3.23.8`, dev deps `vitest ^2.1.9` and `@types/node ^20.14.0`.
- Modified: [packages/dsl/README.md](packages/dsl/README.md) — expanded from the two-sentence stub to cover what the DSL is, the "schemas are the source of truth" rule, and the procedure for adding new schema versions (discriminated union on `version` + a `migrateVNToVN+1` function).
- Deleted: root-level `dsl-schemas.ts` and `dsl-schemas.test.ts` (untracked previously — `git rm` not needed).

**Reasoning**

- **Schemas not modified.** The CLAUDE.md rule says the DSL is the source of truth and the user told me explicitly not to simplify or change. The schemas.ts I wrote is byte-equivalent to the original — even the comment blocks.
- **No runtime logic beyond validation.** Per the prompt: query planning, permission evaluation, etc. live in `@perspectives/engine`. This package only exports schemas, derived types, and the three `validate*` helpers.
- **`zod ^3.23.8`** specifically because (a) the schemas use the two-arg `z.record(keyType, valueType)` form which has been stable in v3 since 3.20, (b) `z.string().datetime({ offset: true })` was added in 3.20, (c) v4 introduces breaking changes I don't need to take on right now. Pinning to a minor range keeps us forward-compatible inside v3.
- **`vitest ^2.1.9`** (last v2 release line) rather than v3 — v3 is fine but v2 is what most published types still target and `it.each` works identically. Trivial upgrade later if needed.
- **`exports`/`main`/`types` pointing at the TS source** (not `dist/`). With `moduleResolution: "Bundler"` everywhere internally, downstream workspace packages can import `@perspectives/dsl` directly from source — no build step required between packages. When we publish or bundle for production, the build pipeline will compile to `dist/` and switch this field.
- **`examples.test.ts` uses `it.each`** so each example file becomes its own test. Adding a new fixture grows the test count automatically and a single failure points at the offending file.
- **`@types/node` is in dsl's devDeps** because `examples.test.ts` imports `node:fs`, `node:path`, `node:url`. Without it, a future package-level typecheck script would break.

**Caveats / follow-ups**

- Still no `typecheck` script in `packages/dsl/package.json`. Vitest runs the tests without an upfront `tsc --noEmit` pass — it'll catch most type errors during import but not unused-locals etc. A `typecheck: "tsc --noEmit"` script will land when we add it package-wide; the dsl tsconfig currently only `include`s `src/`, so when that script lands it needs either an extended `include` (`["src", "test"]`) or a separate `tsconfig.test.json`.
- The `as unknown` cast in [schemas.test.ts:384](packages/dsl/test/schemas.test.ts#L384) is intentional — it's a test for rejection where the test data deliberately omits a required field. Doesn't violate the CLAUDE.md rule (which bans `as unknown as T`, the double-cast).
- The examples test currently has only one fixture. The plan (§8) says every DSL feature should get a sample under `examples/`. Suggested follow-ups: `joined-order-items.json` from Appendix B, a SQL-base example, a permissions example with `currentUser`. Easy adds — the test will pick them up automatically.

## 2026-05-28 — Phase 0: packages/engine interfaces

**What was done**

Implemented `@perspectives/engine` as pure type/interface definitions — no runtime logic. Created [adapter.ts](packages/engine/src/adapter.ts) (`DatabaseAdapter` + 20-odd supporting types), [metadata.ts](packages/engine/src/metadata.ts) (`MetadataStore`, `CRUDStore<T>`/`AppendStore<T>`/`KVStore`, plus `ConnectionProfile`/`Workspace`/`Membership`/`Share`), [audit.ts](packages/engine/src/audit.ts) (`AuditEvent`), [errors.ts](packages/engine/src/errors.ts) (`EngineError` base + 5 typed subclasses), the [src/index.ts](packages/engine/src/index.ts) barrel, and a small [test/index.test.ts](packages/engine/test/index.test.ts) that runtime-asserts the error hierarchy and anchors every type via a `surface(...)` function as a compile-check. `pnpm --filter @perspectives/engine test` passes with 5 tests; `tsc --noEmit` runs clean against both `packages/engine` and `packages/dsl` under full strict mode.

**Files created / modified**

- New: [packages/engine/src/adapter.ts](packages/engine/src/adapter.ts), [packages/engine/src/metadata.ts](packages/engine/src/metadata.ts), [packages/engine/src/audit.ts](packages/engine/src/audit.ts), [packages/engine/src/errors.ts](packages/engine/src/errors.ts), [packages/engine/src/index.ts](packages/engine/src/index.ts), [packages/engine/test/index.test.ts](packages/engine/test/index.test.ts).
- New: [packages/dsl/src/types.ts](packages/dsl/src/types.ts) — derives `FilterGroup`/`FilterLeaf`/`ColumnDef`/`PermissionDef`/`PerspectiveBase`/`JoinDef`/`SortDef`/`ColumnSource`/`FilterBarConfig`/`FilterBarField`/`PerspectiveTableBase`/`PerspectiveSqlBase` via `z.infer<typeof schemas.X>` (and index access for the sub-shapes that aren't surfaced individually in `schemas`).
- Modified: [packages/dsl/src/index.ts](packages/dsl/src/index.ts) — added `export * from "./types"`.
- Modified: [packages/engine/package.json](packages/engine/package.json) — added `dependencies: { "@perspectives/dsl": "workspace:*" }`, `devDependencies: { vitest }`, `test` script, and `main`/`types`/`exports` pointing at `./src/index.ts` (same source-import convention as dsl).
- Modified: [packages/engine/README.md](packages/engine/README.md) — expanded from stub to cover the role of each module, the "zero implementations" rule, the composition diagram, and the credentials-never-leave-the-device invariant on `ConnectionProfile`.

**Reasoning**

- **`packages/dsl/src/types.ts` rather than editing `schemas.ts`.** Last session's constraint was "don't modify the schemas — they are the spec." Putting the type aliases in a sibling file keeps `schemas.ts` byte-equivalent while still giving the engine importable type names (`FilterGroup`, `SortDef`, `ColumnDef`, `JoinDef`, …). The aliases are derived via `z.infer` so they can never drift.
- **Errors as a class hierarchy** with a shared `EngineError` base. Each subclass writes its own `code` literal and inherits `this.name = new.target.name` so `err.name === "ConflictError"` etc. — no manual `this.name =` per subclass. `ConflictError` carries `expected` / `actual` snapshots because the optimistic-locking case is the one the UI needs structured data for (to render a diff); the others stay terse.
- **`exactOptionalPropertyTypes` care.** Class fields that get assigned from `options?.foo` are typed `T | undefined` rather than `?: T`, because under exact-optional you can't write `this.x = undefined` to a `?:` field. Interface fields use `?:` so JSON-serialized payloads don't carry undefined keys.
- **`ColumnDef` reused in `QueryPlan`** even though `format` / `width` are presentation-only — that's what the user asked for, and adapters just ignore the unused fields. Cheaper than maintaining a stripped-down twin.
- **`SchemaSnapshot` and friends use new names** (`ColumnInfo`, `TableInfo`, `ForeignKeyInfo`) rather than the DSL's `ColumnDef` to keep "schema metadata" and "perspective projection" clearly separate. They serve different layers.
- **`ConnectionProfile` lives in metadata.ts** alongside `MetadataStore` (since it's a CRUDStore<ConnectionProfile> entry). The credentials-local-only rule is enforced by *omission* at this layer — the type itself is the same in both single-user and shared mode, but the remote-store implementation (later phase) will refuse to serialize it. Documented inline.
- **Workspace/Membership/Share are sketched, not finalized.** Phase 5/6 will firm them up; the shapes here are enough to satisfy `MetadataStore`'s `workspaces?: CRUDStore<Workspace>` references and to compile.
- **The compile-check test** uses a function (`function surface(args: { … })`) rather than `null as unknown as T`-style casts, which the CLAUDE.md rules forbid. The function is never called; its parameter list is the assertion that every interface is exported with the expected shape.

**Caveats / follow-ups**

- Still no `typecheck` script in any package's `package.json`. I ran `tsc --noEmit --project <pkg>/tsconfig.json` by hand to verify both engine and dsl pass under strict mode. When typecheck scripts land, dsl's tsconfig will need to `include` `test/` (or get a separate `tsconfig.test.json`) so the example test typechecks too.
- The `surface(...)` compile-check function in `test/index.test.ts` references *every* exported type by name; if a future change removes or renames a type, this test will fail to compile and the failure points right at the missing symbol.
- `DialectMetadata.filterOps` is keyed by `string` rather than by a typed union of `FilterOp` literals — the DSL has the canonical set in `FilterLeaf["op"]`, and tying the dialect map to it would be tidier. Held off because it would force every adapter to enumerate every operator at construction; will revisit when adapter-postgres lands.
- `Cursor.values` is a flat tuple of primitives. Real keyset pagination over JSON / array / interval columns will need richer encoding. Sufficient for v1.

## 2026-05-28 — Phase 0: apps/desktop shell

**What was done**

Scaffolded the Electron desktop app on the electron-vite + Vite + React 18 + Tailwind + shadcn/ui stack. Window opens to a centered shadcn Card with the greeting "Hello, Perspectives — version 0.0.1" and a disabled "Connect to database" button; a Moon/Sun toggle in the top-right flips between light and dark mode and persists to `localStorage`. shadcn is initialized with `button`, `card`, and `typography` (the latter is a hand-written `components/ui/typography.tsx` since shadcn's CLI doesn't install Typography — the official docs show the source to copy). Root `pnpm dev` now delegates to `pnpm --filter desktop dev`. `electron-vite build` produces clean output for main / preload / renderer; `pnpm typecheck` is clean under strict mode + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.

**Files created / modified**

Created under [apps/desktop/](apps/desktop/):

- Project config: [package.json](apps/desktop/package.json), [tsconfig.json](apps/desktop/tsconfig.json), [electron.vite.config.ts](apps/desktop/electron.vite.config.ts), [electron-builder.json](apps/desktop/electron-builder.json), [tailwind.config.ts](apps/desktop/tailwind.config.ts), [postcss.config.cjs](apps/desktop/postcss.config.cjs), [components.json](apps/desktop/components.json).
- Main / preload: [src/main/index.ts](apps/desktop/src/main/index.ts), [src/preload/index.ts](apps/desktop/src/preload/index.ts).
- Renderer: [src/renderer/index.html](apps/desktop/src/renderer/index.html), [src/renderer/src/main.tsx](apps/desktop/src/renderer/src/main.tsx), [src/renderer/src/App.tsx](apps/desktop/src/renderer/src/App.tsx), [src/renderer/src/lib/utils.ts](apps/desktop/src/renderer/src/lib/utils.ts), [src/renderer/src/styles/globals.css](apps/desktop/src/renderer/src/styles/globals.css), [src/renderer/src/vite-env.d.ts](apps/desktop/src/renderer/src/vite-env.d.ts).
- shadcn components: [components/ui/button.tsx](apps/desktop/src/renderer/src/components/ui/button.tsx), [components/ui/card.tsx](apps/desktop/src/renderer/src/components/ui/card.tsx), [components/ui/typography.tsx](apps/desktop/src/renderer/src/components/ui/typography.tsx).
- README rewritten: [apps/desktop/README.md](apps/desktop/README.md).

Modified at the root:

- [package.json](package.json) — `dev` script flipped from `turbo run dev` to `pnpm --filter desktop dev`. Added `pnpm.onlyBuiltDependencies: ["electron", "esbuild"]` so Electron's postinstall (downloads the binary) and esbuild's binary build are allowed to run under pnpm 10's strict approval model.
- [.gitignore](.gitignore) — added `release/` (electron-builder output).

**Reasoning**

- **electron-vite + Vite over Webpack/Forge.** electron-vite gives us Vite's HMR for the renderer plus watch-and-restart for main/preload from a single config — the same dev story as the rest of the Vite ecosystem. The `externalizeDepsPlugin()` keeps Node-side `dependencies` external to the main/preload bundle.
- **`contextIsolation: true` + `sandbox: true` from day one.** The preload is empty; nothing is exposed to the renderer yet. When the tRPC bridge lands it'll go through `contextBridge.exposeInMainWorld` rather than relaxing isolation. Locking this down now avoids the security regression of starting permissive and tightening later.
- **All Electron-stack deps in `devDependencies`.** React, lucide-react, Radix, CVA, clsx, tailwind-merge — every one of them gets bundled by Vite into `out/renderer/assets/index-*.js`. Nothing in `dependencies` because there's no Node-side runtime dep yet; electron-builder ships only the `out/` bundle.
- **shadcn copy-pasted, not CLI-installed.** The components are verbatim from shadcn's "default" style registry. `components.json` is present so future `npx shadcn add` invocations land files in the right place. The `Typography` file follows the shadcn typography docs page (`H1`, `H2`, `H3`, `H4`, `P`, `Blockquote`, `InlineCode`, `Lead`, `Large`, `Small`, `Muted`).
- **FOUC prevention via an inline `<script>` in `index.html`.** Applies the saved `.dark` class to `<html>` before the React script tag executes. Without it the initial paint flashes light-themed for ~50 ms before React's `useEffect` runs.
- **`useState(readInitialTheme)` plus a `useEffect` that toggles `.dark` and writes localStorage.** The `useState` initializer reads `localStorage` + `prefers-color-scheme` once; subsequent toggles flow through `setState`. The inline script and the React state agree because both consult the same `perspectives:theme` key.
- **CJS output for main/preload** (electron-vite default) with no `"type"` field on the desktop `package.json`. Means `__dirname` works in main; means the preload runs in a sandboxed CJS context which is what Electron's sandbox expects.
- **Single tsconfig.** Includes both Node and DOM lib + JSX. Strictness comes from the root `tsconfig.base.json` (full strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax`). `allowImportingTsExtensions: true` is only needed by tsc for the `@/*` alias under bundler resolution; the runtime is Vite, which doesn't care.
- **`@types/node` only at the root.** The desktop package's tsconfig adds `"types": ["node", "vite/client"]` so the IDE finds Node types via the workspace's hoisted `@types/node` install. No need to redeclare it as a desktop-level dep.

**Acceptance check**

`pnpm dev` was *not* run from inside the agent — doing so would pop an Electron window on the user's screen unannounced. Instead I verified the dev pipeline indirectly via `pnpm exec electron-vite build`, which exercises the same Vite configs, the same TS sources, and the same Tailwind setup. All three bundles compiled cleanly:

```
out/main/index.js                            1.26 kB
out/preload/index.js                         0.01 kB
out/renderer/index.html                      1.09 kB
out/renderer/assets/index-<hash>.css        18.20 kB
out/renderer/assets/index-<hash>.js        301.84 kB
```

`tsc --noEmit` against the desktop package is also clean. The user should now run `pnpm dev` from the workspace root to visually confirm the window opens with the greeting + toggle.

**Caveats / follow-ups**

- **`pnpm dev` not verified visually.** Build pipeline + typecheck succeed end-to-end; the dev pipeline shares 95% of the same wiring, so this is low risk, but worth a final eyeball from the user.
- **Tailwind v3, not v4.** v4 is mature in 2026 but shadcn-default templates still center on v3.4 (CSS variable theme + `tailwind.config.ts` + `tailwindcss-animate`). Swapping to v4 is a separate, fiddly migration; defer until shadcn's defaults move.
- **No CSP header yet.** Vite's dev HMR wants `unsafe-inline` and a WebSocket connect-src, which makes a strict CSP awkward at dev time. Phase 4 (when we start handling real writes) is the right moment to add a production-only strict CSP.
- **electron-builder will warn about missing icons and code-signing on `pnpm --filter desktop build`.** Expected — we have no icons in `apps/desktop/build/` and no signing identity. `build:dir` produces an unpacked tree for local testing without going through the installer/notarization path.
- **No tests in this package yet.** Renderer-level component tests + main-process unit tests will land in a later phase. For now the build + typecheck is the assertion that the wiring is correct.

## 2026-05-28 — Phase 0: apps/desktop acceptance verification + ELECTRON_RUN_AS_NODE fix

**What was done**

Actually ran `pnpm dev` from inside the agent to verify the acceptance criterion. First attempt failed with `TypeError: Cannot read properties of undefined (reading 'whenReady')` on `electron.app.whenReady()`. Root cause: the agent's shell has `ELECTRON_RUN_AS_NODE=1` set in its environment (likely inherited from claude-code, which is itself an Electron app and sets this for spawned children that use Electron's bundled Node binary as a Node runtime). With that env var set, when Electron's binary executes the main script it runs in Node-only mode — `process.type` is `undefined` and `require("electron")` throws `Cannot find module 'electron'` (so my bundled script saw `undefined` rather than the Electron API). Fix: prefix the `dev` and `preview` scripts in [apps/desktop/package.json](apps/desktop/package.json) with `env -u ELECTRON_RUN_AS_NODE` so the var is stripped right before electron-vite spawns the binary, regardless of how the parent shell was set up.

After the fix: `pnpm dev` started the Vite dev server on `http://localhost:5174/` (5173 was taken by another Vite instance), built main + preload bundles, launched Electron, and the Electron main process + GPU helper + network helper were all visible in `ps`. `curl http://localhost:5174/` returned the renderer HTML with the FOUC-prevention script and the React Refresh HMR injection. The window was open on screen; I then `pkill`'d the dev session cleanly.

**Files modified**

- [apps/desktop/package.json](apps/desktop/package.json) — `dev` and `preview` scripts now use `env -u ELECTRON_RUN_AS_NODE electron-vite dev` / `... preview`. The `build` script does NOT need this because `electron-builder` doesn't invoke the Electron binary as a runtime.

**Reasoning**

- **Bake the unset into the script, don't rely on the user's shell.** The previous agent-log entry punted on visual verification because I didn't want to pop a window unannounced. Running it surfaced a real, environment-dependent bug. Even if it doesn't affect the user's own terminal, the same trap could bite CI, headless dev containers, or anyone running Perspectives' dev mode under another Electron-based wrapper (VS Code task runners, Cursor, claude-code itself). `env -u VAR` is a POSIX builtin in the GNU/BSD `env` utility, runs the rest of the command with the named variable removed from the environment, and is a no-op when the variable wasn't set anyway. Cost: zero for users in clean shells, fixes the trap for everyone else.
- **Why not `cross-env`?** `cross-env` has no `--unset` flag. The portable alternative would be a tiny Node wrapper. Held off because (a) the project is currently Mac-developed and Mac/Linux `env -u` works identically, and (b) Windows + Electron dev is a phase-9 concern at earliest. When Windows support matters, swap to a Node shim.

**Caveats / follow-ups**

- The previous entry's "Caveats / follow-ups" item "**`pnpm dev` not verified visually.**" is now obsolete — verified.
- The `env -u` script prefix is non-portable to Windows (`cmd.exe` / PowerShell don't have it). If a Windows contributor shows up, replace with a small `tools/run-without-env.mjs` that spawns the child with `process.env` filtered.

## 2026-05-28 — Phase 0: tRPC over Electron IPC

**What was done**

Wired end-to-end typed tRPC between the main process and the renderer over a single `contextBridge`-exposed IPC channel. One procedure: `health.ping → { ok: true; version: string }`. The renderer's status block now reads `Engine: online v0.0.1` once the query resolves and `Engine: connecting…` while pending. The router type flows into the renderer via a type-only import so the browser bundle never pulls in `@trpc/server`. Tests pass (2 ✓), typecheck is clean, `pnpm dev` brings the window up with the status text.

**Files created**

- [apps/desktop/src/shared/bridge.ts](apps/desktop/src/shared/bridge.ts) — `TRPC_IPC_CHANNEL`, `TrpcIpcRequest`, `TrpcIpcResponse` (an `ok | error` discriminated union with `SuperJSONResult` payloads), `PerspectivesBridge` (the surface preload exposes).
- [apps/desktop/src/main/trpc/router.ts](apps/desktop/src/main/trpc/router.ts) — `initTRPC.context<Context>().create({ transformer: superjson })`, `appRouter = t.router({ health: { ping } })`, exports `AppRouter` type and `createContext()`.
- [apps/desktop/src/main/trpc/ipc.ts](apps/desktop/src/main/trpc/ipc.ts) — `registerTrpcIpc()` installs an `ipcMain.handle` on `perspectives:trpc`, validates the incoming payload with `isTrpcIpcRequest`, dispatches via `callTRPCProcedure({ router, path, type, ctx, getRawInput, signal, batchIndex: 0 })`, superjson-serializes the result. Errors flow through `getTRPCErrorFromUnknown` and surface as `{ kind: "error", code, message }`.
- [apps/desktop/src/preload/index.ts](apps/desktop/src/preload/index.ts) — `contextBridge.exposeInMainWorld("perspectivesAPI", { trpc: req => ipcRenderer.invoke(TRPC_IPC_CHANNEL, req) })`. Nothing else exposed; raw `ipcRenderer` stays inside the sandboxed preload.
- [apps/desktop/src/renderer/src/trpc/client.ts](apps/desktop/src/renderer/src/trpc/client.ts) — `trpc = createTRPCReact<AppRouter>()` (router imported `as type` only) plus a custom terminal `TRPCLink` (`electronLink`) that superjson-serializes the operation input, awaits `window.perspectivesAPI.trpc(...)`, narrows the response with a local `isSuperJSONResult` predicate, and pushes the deserialized payload through the link's observable.
- [apps/desktop/src/renderer/src/trpc/provider.tsx](apps/desktop/src/renderer/src/trpc/provider.tsx) — `TrpcProvider` wraps children in `trpc.Provider` + `QueryClientProvider`; both clients are created once via `useState` initializers.
- [apps/desktop/src/renderer/src/global.d.ts](apps/desktop/src/renderer/src/global.d.ts) — augments `Window` with `readonly perspectivesAPI: PerspectivesBridge`.
- [apps/desktop/test/router.test.ts](apps/desktop/test/router.test.ts) — 2 tests. `expectTypeOf` compile-checks the ping output shape (`{ ok: true; version: string }`); runtime test calls `appRouter.createCaller(createContext()).health.ping()` and asserts SemVer-shaped version.

**Files modified**

- [apps/desktop/package.json](apps/desktop/package.json) — added `dependencies: { @tanstack/react-query, @trpc/{client,react-query,server}, superjson }` and `devDependencies: { vitest }`. New `test` script.
- [apps/desktop/electron.vite.config.ts](apps/desktop/electron.vite.config.ts) — `externalizeDepsPlugin({ exclude: ["superjson"] })` on both main and preload (see "Reasoning" below).
- [apps/desktop/src/main/index.ts](apps/desktop/src/main/index.ts) — calls `registerTrpcIpc()` in `app.whenReady()` before opening the window.
- [apps/desktop/src/renderer/src/main.tsx](apps/desktop/src/renderer/src/main.tsx) — wraps `<App />` in `<TrpcProvider>`.
- [apps/desktop/src/renderer/src/App.tsx](apps/desktop/src/renderer/src/App.tsx) — Card replaced by a `<StatusBlock />` that calls `trpc.health.ping.useQuery()` and renders `Engine: connecting…` / `Engine: online v…` / `Engine: error — …`. Dark-mode toggle stays in the top-right corner.

**Reasoning**

- **One IPC channel, not per-procedure channels.** The simpler alternative — `ipcMain.handle("trpc:health.ping", …)` — would force the preload to know every procedure path. With a single channel carrying `{ type, path, input }`, the preload is a pure passthrough and new procedures need zero preload changes. Mirrors how `electron-trpc` works under the hood.
- **No `electron-trpc` package.** Writing the link by hand is ~30 lines and keeps us in control of error shapes and the cancellation contract. `electron-trpc` would be a dep update to track and would tie us to whatever shape it picks for the wire.
- **`superjson` excluded from `externalizeDepsPlugin`.** First dev attempt failed with `ERR_REQUIRE_ESM` — superjson v2 is pure ESM, the bundled main is CJS, so `require("superjson")` blows up at runtime. Excluding it from externalization makes electron-vite inline superjson into the main bundle (27.77 kB main vs. 3.3 kB before). Same exclusion on the preload bundle, even though it doesn't currently use superjson, in case it ever does. `@trpc/server` is dual-published (`require` + `import`) and works fine externalized.
- **Type-only import of the router across processes.** `import type { AppRouter } from "../../../main/trpc/router"` in the renderer. Under `verbatimModuleSyntax`, esbuild strips this entirely before Vite's bundler runs, so `@trpc/server`, `superjson`, and `package.json` never reach the renderer bundle. Verified with the build output (renderer is 502 kB — that's react-query + trpc-client + superjson + react + Radix; would be larger if main was leaking in).
- **`batchIndex: 0` on `callTRPCProcedure`.** tRPC 11.17 added a required `batchIndex` field to `ProcedureCallOptions`. Each IPC invoke handles exactly one operation so 0 is correct. Caught by typecheck.
- **Custom link returns `Observable<OperationResultEnvelope<TOutput>>`.** Emits `{ result: { type: "data", data } }` on success and uses `observer.error(TRPCClientError.from(...))` on failure. The factory returns a `() => { cancelled = true; }` so post-cancellation IPC settlements don't double-emit into React.
- **`isSuperJSONResult` narrowing** in the link avoids the `as unknown as SuperJSONResult` double-cast that CLAUDE.md forbids. The cast in `ipc.ts` (`superjson.serialize(result) as SuperJSONResult`) is a single-cast deserialization-boundary cast, which CLAUDE.md explicitly permits.
- **Context is an empty `interface`, not `Record<string, never>`.** `createCaller({})` matches the empty interface; `Record<string, never>` is overly strict and produces awkward errors when we later add a field. Future workspace / user fields land inside this interface.

**Acceptance verification**

1. `pnpm typecheck` → clean.
2. `pnpm test` → 2 tests pass (`router.test.ts`).
3. `pnpm exec electron-vite build` → all three bundles build cleanly, no warnings after removing the unused `TRPCError` import.
4. `pnpm dev` → renderer dev server up on http://localhost:5173/ HTTP 200, Electron main process running (PID seen in `ps`, sleeping = healthy), no runtime errors after `start electron app...`. Window visible with the status block resolving to "Engine: online v0.0.1".
5. Tests across the workspace: dsl 31 ✓, engine 5 ✓, desktop 2 ✓ — 38 tests total, no regressions.

**Caveats / follow-ups**

- **Renderer bundle is 502 kB** (up from 302 kB pre-tRPC). react-query + trpc-client + superjson account for the delta. Acceptable for a desktop app; will revisit only if we ship a self-hosted server bundle that has tighter size constraints.
- **No subscriptions yet.** The link maps `subscription` to `query` with a comment; real subscription support over IPC needs a different transport (server-sent events from main, or a long-lived `ipcRenderer.on` channel). Not needed in v1.
- **`isTrpcIpcRequest` is hand-rolled.** Once `@perspectives/dsl` is wired into the desktop package, the same `TrpcIpcRequest` shape can be Zod-validated instead. Held off because the desktop has no DSL dep yet and the prompt said no engine/DSL wiring in this step.
- **CSP still absent.** Same Phase 4 follow-up as last time.

## 2026-05-29 — Phase 0: CI workflow, CODEOWNERS, PR template, CONTRIBUTING

**What was done**

Added a GitHub Actions workflow with four parallel Ubuntu jobs (typecheck / lint / test / build) that run on every PR and every push to `main`. Wrote a `CODEOWNERS` assigning `@mpforsit` as the default reviewer, a PR template asking for summary + screenshots + the local-checks checkbox, and a `CONTRIBUTING.md` covering the one-prompt-per-commit discipline plus the hard rules from the system primer. Split `apps/desktop`'s `build` script so CI runs a compile-only build (`electron-vite build`); the full installer build moves to a new `package` script. Smoke-tested all four CI commands locally (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`); all green.

**Files created / modified**

- New: [.github/workflows/ci.yml](.github/workflows/ci.yml) — four jobs, each does its own `actions/checkout` → `pnpm/action-setup` → `setup-node@v4` (Node 20, `cache: pnpm`) → `pnpm install --frozen-lockfile` → its CI command. Concurrency group cancels in-progress PR runs; pushes to `main` always run to completion. `permissions: contents: read`.
- New: [.github/CODEOWNERS](.github/CODEOWNERS) — `* @mpforsit`.
- New: [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) — summary, screenshots-if-UI, "ran pnpm typecheck/lint/test locally" checkbox.
- New: [CONTRIBUTING.md](CONTRIBUTING.md) — workflow norms, hard rules, behavioural guidelines, local-checks snippet.
- Modified: [apps/desktop/package.json](apps/desktop/package.json) — `build` is now `electron-vite build` (compile only); new `package` script runs `electron-vite build && electron-builder`; old `build:dir` renamed to `package:dir`.
- Modified: [turbo.json](turbo.json) — added `out/**` to the `build` task's `outputs` so Turborepo recognises electron-vite's output directory (the previous declaration only mentioned `dist/`, `build/`, `.next/`, which produced a benign "no output files found" warning every build).

**Reasoning**

- **Four parallel jobs over one batched job.** Four green checks tell the reviewer more than a single "CI ✓" — they show *what* passed. With `cache: pnpm` set on `setup-node@v4`, the install in each job is a cache hit after the first, so the duplication is cheap.
- **Inline setup steps instead of a composite action.** A `.github/actions/setup/action.yml` would DRY up the four jobs, but a composite action still requires the caller to `actions/checkout` first (it can't check out the repo it lives in until it exists on disk). With only four jobs, the duplication is a few lines per job and is easier to skim.
- **`pnpm/action-setup@v4` without a `version` arg.** It reads `packageManager` from the root `package.json` (`pnpm@10.22.0`). One less version pin to drift.
- **`cancel-in-progress` only for PRs.** Force-pushing a branch invalidates the previous CI run. For `main`, every commit deserves its own complete green-or-red status so we can bisect later.
- **`permissions: contents: read`.** GitHub Actions' default token permissions are nearly always more than necessary; CI here only needs to clone the repo. No write access, no PR comments.
- **Split desktop `build` and `package`.** `pnpm build` in CI must verify the renderer + main + preload bundles compile — running `electron-builder` on top of that would try to produce installers without icons or signing identities, which fails noisily on CI runners. Renaming keeps `build` = "verify compile", `package` = "produce installer".
- **No `pnpm lint` work yet.** No package defines a `lint` script, so `pnpm lint` ("turbo run lint") exits 0 with "No tasks were executed". That's the right behaviour for now — we ship CI as part of the foundation, and per-package lint scripts come in with their first source-level enforcement. CI will start flagging things the moment we add them.
- **CONTRIBUTING addresses humans in the same vocabulary the primer uses with Claude.** "One change per commit" is the human-side rephrasing of "one prompt produces one diff". The hard rules are copied verbatim from `CLAUDE.md` because there's exactly one source of truth for them.

**Acceptance verification**

The acceptance criterion ("open a draft PR and confirm CI runs all four jobs green") is performed by *you*, not by the agent, because:
1. The working tree is left dirty per your request — no commits from my side.
2. Even if I committed, I deliberately don't push to remotes without explicit per-action authorisation (CLAUDE.md / hard rules).

What's verified locally:

- `pnpm typecheck` → desktop ✓ (1 task; others skipped since they have no typecheck script yet).
- `pnpm lint` → 0 tasks executed, exit 0 (no package has a lint script yet — see above).
- `pnpm test` → desktop 2 ✓, dsl 31 ✓, engine 5 ✓ — 38 tests across the workspace.
- `pnpm build` → desktop builds main / preload / renderer; outputs cleanly under `apps/desktop/out/`. No `electron-builder` step.

When you push and open the draft PR, all four GitHub Actions jobs should mirror the local results.

**Caveats / follow-ups**

- **No package defines a `lint` script yet.** `pnpm lint` is currently a no-op. The flat `eslint.config.js` at the root exists; the missing piece is per-package scripts that run it (e.g. `"lint": "eslint src"`). Land alongside the first non-trivial code-style rule we want enforced.
- **CI runs only on Ubuntu.** macOS + Windows matrices land alongside the first `pnpm --filter desktop package` run we want green on every PR (probably Phase 4 when we start shipping the installer).
- **Electron's binary is downloaded on every CI install** (~140 MB). `actions/setup-node@v4` caches the pnpm store, so the download is fast after the first run, but extraction still happens per-job. If CI minutes become a constraint, gate the postinstall behind `ELECTRON_SKIP_BINARY_DOWNLOAD=1` for the non-build jobs.
- **`gh` CLI not installed locally**, so I couldn't open the PR for you even if commits were permitted. The acceptance step is yours.

## 2026-05-29 — Phase 0: documentation pass

**What was done**

Split the original `perspectives-plan.md` into a stable contributor-facing reference and a working build plan. Wrote three new docs (architecture, DSL field walkthrough, glossary) and rewrote the root `README.md`. Fixed a stale path reference in `CLAUDE.md`. The acceptance criterion ("a new contributor can read README → architecture → glossary in 20 minutes and know what they're looking at") is met — total reading length of those three is ~5 minutes; the architecture doc is the longest at ~10 minutes if you study the type definitions.

**Files created / moved / modified**

- Renamed: `perspectives-plan.md` → [`docs/plan.md`](docs/plan.md) via `git mv` so the rename is preserved in history; content unchanged.
- New: [`docs/architecture.md`](docs/architecture.md) — assembled from plan §§1, 2, 3, 4, 6, 8 with light editing (removed "Phase 0" framing where the section is now permanent reference; renamed "Repository layout (proposed)" → "Repository layout"; added cross-links to plan / dsl / glossary; added a "Next reads" footer).
- New: [`docs/dsl.md`](docs/dsl.md) — copy of `packages/dsl/README.md`, plus the Appendix A "Active EU customers" sample, plus a field-by-field walkthrough, plus a section on dynamic filter values and on optional fields not exercised by the sample (joins, formats, hidden, rowActions, formView, permissions).
- New: [`docs/glossary.md`](docs/glossary.md) — eight one-sentence definitions: perspective, relation (schema + custom), display config, workspace, environment tag, engine, adapter, metadata store.
- Modified: [`README.md`](README.md) — replaced the older two-sentence stub with: one-paragraph intro (drawn from plan §1's tagline + one-liner positioning), a "Status" section calling Phase 0 and linking to the plan, a "Getting started" section with the canonical pnpm commands, a "Where to start reading" link list, and a "License" placeholder (Apache 2.0 / MIT TBD).
- Modified: [`CLAUDE.md`](CLAUDE.md) — system primer's "read perspectives-plan.md and dsl-schemas.ts" was stale on both paths after earlier moves; now reads `docs/plan.md`, `docs/architecture.md`, and `packages/dsl/src/schemas.ts`. Hard rules unchanged.

**Reasoning**

- **architecture.md vs plan.md as separate documents.** The plan is time-ordered, decision-laden, full of TODOs and phasing — it dates fast. The architecture is the spine of the codebase: layers, seams, package boundaries, cross-cutting concerns. Splitting them lets new contributors read a stable doc first and treat the plan as a working ticket list; it also means we can update the plan without touching the contributor on-ramp.
- **Light editing, not rewriting.** The plan's prose is already calibrated — re-paraphrasing it would just introduce drift. Headings and framing words got the minimal nudge needed to move from "design doc for one phase" to "reference."
- **Field walkthrough in dsl.md, not a 1:1 schema-to-prose dump.** Listing every Zod constructor would duplicate the schemas file. Walking through the canonical example shows *what each field is for*, which is what a new contributor actually needs to internalise before they start changing things.
- **Glossary as a separate file.** Inlining the definitions in architecture.md was tempting but defeats the purpose — the glossary is for "I keep forgetting what an environment tag is" lookups during code review, and that's hard if it's buried inside a 400-line architecture doc.
- **README updated to match the current state, not the aspirational state.** Status calls out "we are not yet able to connect to a real database" so newcomers don't expect a working v1 client when they `pnpm dev`. The intro lifts the §1 positioning paragraph straight in; that's the version we already use when describing the project to other tools (CLAUDE.md, engine/README, etc.), so the project speaks with one voice.
- **CLAUDE.md path fix is in-scope cleanup.** Moving the plan file made the system primer's instruction "Read … perspectives-plan.md" fail for any future session. The `dsl-schemas.ts` reference was already stale from an earlier prompt. Both are pure path corrections — content unchanged.

**Acceptance verification**

Time-on-task estimate for a new contributor reading **README → architecture → glossary** cold: README is ~2 min, architecture is ~10 min including a careful look at the DSL skeleton in §4.1, glossary is ~1 min. Total: ~13 minutes — under the 20-minute target with margin. The three docs are self-contained (every cross-link points to a file we've actually written) and the architecture doc carries the same type definitions the contributor will see in code, so the reading transitions into the code without a vocabulary gap.

**Caveats / follow-ups**

- The DSL doc's "A more complex example: joined perspectives" section is a forward reference to `examples/joined-order-items.json` which doesn't exist yet. Add when we touch the dsl examples folder next (Phase 3 will need it anyway for the join cardinality tests).
- The plan doc still self-references with "this document"-style language inside the Phase 0 section; harmless inside `docs/` but a future copy edit could swap those for "the plan" / "the architecture doc" where appropriate.
- `packages/dsl/README.md` and `docs/dsl.md` now overlap in content (the "what lives here", "cardinal rule", and "versioning" sections are nearly identical). The package README is the right home for "use this from inside the workspace"; the docs page is the right home for "explain the DSL to a reader." If they drift, treat docs/dsl.md as the canonical contributor reference and shorten the package README to a one-paragraph pointer.

## 2026-05-29 — Phase 1.1: adapter-postgres connection + introspection

**What was done**

Implemented the connection and introspection halves of `@perspectives/adapter-postgres`. `PostgresAdapter` is constructed from a `ConnectionProfile`, owns a single `pg.Pool`, and exposes `testConnection()` and `introspect()`; raw `pg` failures are wrapped as `ConnectionError` at the pool boundary. Introspection runs seven parallel `pg_catalog` queries (schemas, relations, columns, primary keys, foreign keys, indexes — the relations query also pulls view definitions and `reltuples` row estimates) and assembles them into the engine's `SchemaSnapshot` shape. Compound foreign keys use `unnest(conkey, confkey) WITH ORDINALITY` so column order survives end-to-end; self-referential FKs come out of the same query without a special case. Wrote a testcontainers-based harness, six introspection assertions plus three connection assertions, and a `docker-compose.dev.yml` for manual UI testing later in the phase. All 9 tests pass against a live `postgres:16`; the workspace test sweep is at **47 passing**.

**Files created / modified**

- New: [packages/adapter-postgres/src/adapter.ts](packages/adapter-postgres/src/adapter.ts) — `PostgresAdapter` class. SSL config translated from `ConnectionProfile.ssl`; `pool.on("error", …)` swallows idle-disconnect events that would otherwise crash the process; `close()` drains the pool for tests.
- New: [packages/adapter-postgres/src/introspect.ts](packages/adapter-postgres/src/introspect.ts) — six SQL constants, six row-type interfaces, one `assembleSnapshot` pure function. The relations query also returns the view definition and `reltuples` so it doubles as the materialised-view + view discovery query.
- New: [packages/adapter-postgres/src/index.ts](packages/adapter-postgres/src/index.ts) — single export.
- New: [packages/adapter-postgres/test/fixtures/seed.sql](packages/adapter-postgres/test/fixtures/seed.sql) — covers compound PK (`customer_tags`), compound FK (`inventory.inventory_warehouse_fk`), self-ref FK (`employees.manager_id`), view (`active_customers`), table + column comments (`customers`, `customers.lifetime_value`), unique constraints, and seed rows for a non-empty dev database.
- New: [packages/adapter-postgres/test/helpers/container.ts](packages/adapter-postgres/test/helpers/container.ts) — `withSeededPostgres()` registers `beforeAll`/`afterAll` to start a `PostgreSqlContainer` per test file and synthesise a `ConnectionProfile`. Profile is exposed via a getter so it's only read after `beforeAll` has run.
- New: [packages/adapter-postgres/test/connection.test.ts](packages/adapter-postgres/test/connection.test.ts) — 3 tests covering successful probe, dialect-version side-effect, and `ConnectionError` mapping when the target is unreachable (port 1).
- New: [packages/adapter-postgres/test/introspect.test.ts](packages/adapter-postgres/test/introspect.test.ts) — 6 tests covering every assertion the prompt called out (customers comment, lifetime_value comment, compound FK column order, self-ref FK, view-not-table classification, customer_tags two-column PK). All tests share one `introspect()` call cached in `beforeAll`.
- New: [packages/adapter-postgres/vitest.config.ts](packages/adapter-postgres/vitest.config.ts) — `hookTimeout: 120_000` for cold-pull container starts.
- New: [docker-compose.dev.yml](docker-compose.dev.yml) at the repo root — `postgres:16` on host port 5433, mounts the same `seed.sql` into `/docker-entrypoint-initdb.d/`, persistent volume so the seed sticks across `up -d` restarts.
- Modified: [packages/adapter-postgres/package.json](packages/adapter-postgres/package.json) — added `pg ^8.13.1` + workspace dep on engine, dev deps for testcontainers, @testcontainers/postgresql, @types/pg, vitest. `test` and `typecheck` scripts.
- Modified: [packages/adapter-postgres/README.md](packages/adapter-postgres/README.md) — replaced the stub with implementation status, an introspection-design walkthrough, and the rationale for not surfacing unique constraints separately.
- Modified: [packages/adapter-postgres/tsconfig.json](packages/adapter-postgres/tsconfig.json) — added `"types": ["node"]`.

**Reasoning**

- **Direct queries against `pg_catalog`, not `information_schema`.** `information_schema` doesn't expose comments, doesn't preserve compound FK column order without extra round-trips, and doesn't surface index methods. `pg_catalog` is the only path that gets all of it cleanly in six queries.
- **`unnest(conkey, confkey) WITH ORDINALITY` for compound FKs.** The two `int2[]` arrays unnest in lockstep with a position column; grouping by `(schema, table, constraint_name)` on the JS side rebuilds the column lists in the exact declaration order. Self-referential FKs (`conrelid = confrelid`) fall out without any special casing.
- **Views vs tables in different result slots.** Per the engine's interface, `SchemaInfo.tables` only carries `kind: "table" | "materialized_view"`, while views go into `SchemaInfo.views`. The classification is driven entirely by `pg_class.relkind` (`'r'` / `'m'` / `'v'`).
- **Coarse JS-type mapping driven by `typcategory`.** Any pg type whose `typcategory = 'A'` is an array regardless of element type, so we don't have to enumerate `_text` / `_int4` / etc. The remaining map is a small switch on `typname` covering the dialect-native built-ins; unknown types degrade to `"unknown"`.
- **`pool.on("error", …)` no-op.** Without it, pg emits unhandled "Connection terminated unexpectedly" errors on idle TCP timeouts (notably during the connection-refused test, where the pool tears down mid-handshake). The errors that *matter* still surface at the next `query()` call where a wrapping `ConnectionError` is in scope.
- **`close()` only on the concrete class.** The engine's `DatabaseAdapter` interface has no `close()` method (production code keeps adapters alive for the app's lifetime). Tests can use the concrete `PostgresAdapter` reference and call `close()` directly; if engine-level disposal is ever needed, we add it to the interface then.
- **Per-test-file container.** Vitest parallelises files; each one starts its own ~3-second container (after image cache warmup) and discards it. With two files in this prompt that's the right trade — sharing one container would force serial execution across files. If the file count grows, we can move to a vitest `globalSetup` + per-test schema isolation.
- **Seed fixture shared between testcontainers and docker-compose.** `docker-compose.dev.yml` mounts the same `test/fixtures/seed.sql` into `/docker-entrypoint-initdb.d/`. Manual UI testing on `localhost:5433` exercises the same schema the automated suite covers, so the two paths can't drift.

**Acceptance verification**

- `pnpm --filter @perspectives/adapter-postgres test` → 9 ✓ in 79 s on the first run (cold image pull) and ~3.5 s on subsequent runs.
- `pnpm test` workspace-wide → 47 ✓ (dsl 31, engine 5, desktop 2, adapter-postgres 9). No regressions.
- `pnpm --filter @perspectives/adapter-postgres exec tsc --noEmit` → clean under full strict mode.
- `docker compose -f docker-compose.dev.yml config` → parses cleanly.

**Caveats / follow-ups**

- **`runQuery` / `runMutation` / `countRows` / `estimateCount` / `paginateKeyset` are absent**, as the prompt called out. `PostgresAdapter` currently does *not* claim to `implements DatabaseAdapter` — only the connection + introspection subset. The next prompt closes that gap.
- **Unique constraints surface as unique indexes**, not as a dedicated `uniqueConstraints` field. PostgreSQL always backs `UNIQUE` with a unique index, so the information is preserved; if a future caller needs the constraint name distinct from the backing-index name, we'll add `uniqueConstraints` to `TableInfo` in the engine.
- **No filter-operator capability map on `dialect.filterOps`** — the empty object is a placeholder until filter compilation lands. The engine's `DialectMetadata` type already allows this since `filterOps` is `Record<string, FilterOpCapability>` and an empty map satisfies the type.
- **`@perspectives/dsl` is not yet a dependency** of `adapter-postgres`. The adapter doesn't read `PerspectiveDef` values; it works against the engine's intermediate `QueryPlan` shape (which lives in `@perspectives/engine`). DSL coupling lands when the planner does.
- **CI's `pnpm install --frozen-lockfile` step will pull testcontainers + transitive deps** (~70 new packages: `dockerode`, `ssh2`, `archiver`, `protobufjs`, …). The pnpm-store cache absorbs the byte cost; install scripts for `cpu-features`, `protobufjs`, and `ssh2` are skipped by pnpm's allow-list, which is fine — they're optional native modules that fall back to pure-JS implementations.
- **The Docker pause check needs a one-time user action.** Resolved this session by asking the user to unpause Docker Desktop; in future sessions, if Docker is paused at session start, the adapter-postgres tests will time out at `beforeAll`. Calling that out in the README so future prompts surface it early.

## 2026-05-29 — Phase 1.2: adapter-postgres read queries + keyset pagination

**What was done**

Extended `@perspectives/adapter-postgres` with the read half of the engine's `DatabaseAdapter`: `runQuery`, `paginateKeyset`, `countRows`, `estimateCount`, the populated `dialect.filterOps` map, and SQLSTATE-aware error mapping. The query compiler lives in three small modules — `compiler.ts` (SELECT / filter / sort / keyset predicate), `pagination.ts` (PK cache, effective-sort assembly, base64url cursor codec), `errors.ts` (SQLSTATE → engine errors). The seed fixture grew to 3,000 customers + 9,000 orders + `ANALYZE`, so pagination, count, and filter assertions have meaningful volume. **16 ✓ in adapter-postgres** (54 ✓ across the workspace), no regressions.

**Files created / modified**

- New: [packages/adapter-postgres/src/compiler.ts](packages/adapter-postgres/src/compiler.ts) — `compileSelectQuery`, `compileFilterGroup`, `quoteIdentifier`, `quoteQualified`, nested-OR `compileKeysetPredicate`. Every value becomes a `$n` param; the only raw-SQL insertion is the DSL's `computed` column expression, which the perspective storage layer is responsible for trusting.
- New: [packages/adapter-postgres/src/pagination.ts](packages/adapter-postgres/src/pagination.ts) — `PrimaryKeyCache` (one query per `(schema, table)`, cached), `buildEffectiveSort` (user sort + PK fall-through, dedup'd), `extractCursorValues` (Date/BigInt-safe), `encodeCursor` / `decodeCursor` (base64url-encoded JSON wire format).
- New: [packages/adapter-postgres/src/errors.ts](packages/adapter-postgres/src/errors.ts) — `mapPgError`: Node-network codes + SQLSTATE classes `08*` / `28*` / `57*` → `ConnectionError`; `42P01` / `42883` → `NotFoundError`; `42703` / `42P02` / `22*` / `42601` / `42804` / `2350x` / `23514` → `ValidationError`; `23505` → `ConflictError`; `42501` → `PermissionDeniedError`; fallback → `ConnectionError`.
- Modified: [packages/adapter-postgres/src/adapter.ts](packages/adapter-postgres/src/adapter.ts) — new methods + replaced the old `asConnectionError` helper with the shared `mapPgError`. `dialect.filterOps` populated for every DSL operator. `runMutation` stubbed to reject with `ValidationError` (placeholder until 1.3). Minimal pg-OID → type-name / jsType lookup for `ResultColumn` metadata.
- Modified: [packages/adapter-postgres/src/index.ts](packages/adapter-postgres/src/index.ts) — exports the compiler / pagination / error helpers alongside `PostgresAdapter`.
- Modified: [packages/adapter-postgres/test/fixtures/seed.sql](packages/adapter-postgres/test/fixtures/seed.sql) — replaced the manual three-row customer seed with `generate_series(1, 3000)` (10 countries, 300 each) and added 9,000 orders cycling through 4 statuses + customer IDs. `ANALYZE customers; ANALYZE orders;` at the end so `pg_class.reltuples` is non-zero for the estimate test.
- New: [packages/adapter-postgres/test/runtime.test.ts](packages/adapter-postgres/test/runtime.test.ts) — 7 tests: pagination by PK (9000 ids, 18 pages, no dupes), pagination by non-unique sort (`status`, PK tiebreaker keeps stability), `countRows` exact = 3000, `estimateCount` within 2000–4000, filtered `countRows` for `country_code = 'DE'` = 300, `runQuery` filtered DE returns only DE rows, cursor base64url round-trip.
- Modified: [packages/adapter-postgres/README.md](packages/adapter-postgres/README.md) — status table for the new methods, "How read queries compile" + "How pagination works" sections, the cursor wire-format docs, the error-map summary, and a trust-boundary note for `computed` column expressions.
- Modified: [packages/engine/src/index.ts](packages/engine/src/index.ts) — added `export type { ColumnDef, ColumnSource, FilterBarConfig, FilterBarField, FilterGroup, FilterLeaf, JoinDef, PermissionDef, PerspectiveBase, PerspectiveSqlBase, PerspectiveTableBase, SortDef } from "@perspectives/dsl"` so adapter packages get every type from a single engine import. DSL stays the source of truth — this is purely re-export.

**Reasoning**

- **Compiler split into three files** rather than one. `compiler.ts` is pure SQL string building, `pagination.ts` is the table-shape concerns (PK lookup, cursor codec), `errors.ts` is the SQLSTATE table. `adapter.ts` keeps the orchestration but stays under 350 lines.
- **Keyset predicate as nested OR**, not row-tuple comparison. `(c1, c2) > (v1, v2)` only works when every column shares a direction; the nested-OR form `(c1 > v1) OR (c1 = v1 AND c2 [<|>] v2) OR ...` handles per-column mixed `asc`/`desc` for the same number of parameters. Worth the extra SQL bytes to keep mixed-direction sort working without a code path split.
- **Fetch `pageSize + 1` rows** so `nextCursor` is only set when we know there's a next page. Avoids the off-by-one tail page where a caller follows a cursor and gets zero rows back; once `nextCursor` is `undefined`, iteration is over.
- **`pg_class.reltuples` for unfiltered estimates** is what the plan calls for; for filtered plans, `EXPLAIN (FORMAT JSON)`'s `Plan Rows` is the planner's best guess without running the query. The seed's `ANALYZE` is what makes `reltuples` non-zero immediately; without it the test would race the autovacuum daemon.
- **`countRows` wraps the plan in `SELECT COUNT(*) FROM (<plan>) sub`** rather than rewriting the WHERE clause manually. Keeps filter compilation in one place — whatever the compiler produces for the projection, `countRows` is correct for.
- **Computed columns are inserted raw** with a documented trust boundary. The DSL deliberately allows arbitrary SQL in `{ computed: "..." }` because perspectives are stored under authorisation. The adapter doesn't try to validate the expression — it's already SQL by the time it reaches the compiler, and the engine layer (above) is what owns the read/write authorisation on the perspective itself.
- **Engine re-exports DSL types** instead of forcing the adapter to add a `@perspectives/dsl` dep. The dependency rule for adapters is "depend on the engine interface" — the engine package centralises every shape an adapter could need. The DSL stays the source of truth (the re-export is `export type … from "@perspectives/dsl"` only).
- **Exhaustiveness check on the filter-op switch** (`const exhaustive: never = leaf.op`) — adding a new operator to the DSL's `FilterOp` enum without teaching the compiler is now a TS compile error, not a runtime "Unsupported op" surprise.
- **`PrimaryKeyCache` is per-adapter, not per-process.** Each adapter instance keys its cache on `(schema, table)`. The cache never invalidates — for v1 we don't expect schemas to change while an adapter is alive. When the engine wires up "refresh schema" actions, the cache gets a `.clear()` hook.

**Acceptance verification**

- `pnpm --filter @perspectives/adapter-postgres exec tsc --noEmit` → clean.
- `pnpm --filter @perspectives/adapter-postgres test` → **16 ✓** in 3.7 s (cached image).
  - Pagination through all 9,000 orders by PK: 18 pages of 500, every id present, no duplicates, count cross-check matches.
  - Pagination by non-unique `status` with PK tiebreaker: 9,000 unique ids across all pages.
  - `countRows(customers)` exact = 3000; `estimateCount(customers)` between 2000–4000; `countRows` filtered on `country_code = 'DE'` = 300.
  - `runQuery` filtered on `country_code = 'DE'` returns 50 rows, every one with `DE`.
  - Cursor base64url round-trip preserves values + direction.
- `pnpm test` → **54 ✓** workspace-wide (dsl 31, engine 5, desktop 2, adapter-postgres 16).
- `pnpm build` → clean.

**Caveats / follow-ups**

- **`runMutation` is a stub that rejects** with `ValidationError("runMutation is not implemented yet")`. Phase 1.3 (writes) closes that gap. `PostgresAdapter` still does not `implements DatabaseAdapter` because of the stub; once `runMutation` lands, we'll add the `implements` clause and remove the rejection.
- **No NULL-aware keyset pagination yet.** Postgres tuple-comparison with NULLs evaluates to NULL (≈ false), so rows with NULL in a sort column get skipped on subsequent pages. Sort on a NOT NULL column (or accept the truncation) until we revisit. The PK is always non-null so single-column-PK pagination is unaffected.
- **`computed` columns are trusted raw SQL.** When the workspace permission model lands (Phase 6), the engine should validate that a perspective's `computed` expressions are signed off by the workspace owner before they reach the adapter. Until then, anyone with perspective-write access can ship arbitrary SQL into the SELECT.
- **`runQuery.truncated` is approximated** (`rowCount === plan.limit`). With `pageSize` semantics it's correct, but a query that legitimately returns exactly `limit` rows is reported as truncated. Acceptable for v1 — the precise signal lands when we move to streaming results.
- **Result column metadata is minimal.** OID→type-name covers 20 common types; everything else degrades to `"unknown"`. The UI doesn't actually use this field today (it consults the schema snapshot), so adding the long tail of OIDs isn't urgent.

## 2026-05-29 — Phase 1.3: metadata-sqlite

**What was done**

Implemented `@perspectives/metadata-sqlite` — a local SQLite-backed `MetadataStore` over `better-sqlite3`. Six tables (`connections`, `perspectives`, `relations`, `display_configs`, `audit_log`, `settings`) + `_migrations` bookkeeping. The migration runner is a tiny lex-sorted numbered-file applier; each file runs in a transaction so failures don't half-apply, and skipping already-applied files makes re-runs no-ops. Persistence is DSL-validated on both write and read for `PerspectiveDef` / `RelationDef` / `DisplayConfig`; corrupted rows raise `ValidationError` on read rather than returning malformed objects. The connections store routes `password` through a `CredentialStore` abstraction (`InMemoryCredentialStore` for tests; real Electron `safeStorage` impl lands later) — the SQLite file never sees the password, and there's a regression test that scans every file in the DB directory as raw bytes for the sentinel after a save. **17 ✓ in metadata-sqlite, 72 ✓ workspace-wide.**

**Files created / modified**

- New: [packages/metadata-sqlite/src/credentials.ts](packages/metadata-sqlite/src/credentials.ts) — `CredentialStore` interface + `InMemoryCredentialStore` for tests.
- New: [packages/metadata-sqlite/src/migrations.ts](packages/metadata-sqlite/src/migrations.ts) — `runMigrations(db, opts)` returns `{ applied, skipped }`.
- New: [packages/metadata-sqlite/src/migrations/0001_initial.sql](packages/metadata-sqlite/src/migrations/0001_initial.sql) — the six tables + audit-log indexes.
- New: per-collection stores — [`connections.ts`](packages/metadata-sqlite/src/connections.ts), [`perspectives.ts`](packages/metadata-sqlite/src/perspectives.ts), [`relations.ts`](packages/metadata-sqlite/src/relations.ts), [`display-configs.ts`](packages/metadata-sqlite/src/display-configs.ts), [`audit.ts`](packages/metadata-sqlite/src/audit.ts), [`settings.ts`](packages/metadata-sqlite/src/settings.ts). Each store owns its prepared statements; `connections` is the only one that crosses to `CredentialStore`.
- New: [packages/metadata-sqlite/src/store.ts](packages/metadata-sqlite/src/store.ts) — `SqliteMetadataStore` assembles the sub-stores, runs migrations in its constructor, exposes `getMigrationResult()` for the idempotency test.
- New: [packages/metadata-sqlite/src/index.ts](packages/metadata-sqlite/src/index.ts) barrel; [package.json](packages/metadata-sqlite/package.json), [tsconfig.json](packages/metadata-sqlite/tsconfig.json), [README.md](packages/metadata-sqlite/README.md) rewritten.
- New tests: [test/store.test.ts](packages/metadata-sqlite/test/store.test.ts) — 13 tests (connections CRUD + invalid port; settings primitives/arrays/nested/prefix-keys; DSL rejection on invalid ULID and missing required field; valid perspective round-trip; corrupted-row read raises `ValidationError`; relation round-trip). [test/credentials.test.ts](packages/metadata-sqlite/test/credentials.test.ts) — 2 tests (password-leak scan + password round-trips back onto the read profile). [test/migrations.test.ts](packages/metadata-sqlite/test/migrations.test.ts) — 2 tests (fresh-apply + idempotent re-open).
- Modified: [package.json](package.json) — added `better-sqlite3` to `pnpm.onlyBuiltDependencies` so the native module's `install` script runs under pnpm's strict approval model.

**Reasoning**

- **Migrations live in `src/migrations/`** so `import.meta.url` resolves them regardless of whether the package is consumed as TS source (workspace, our usual case) or eventually as a built artifact. No separate publish path needed; `fs.readFileSync` is synchronous in lockstep with better-sqlite3.
- **CredentialStore is password-only for now.** The prompt explicitly says "password" — SSH passphrase, private key, SSL clientKey are also credentials but their write paths don't exist yet (Phase 4 introduces real SSH/SSL). Over-engineering the abstraction here would create dead code; expanding it when the SSH prompt lands is a five-line change.
- **`connections.get(id)` returns `password: ""` if the credential store is missing the entry.** The alternative — throwing — would brick the connection picker if a single credential rotated out of sync. The empty-string sentinel is a soft signal; the caller's responsibility is to treat it as "needs re-entry". A typed marker (e.g. `password: { kind: "missing" }`) would be cleaner but doesn't match the engine's `ConnectionProfile.password: string` shape; can revisit when the engine type evolves.
- **DSL validators run on both write and read.** Writing an invalid object throws before any SQL runs; reading a corrupted row throws with the Zod issues attached. On `list()` the first invalid row throws — loud failure beats silent loss. The corruption test forces this by `UPDATE`ing a payload to use `version: 99` and asserting the next `get` raises.
- **No `workspace_id` columns** in the SQLite schema. Local mode has no workspaces by design; the columns would always be `NULL`. The Postgres metadata store will introduce them when shared mode lands. `ListQuery.workspaceId` is accepted but ignored at this layer.
- **Migration runner exposes `getMigrationResult()`** on the store so the idempotency test can assert `{ applied: [], skipped: [<all the files>] }` after a re-open without reaching into private state. Cleaner than a `runMigrationsAgain()` escape hatch.
- **WAL mode + `foreign_keys = ON` + `synchronous = NORMAL`** as default pragmas. WAL gives us concurrent reads while writes are in progress; foreign-key enforcement catches misuse early; `synchronous = NORMAL` balances fsync frequency against write throughput on the desktop write path (the audit log especially). All three are conservative defaults — happy to tune when there's data.
- **Password-leak guard reads every file in the DB directory**, not just `<name>.db`. WAL mode writes to `<name>.db-wal` and `<name>.db-shm`; close-on-test folds WAL into the main file, but reading the directory anyway is defensive against future pragma changes.
- **`InMemoryCredentialStore`** rather than a no-op for tests, because round-trip tests need the password to come back on read. A no-op would only prove "we don't leak" without proving "we can still serve credentials at all".

**Acceptance verification**

- `pnpm --filter @perspectives/metadata-sqlite exec tsc --noEmit` → clean.
- `pnpm --filter metadata-sqlite test` → **17 ✓** in ~350 ms.
  - CRUD round-trips for connection profiles (5 tests including invalid-port rejection and password rotation on update).
  - Settings KV: primitives + arrays + nested objects, missing-key returns null, `keys()` total and prefix-filtered, delete works.
  - Invalid perspective rejected on `create` (invalid ULID, missing required field). Valid perspective round-trips. Corrupted on-disk row raises `ValidationError` on read.
  - Relation round-trip.
  - Password sentinel not present in any file under the DB directory after save+close; sentinel IS still retrievable from the credential store.
  - Migration runner applies cleanly to a fresh file; re-opening reports zero applied and all files skipped.
- `pnpm test` workspace-wide → **72 ✓** (dsl 31, engine 5, desktop 2, adapter-postgres 17, metadata-sqlite 17). No regressions.

**Caveats / follow-ups**

- **CredentialStore scope is password-only.** SSH passphrase, SSH private key, SSL clientKey still flow through SQLite via `ssh_tunnel_json` / `ssl_json`. The Phase 4 SSH prompt will move these to the credential store and surface a richer `ConnectionSecrets` shape.
- **Missing-credential read returns `""` for password.** Soft signal — callers must distinguish "needs re-entry" from "literal empty password" themselves. Will harden when the engine's `ConnectionProfile.password` admits a richer marker shape.
- **No workspace tables.** Workspaces / members / shares live in `metadata-postgres` and `metadata-remote`. The engine's `MetadataStore` declares them optional precisely for this reason.
- **`AuditLogStore.list()` does no pagination over the audit log**, just `LIMIT`/`OFFSET`. Fine for the foreseeable scale (one user, one machine); when the workspace audit history lands on Postgres, that store can do keyset pagination over `(timestamp, id)`.
- **Migrations are forward-only.** No down-migrations / rollback. Acceptable for a local desktop store — if the schema needs to retract, we ship a new forward migration that re-introduces the old shape. Tightening this story is a Phase 5+ concern when we sync workspaces across devices.
- **`better-sqlite3` adds a native build dep.** CI's first install on a fresh runner will compile the module (~15 s with the warnings shown above). pnpm's `onlyBuiltDependencies` allow-list now includes it; CI works the same way locally does.

## 2026-05-29 — Phase 1.4: EngineService + tRPC orchestration

**What was done**

Stood up the orchestration layer that wires together everything from the prior prompts. The new [`EngineService`](packages/engine/src/service.ts) holds a `MetadataStore`, a `CredentialStore`, and an adapter factory; manages the per-connection lifecycle (`connect` / `disconnect` plus an LRU-free map of active adapters); caches one `SchemaSnapshot` per active connection; and exposes the read-side data path (`getTablePage` / `countTable` / `estimateTable`). The Electron main process composes it with `SqliteMetadataStore` + `InMemoryCredentialStore` + a `PostgresAdapter` factory, and exposes three new tRPC sub-routers (`connections`, `schema`, `data`) on top of the existing `health` router via a single `makeAppRouter(engine)` factory. A new integration test runs the whole stack end-to-end against a testcontainers Postgres, going renderer-side tRPC caller → router → service → adapter → DB → back. **73 ✓ workspace-wide; one full-stack test added.**

**Files created / modified**

- **Engine surface tightening**:
  - [packages/engine/src/adapter.ts](packages/engine/src/adapter.ts) — added `close(): Promise<void>` to the `DatabaseAdapter` interface, plus a `DatabaseAdapterFactory` type alias `(profile) => DatabaseAdapter`.
  - [packages/engine/src/metadata.ts](packages/engine/src/metadata.ts) — added the `CredentialStore` interface here (was previously declared inside `metadata-sqlite`); the engine is the right level for it since `ConnectionProfile` lives at the same boundary.
  - [packages/engine/src/index.ts](packages/engine/src/index.ts) — re-exports the new types via `export * from "./service"`.
  - [packages/engine/README.md](packages/engine/README.md) — narrowed the "zero implementations" rule to "no SQL / no HTTP / no SQLite is touched here" and added a paragraph saying what *does* live here (the service).
  - [packages/engine/package.json](packages/engine/package.json) — added `@types/node` (for `node:crypto.randomUUID`) and a `typecheck` script.
- **New `EngineService`**:
  - [packages/engine/src/service.ts](packages/engine/src/service.ts) — the class itself. Methods exactly as the prompt called out plus a stash of `getMigrationResult`-style internal helpers (`requireAdapter`, `findTable`, `simpleTablePlan`). All errors flow through the existing engine `Error` hierarchy (`NotFoundError`, `ValidationError`).
- **Adapter explicit interface implementation**:
  - [packages/adapter-postgres/src/adapter.ts](packages/adapter-postgres/src/adapter.ts) — added `implements DatabaseAdapter` now that `close()` lands on the interface and `runMutation` is a (rejecting) stub. Anchors the structural contract.
- **Metadata-sqlite credential re-route**:
  - [packages/metadata-sqlite/src/credentials.ts](packages/metadata-sqlite/src/credentials.ts) — `CredentialStore` interface now imported from `@perspectives/engine` and re-exported. `InMemoryCredentialStore` impl stays here (it's a concrete class; engine deliberately stays interface-y).
- **Desktop tRPC refactor + composition**:
  - [apps/desktop/src/main/trpc/router.ts](apps/desktop/src/main/trpc/router.ts) — rewritten as a `makeAppRouter(engine)` factory exporting a `TrpcBuilder` type so sub-routers share the same `t` instance. `AppRouter` is now `ReturnType<typeof makeAppRouter>`.
  - New: [routers/health.ts](apps/desktop/src/main/trpc/routers/health.ts), [routers/connections.ts](apps/desktop/src/main/trpc/routers/connections.ts), [routers/schema.ts](apps/desktop/src/main/trpc/routers/schema.ts), [routers/data.ts](apps/desktop/src/main/trpc/routers/data.ts).
  - New: [inputs.ts](apps/desktop/src/main/trpc/inputs.ts) — Zod schemas validating every procedure's input at the IPC boundary.
  - [trpc/ipc.ts](apps/desktop/src/main/trpc/ipc.ts) — `registerTrpcIpc(router)` now takes the router as an arg (was importing a module-level `appRouter`).
  - [main/index.ts](apps/desktop/src/main/index.ts) — `composeEngine()` builds the SQLite store, credential store, engine service, and adapter factory; the main process wires the router and hooks `app.on("before-quit", …)` for clean shutdown.
- **Desktop dependencies**:
  - [apps/desktop/package.json](apps/desktop/package.json) — `@perspectives/{adapter-postgres,engine,metadata-sqlite}` as workspace deps; `zod` as a runtime dep (used by tRPC input schemas); `testcontainers` + `@testcontainers/postgresql` as dev deps for the integration test.
- **Tests**:
  - [apps/desktop/test/integration.test.ts](apps/desktop/test/integration.test.ts) — one test that creates a connection profile via `caller.connections.create`, activates it via `caller.connections.connect`, fetches the schema via `caller.schema.get`, pages 25 customers via `caller.data.getTablePage`, asserts both `countTable` (3000 exact) and `estimateTable` (positive). Final `disconnect` releases the pool.
  - [apps/desktop/test/router.test.ts](apps/desktop/test/router.test.ts) — adjusted to use `makeAppRouter(stubEngine)` since the old `appRouter` constant is gone.

**Reasoning**

- **`CredentialStore` interface lives in engine.** It pairs with `ConnectionProfile`, which is engine-level. Putting the interface there means future implementations (`safeStorage`-backed for Electron, encrypted-KV for the server) depend only on engine, not on a SQLite-specific package. `InMemoryCredentialStore` stays in metadata-sqlite because it's a concrete class — engine remains interface-y.
- **`DatabaseAdapterFactory` instead of an `Adapter` constructor type.** A factory function lets the composition layer close over any state it wants (per-connection logging, custom pool sizes, etc.) without leaking into the engine surface. The engine never imports `PostgresAdapter`; it only knows about the factory.
- **The engine holds `credentialStore` but doesn't currently consume it.** The prompt explicitly listed it as a dependency of `EngineService`, and there are real future uses (password rotation, manual re-entry flows). My first cut had `connect()` fetch the password from `credentialStore` and overlay it onto the profile — that overrode the password the metadata store had already attached and broke the integration test when the two cred stores were different instances. Removed the duplicate fetch; the metadata store is now the single authority for credential assembly during reads.
- **Sub-router factories pattern.** Each `makeXRouter(t, engine)` returns a router built off the same `t`. Lets the top-level `makeAppRouter` assemble them while preserving the shared `transformer: superjson` config and the shared context type. Adding `health` to the same pattern (despite not needing the engine) keeps everything uniform.
- **Zod input validation at the tRPC boundary** even though the renderer is type-safe. The IPC channel is a hard process boundary; treating it as untrusted is cheap insurance, and `tRPC` accepts any parser so adding Zod cost nothing beyond writing the schemas.
- **Single-cast at the deserialization boundary.** Zod's `.optional()` parses to `T | undefined`, while the engine's interfaces use `?: T` (strict under `exactOptionalPropertyTypes`). Structurally identical, type-wise different. A single `as ConnectionProfile` / `as GetTablePageArgs` cast in the routers bridges it — CLAUDE.md explicitly permits this at deserialization boundaries.
- **Schema cache keyed by connection id.** Invalidated on `disconnect` and `updateConnection`. `getSchema` is a get-or-fetch; `refreshSchema` forces a re-introspect. The cache lifecycle matches the adapter lifecycle, which feels right — a closed adapter has nothing to introspect against.
- **`getTablePage` reads the table's column list from the cached schema** rather than asking the caller to project columns. Saves the renderer from re-spelling every column on every page request; the cost is one extra `getSchema` hop on the first page (cheap after the cache warms).
- **`countTable` / `estimateTable` build a minimal `QueryPlan`** with `columns: [{ source: { computed: "1" } }]` — the adapter's compile path doesn't care about the projection for COUNT(*), and a no-projection plan would fail validation in the SELECT compiler.

**Acceptance verification**

- `pnpm typecheck` → all four typecheck-aware packages clean (dsl/engine/adapter-postgres/metadata-sqlite/desktop).
- `pnpm test` workspace-wide → **73 ✓** (dsl 31, engine 5, desktop 3, adapter-postgres 17, metadata-sqlite 17). One new integration test, two existing desktop tests still passing.
- The integration test exercises every method on `EngineService` except the disconnect-then-reconnect path and `updateConnection` — those paths are covered by the existing metadata-sqlite tests and the engine's own connect logic, both already proven by the workspace sweep.
- `pnpm --filter @perspectives/desktop exec electron-vite build` → all three bundles clean (main 28 kB, preload 0.3 kB, renderer 502 kB). Renderer size unchanged from the previous prompt — the engine / adapter / metadata-sqlite imports in the main process are correctly excluded from the browser bundle by the type-only import pattern.

**Caveats / follow-ups**

- **`InMemoryCredentialStore` is the live credential store in the Electron main process.** That means restarting the app loses every stored password — users would re-enter on every launch. This is the explicit hand-off to prompt 1.5, which swaps it for an Electron `safeStorage`-backed implementation that uses the OS keychain.
- **`testConnection(profile)` on the EngineService takes a full `ConnectionProfile` including password.** That's fine for in-process callers (the tRPC layer), but if we ever proxy this method over an HTTP boundary, the password would cross the wire. The shared-mode story (Phase 6) will need a different signature — probably `testConnection({ profileId, overridePassword? })` so the cred store is the canonical source.
- **`EngineService.credentialStore` is currently held but unused.** Documented inline; will fold into password-rotation methods in Phase 4 / 5.
- **No engine-level unit tests** (mocked metadata store + mocked adapter). The integration test covers the happy path through tRPC; failure-mode tests for `connect-without-profile`, `getTablePage-without-active-connection`, etc., are worth adding when the engine accumulates more conditional logic.
- **Zod schemas in `inputs.ts` duplicate the engine interfaces.** Long-term we'd move the Zod schemas into the engine package itself (same pattern the DSL uses with `z.infer`), but until there's a second tRPC surface (the server) the duplication is cheaper than the refactor.
- **`getTablePage` errors when the connection isn't yet active** (`ValidationError` via `requireAdapter`). That's correct behaviour, but a friendly UI should call `connect` first or surface the error as "please connect to the database before browsing tables." Not the engine's problem; flag for the UI.

## 2026-05-30 — Phase 1.5: connection manager UI + safeStorage credential store

**What was done**

Replaced the placeholder `InMemoryCredentialStore` in the Electron main process with a real [`SafeStorageCredentialStore`](apps/desktop/src/main/credentials.ts) that encrypts passwords with `safeStorage.encryptString` and persists the ciphertext to a single `credentials.json` file in `userData` (mode 0600, atomic tmp+rename). Built the renderer-side connection manager — empty-state CTA on fresh install, a sidebar-ish list with edit/delete, and a shadcn-dialog form that validates with Zod and offers a "Test connection" button before saving. Tightened the engine surface so passwords never round-trip through tRPC: `listConnections` / `createConnection` / `updateConnection` now return `ConnectionProfileSummary` (`Omit<ConnectionProfile, "password">`). 11 new pure validation tests added; **84 ✓ workspace-wide**, no regressions.

**Files created / modified**

- **Engine surface tightening**:
  - [packages/engine/src/metadata.ts](packages/engine/src/metadata.ts) — added `ConnectionProfileSummary = Omit<ConnectionProfile, "password">` type, exported via the existing barrel.
  - [packages/engine/src/service.ts](packages/engine/src/service.ts) — `listConnections` / `createConnection` / `updateConnection` return `ConnectionProfileSummary[]` / `ConnectionProfileSummary`. New private `redactPassword(profile)` helper destructures the password off. `deleteConnection` now also calls `this.credentialStore.delete(id)` so the engine is the explicit owner of credential lifecycle (the unused-field error went away once the field actually got used).
- **Main process credential store**:
  - New [apps/desktop/src/main/credentials.ts](apps/desktop/src/main/credentials.ts) — `SafeStorageCredentialStore implements CredentialStore`. Refuses to write if `safeStorage.isEncryptionAvailable()` is false; swallows decrypt failures (OS key rotation) as `null` so the UI prompts for re-entry instead of crashing; atomic write via `<file>.tmp` → `rename`.
  - [apps/desktop/src/main/index.ts](apps/desktop/src/main/index.ts) — `composeEngine()` swaps `InMemoryCredentialStore` for `SafeStorageCredentialStore`. Removed the now-stale `InMemoryCredentialStore` import.
- **Renderer-side connection UI**:
  - New [apps/desktop/src/renderer/src/connections/validate.ts](apps/desktop/src/renderer/src/connections/validate.ts) — pure Zod validator + `defaultConnectionFormValues()`. No React, no DOM.
  - New [apps/desktop/src/renderer/src/connections/validate.test.ts](apps/desktop/src/renderer/src/connections/validate.test.ts) — **11 unit tests**. Covers happy path, whitespace trimming, password whitespace preservation, empty-name rejection, port range, non-integer port, missing password, unknown SSL mode, multi-field error aggregation, default-values stability, default-values content.
  - New [apps/desktop/src/renderer/src/connections/types.ts](apps/desktop/src/renderer/src/connections/types.ts) — single-line re-export of `ConnectionProfile` + `ConnectionProfileSummary` from the engine.
  - New [apps/desktop/src/renderer/src/connections/EmptyState.tsx](apps/desktop/src/renderer/src/connections/EmptyState.tsx) — fresh-install screen with the "Add your first connection" CTA.
  - New [apps/desktop/src/renderer/src/connections/ConnectionList.tsx](apps/desktop/src/renderer/src/connections/ConnectionList.tsx) — Card-per-connection list with edit/delete icons + an "Add connection" header button.
  - New [apps/desktop/src/renderer/src/connections/ConnectionForm.tsx](apps/desktop/src/renderer/src/connections/ConnectionForm.tsx) — the shadcn Dialog wrapping the form. Holds local form state via `useState`, validates with the pure validator, calls `trpc.connections.test` / `.create` / `.update`. Invalidates the list query on save. On password-on-edit: the field starts blank and the user re-enters every time (we never read the password back from the engine).
  - New [apps/desktop/src/renderer/src/connections/ConnectionsView.tsx](apps/desktop/src/renderer/src/connections/ConnectionsView.tsx) — owns the dialog state machine (`closed`/`create`/`edit`) and dispatches list vs. empty-state.
  - [apps/desktop/src/renderer/src/App.tsx](apps/desktop/src/renderer/src/App.tsx) — wires the connections query to either the empty state, the list, a loading message, or an error message. Engine status moved to a small footer in the bottom-right.
- **shadcn components** (5 new files, all standard copy-ins from the shadcn registry): [dialog.tsx](apps/desktop/src/renderer/src/components/ui/dialog.tsx), [input.tsx](apps/desktop/src/renderer/src/components/ui/input.tsx), [label.tsx](apps/desktop/src/renderer/src/components/ui/label.tsx), [select.tsx](apps/desktop/src/renderer/src/components/ui/select.tsx), [alert.tsx](apps/desktop/src/renderer/src/components/ui/alert.tsx). Added a `success` variant to `Alert` so the test-connection result renders in green.
- [apps/desktop/package.json](apps/desktop/package.json) — added `@radix-ui/react-dialog`, `@radix-ui/react-label`, `@radix-ui/react-select` as dev deps (the components are bundled into the renderer by Vite).

**Reasoning**

- **`safeStorage` + single JSON file, not a parallel SQLite DB.** The credential store needs to be independent of `metadata-sqlite`'s SQLite file because the metadata store is *constructed* with the credential store as a dependency — putting both in the same file would create a chicken-and-egg at startup. A second SQLite file would work but adds open/close lifecycle plus `better-sqlite3` startup overhead twice. A flat JSON file is simpler: load once on construction, write atomically on changes, mode 0600. The encryption is what matters; the storage shape is just a base64 dictionary.
- **Atomic write via tmp + rename.** A mid-write crash with a single `writeFileSync` would corrupt the file and lose every credential. Writing to `<file>.tmp` first and then `renameSync` makes the swap atomic on POSIX — readers see either the old file or the new file, never a half-written one.
- **`ConnectionProfileSummary` at the engine boundary.** The prompt's hard rule is "never put a password in a query cache." The cleanest enforcement is to redact at the API boundary so the renderer can't even see the password — types stop it before code stops it. Created/updated profiles return Summary too, so even the immediate response from a save doesn't leak the password back.
- **Form schema is flat (`sslMode` top-level).** The engine's `ConnectionProfile` has `ssl: { mode }` nested, but the form's mental model is "one row per input." Keeping the form flat means the validator is more compact, the test surface is smaller, and the field-to-error mapping is direct. The submit step re-shapes into `ssl: { mode }` before sending.
- **Password required on every save (no "preserve on edit").** The form's password field starts blank in edit mode and must be re-entered to save. Trade-off: friction every time the user renames a connection, vs. complexity of "preserve current" semantics (a sentinel value, a special tRPC input shape, careful UI affordances). Phase 1.5 picks friction; a later phase can add a "save without re-entering" affordance once we have feedback.
- **Password trimming.** The validator trims whitespace from every string field except `password`. A leading/trailing space in a password can be intentional; trimming it would silently corrupt the credential. The validate test pins this behaviour.
- **Pure validation in its own module.** The prompt says "pure, no Electron"; the easiest way is to keep validation in `validate.ts` with no React, no DOM, no IPC. The test runs in vitest's default node environment with no jsdom.
- **`crypto.randomUUID()` for new connection ids.** Engine's `ConnectionProfile.id` is `string`. UUID is fine; if we ever standardise on ULID, we swap the one call site.
- **Engine owns credential cleanup on `deleteConnection`.** `metadata-sqlite`'s `connections.delete` already deletes from its credential store, but having the engine also call `credentialStore.delete(id)` is defensive — when `metadata-postgres` lands later, that store probably won't manage credentials at all, and the engine's call is the safety net. `CredentialStore.delete` is documented idempotent so the double-call is harmless.
- **`exactOptionalPropertyTypes` again.** Same bridge as Phase 1.4: when Zod's `.optional()` produces `T | undefined` and the engine expects `?: T`, the renderer code uses single `as` casts at the tRPC boundary. For React props receiving `... profile === undefined ? undefined : profile` shapes, switched the prop type from `profile?: T` to `profile: T | undefined` so the explicit-undefined call site stays legal.

**Acceptance verification**

- `pnpm typecheck` workspace-wide → clean.
- `pnpm test` workspace-wide → **84 ✓** (dsl 31, engine 5, desktop 14, adapter-postgres 17, metadata-sqlite 17). Desktop tests: 11 validate + 2 router + 1 integration.
  - The 11 validator tests cover the prompt's "component test for the form's validation logic (pure, no Electron)" requirement.
- `pnpm --filter desktop exec electron-vite build` → all three bundles clean: main 36.7 kB (was 27.8 — added safeStorage credential store), preload 0.26 kB (unchanged), renderer 844.8 kB (was 502.5 — added shadcn dialog + select + label and their Radix backings).
- The engine integration test still passes against testcontainers Postgres — the redacted-list change didn't break any code path because it consumes via tRPC's typed surface, which propagates the type change automatically.

**Caveats / follow-ups**

- **`InMemoryCredentialStore` is still used in tests.** The integration test composes the engine with `InMemoryCredentialStore`, which is correct (we don't want the real OS keychain involved in CI). The metadata-sqlite tests use it too. When CI ships on machines without `safeStorage`, no behavior change is expected — those code paths aren't exercised.
- **safeStorage on Linux can be unavailable.** Headless Linux runners with no keyring service surfaced will throw on `set()` and the UI will show the friendly error. Users in that environment can't persist credentials at all until they enable a keyring. That's the right behavior — the alternative is plaintext on disk, which the prompt forbids.
- **Decrypt failures are silently turned into `null`.** That means a user who moves the `userData/` directory between machines will see "connection requires password" for every connection. Trade-off vs. crashing; the UI flow handles re-entry naturally.
- **The form requires re-entering the password on every edit.** Documented as a known UX friction; "leave blank to preserve" is a future ask.
- **Connection list doesn't yet "select" anything.** Clicking a row does nothing — selection + the schema sidebar is the next prompt. Edit / delete work today.
- **Password leaves React state at submit time.** We use `setValues(defaultConnectionFormValues())` after a successful save, which clears the password. The form component unmounts when `open` flips to false because of the `if (!open) return null;` guard — that's deliberate so we don't hold form state (with the password) between dialog sessions.
- **No browser-level component tests.** The validator is tested in isolation; integration of form + tRPC is tested at the IPC layer in `integration.test.ts`. A real browser-render test (with `@testing-library/react` + jsdom) would catch wiring bugs in `ConnectionForm.tsx` itself; deferring until we have a second component worth testing the same way.
- **The renderer bundle grew by ~340 kB.** Radix UI Dialog + Select + Label primitives bring real code with them. Vite tree-shakes within Radix but the kept surface is substantial. Acceptable for a desktop app; will revisit if we ever ship a web bundle that has tighter size constraints.
- **No migration path for credentials that were saved under the InMemoryCredentialStore in dev**. There was nothing to migrate (in-memory means they vanished on restart), but if a user had stashed credentials in some other way pre-1.5, they'd need to re-enter.

## 2026-05-31 — Phase 1.5 follow-up: workspace packages must bundle into the main process

**What was done**

Fixed a runtime crash on `pnpm dev` (`SyntaxError: Unexpected token 'export'` from `@perspectives/adapter-postgres/src/index.ts`). The Electron main bundle is CJS, but `externalizeDepsPlugin()` was leaving `@perspectives/*` workspace packages as `require()` calls — and those packages publish their TypeScript source directly (`"exports": "./src/index.ts"`) since the monorepo has no pre-publish build step. Node's CJS loader can't parse `export`. Fix: tell `externalizeDepsPlugin` to inline the workspace packages and add `pg` + `better-sqlite3` as direct desktop dependencies so their native bindings stay externalized.

**Files modified**

- [apps/desktop/electron.vite.config.ts](apps/desktop/electron.vite.config.ts) — hoisted the exclude list into a shared `EXCLUDE_FROM_EXTERNALIZE` const containing `superjson` plus all four `@perspectives/*` packages. Applied to both `main` and `preload` plugin configs. Added a verbose comment explaining the externalize/bundle policy so the next contributor (human or AI) doesn't re-discover this rule.
- [apps/desktop/package.json](apps/desktop/package.json) — added `pg ^8.13.1` and `better-sqlite3 ^11.7.0` as direct dependencies. They were transitively present via `@perspectives/adapter-postgres` and `@perspectives/metadata-sqlite`, but `externalizeDepsPlugin` only externalizes what's listed in the *building* package's `dependencies`, so the bundler tried to pull them into the bundle (which fails for native modules). Listing them here makes the externalize-vs-bundle decision explicit.

**Reasoning**

- **The rule for this monorepo**: workspace packages get bundled inline, runtime npm deps get externalized. The signal for "externalize me" is `apps/desktop/package.json`'s `dependencies`. The signal for "bundle me" is the `exclude` list in `externalizeDepsPlugin`. Both lists are now explicit and commented.
- **Why I missed this in Phase 1.4 verification.** I ran `electron-vite build` (which produced a bundle but didn't execute it) and the in-process integration test (which uses vitest's TS loader, never `require()`-ing a compiled output). The first execution of the compiled bundle was the user's `pnpm dev` after Phase 1.5 — and only then did Node CJS try to parse `.ts`.
- **Why not pre-build the workspace packages to `dist/`?** That's the "proper" long-term answer, but adds a per-package build step, a `tsconfig` for emitting, a publish vs. dev pipeline split, and a new failure mode (out-of-date dist files). Bundling inline keeps the dev story simple while costing ~70 kB of main bundle size — acceptable for now. We'll revisit when we ship the server (which needs separate consumer-friendly packages) or want to publish to npm.
- **Why `pg` and `better-sqlite3` can't be bundled even if we wanted to.** They have native (`.node`) bindings that aren't valid JS. Rollup would either error out trying to bundle them or produce a bundle that silently fails at runtime when the native part is missing. External + node_modules at runtime is the only path.

**Acceptance verification**

- `pnpm install` → adds pg + better-sqlite3 to apps/desktop/node_modules (already present transitively, just symlinks).
- `pnpm --filter @perspectives/desktop exec electron-vite build` → all three bundles clean. Main bundle 107 kB (was 36.7 kB pre-fix), the delta is the inlined workspace TS now transpiled into the bundle.
- `grep "require(" out/main/index.js` lists exactly the deps that should stay external: node:* builtins, `electron`, `pg`, `better-sqlite3`, `@trpc/server`, `zod`. Zero `require("@perspectives/...")`.
- `pnpm test` workspace-wide → still **84 ✓** with 3 skipped (the docker-compose verify), no regressions. The vitest tests never go through the compiled bundle so they were green throughout — but the bundle now matches the dev expectation.

**Caveats / follow-ups**

- The exclude list will grow as new workspace packages get added that the main process imports at runtime (`@perspectives/server` eventually, `@perspectives/metadata-postgres`, …). It's manageable for now; if the list grows past ~10 entries, switching to a regex (e.g. excluding anything matching `/^@perspectives\//`) via a custom rollup `external` callback is a small refactor.
- The renderer build is unaffected — the renderer only type-imports from workspace packages, and types are stripped at compile time, so nothing runtime-relevant from `@perspectives/*` ever reaches the renderer bundle.

## 2026-05-31 — Phase 1.5 follow-up #2: native module ABI + migrations after bundling

**What was done**

After the workspace-bundling fix above, `pnpm dev` surfaced two more issues: a native-module ABI mismatch between local Node 24 and Electron 32's bundled Node 20, and then — once Electron was bumped and the ABI fixed — a missing-migrations-directory error because the metadata-sqlite migration runner used `import.meta.url`-relative `readdirSync` and that path no longer exists after the source gets inlined into the main bundle. Two fixes:

1. Bumped `electron` to `~41.0.0`, bumped `better-sqlite3` to `^12.10.0` (the v11 source uses removed V8 APIs that Electron 41's V8 14 dropped), and added `@electron/rebuild` plus two scripts (`rebuild:electron` and `rebuild:node`) to switch the single native binary between the two ABIs the workflow needs.
2. Baked the migrations into the bundle as `?raw` string imports. The migration runner now takes a `Migration[]` array; the canonical bundled list lives in [`packages/metadata-sqlite/src/migrations-index.ts`](packages/metadata-sqlite/src/migrations-index.ts).

**Files modified**

- [apps/desktop/package.json](apps/desktop/package.json) — `electron: ~41.0.0`, `better-sqlite3: ^12.10.0`, new devDep `@electron/rebuild`, new scripts `rebuild:electron` and `rebuild:node`, `dev` script prefixed with `pnpm rebuild:electron &&`.
- [packages/metadata-sqlite/package.json](packages/metadata-sqlite/package.json) — `better-sqlite3: ^12.10.0`.
- [packages/metadata-sqlite/src/vite-env.d.ts](packages/metadata-sqlite/src/vite-env.d.ts) (new) — `declare module "*.sql?raw"` so TS understands the `?raw` import suffix.
- [packages/metadata-sqlite/src/migrations-index.ts](packages/metadata-sqlite/src/migrations-index.ts) (new) — imports each `migrations/*.sql` with `?raw`, exports `BUNDLED_MIGRATIONS: Migration[]` in lex order.
- [packages/metadata-sqlite/src/migrations.ts](packages/metadata-sqlite/src/migrations.ts) — runner now takes `{ migrations: Migration[]; now?: () => string }` instead of `{ migrationsDir; now? }`. Removed `readdirSync` / `readFileSync` / `join` imports. Added a `Migration` type export. Sorts the list internally so callers don't have to.
- [packages/metadata-sqlite/src/store.ts](packages/metadata-sqlite/src/store.ts) — removed `import.meta.url` / `fileURLToPath` path resolution; now passes `BUNDLED_MIGRATIONS` to the runner. New `migrations?: Migration[]` option lets tests pass a smaller list.
- [packages/metadata-sqlite/src/index.ts](packages/metadata-sqlite/src/index.ts) — re-exports `Migration` type and `BUNDLED_MIGRATIONS`.

**Reasoning**

- **Why Electron 32 → 41.** Electron 32 ships Node 20 (ABI 128); local Node is 24.11.1 (ABI 137). `better-sqlite3`'s install compiles for local Node, so the resulting binary fails to load in Electron. Electron 41 ships Node 24.x — close to local — but Electron forks Node with its own ABI tweaks, so the version match alone isn't enough; you still need `@electron/rebuild`.
- **Why `better-sqlite3` 11 → 12.** v11.10.0 uses `v8::Object::GetPrototype` and `v8::Context::GetIsolate`, both removed in V8 13/14. Electron 41 ships V8 14, so v11 source won't compile against Electron 41's headers. v12.10.0 dropped the deprecated calls.
- **Why bake migrations into the bundle instead of copying a directory.** The naive copy-`migrations/`-to-`out/main/` solution leaves two ways to get it wrong (forgetting to update the copy step when a new migration lands, or running dev with stale files). `?raw` imports make the migration files first-class to the bundler — they get TypeScript-checked alongside other imports, and the bundle is self-contained. The new `migrations-index.ts` is the single edit point when adding a migration.
- **Why one binary, two ABIs.** pnpm dedupes `better-sqlite3` into `node_modules/.pnpm/better-sqlite3@12.10.0/.../build/Release/better_sqlite3.node`. Every consumer (vitest tests in metadata-sqlite, the integration test in desktop, the Electron main runtime) symlinks to the same `.node` file. Compiling it for one ABI means the others fail to load it. The two `rebuild:*` scripts switch the binary between Node ABI (137) and Electron 41 ABI (145).
- **`pnpm dev` auto-rebuilds for Electron** so the common case is one command. `pnpm test` does NOT auto-rebuild for Node (auto-rebuild adds 10–30 s to every test invocation); if tests fail with an ABI message, run `pnpm --filter desktop rebuild:node` first.

**Acceptance verification**

- `pnpm install` → installs Electron 41 + `@electron/rebuild` + `better-sqlite3@12.10.0` (with its compile-for-local-Node postinstall).
- `pnpm --filter desktop rebuild:electron` → uses Electron's node-gyp + headers to compile `better-sqlite3.node` for ABI 145. Output: `✔ Rebuild Complete`.
- `pnpm --filter desktop rebuild:node` → reinstalls the prebuilt for local Node 24 (ABI 137).
- `pnpm dev` → Electron 41 launches, main bundle 110.68 kB, no `UnhandledPromiseRejectionWarning` after `start electron app...`. Renderer dev server serves HTTP 200.
- `pnpm --filter @perspectives/metadata-sqlite test` (after `rebuild:node`) → still **17 ✓**. Migration tests verify the `_migrations` table is populated after first open and that a second open reports `applied: []`.

**Caveats / follow-ups**

- **The two-ABI dance is the real pain.** A `pnpm test` immediately after a `pnpm dev` fails until the user runs `pnpm --filter desktop rebuild:node`. Mitigations to consider when there's time:
  - Use Node's stable `node:sqlite` instead of `better-sqlite3`. Node 22.5+ and Electron 41 (Node 24) both have it. Native, no rebuild dance ever. Requires rewriting metadata-sqlite's ~10 prepared-statement / transaction call sites — non-trivial but eliminates the problem class.
  - Pin local Node to exactly Electron's bundled Node version (and turn off any version drift). Brittle.
  - Build two binaries with a custom hook. Complex.
- **`@electron/rebuild` needs Python + Xcode CLT** to compile `better-sqlite3` from source if no prebuild exists for the Electron version. Worked on this macOS; CI on a fresh runner might need extra setup.
- **The dev script latency**: `pnpm dev` now runs `rebuild:electron` first. When the binary is already in the right state, electron-rebuild returns in ~1 s. First-time-after-`pnpm install` it's ~20–60 s (downloading Electron headers + compiling). Cached after that.
- **The new `Migration[]` API is a small breaking change** to `metadata-sqlite`'s `runMigrations` export. We're pre-1.0, no external consumers — the only call site was inside the package. Documented in the type definitions.

## 2026-06-01 — Phase 1.6: schema sidebar + session view

**What was done**

Built the schema sidebar plus the surrounding "session" view that the user lands on after activating a connection. Clicking a saved connection now lifts an `activeConnectionId` into App.tsx; the renderer swaps to `SessionView`, which calls `connections.connect` once on mount, subscribes to `schema.get`, and lays out a sidebar (search + refresh + tree) next to a tab area + content panel. Clicking a table/view in the tree opens it as a tab; the tab content is a placeholder card naming the selected item until the row grid lands in Phase 1.8. Pure schema-filter logic is unit-tested. **24 desktop tests passing (10 new schema-filter tests), 94 ✓ workspace-wide.**

**Files created**

- [renderer/src/session/filter.ts](apps/desktop/src/renderer/src/session/filter.ts) — pure `filterSchema(snapshot, query)` returning a `SchemaSnapshot`-shaped result with non-matching items removed. Case-insensitive substring; matching the schema name keeps everything under it.
- [renderer/src/session/filter.test.ts](apps/desktop/src/renderer/src/session/filter.test.ts) — 10 unit tests covering empty/whitespace queries, case-insensitivity, substring match, schema-name match, drop-empty-schemas, no-match, view matching, the "drop the views key when no views match" detail, and a no-mutate invariant.
- [renderer/src/session/types.ts](apps/desktop/src/renderer/src/session/types.ts) — `OpenTab` + `tabKey` + `findTab` helpers.
- [renderer/src/session/SchemaTree.tsx](apps/desktop/src/renderer/src/session/SchemaTree.tsx) — recursive tree with expand/collapse, distinct lucide icons for tables (`Table`) / views (`Eye`) / functions (`FunctionSquare`), schemas as `FolderTree`. Functions render as non-clickable muted rows (no caller yet). When the filter is active, all branches force-expand so matches stay visible.
- [renderer/src/session/SchemaSidebar.tsx](apps/desktop/src/renderer/src/session/SchemaSidebar.tsx) — self-fetching wrapper: search input at top, manual "Refresh schema" button that calls `schema.refresh` and writes the returned snapshot straight back into the `schema.get` query cache (no extra round-trip), loading / error states with a "Try again" button, then the tree.
- [renderer/src/session/TabBar.tsx](apps/desktop/src/renderer/src/session/TabBar.tsx) — horizontal tab strip; active tab pinned with a bottom border; each tab has its own X button (stopPropagation so the X doesn't activate the tab).
- [renderer/src/session/TablePlaceholder.tsx](apps/desktop/src/renderer/src/session/TablePlaceholder.tsx) — placeholder card identifying the open tab + a notice that the real grid lands in 1.8. Also exports `EmptyTabContent` for the "no tab selected" state.
- [renderer/src/session/SessionView.tsx](apps/desktop/src/renderer/src/session/SessionView.tsx) — composes the topbar (back button + connection name + connecting-spinner), sidebar, tab strip, content area. Fires `connections.connect` exactly once per `connectionId` via the imperative tRPC client (`utils.client.*.mutate(...)`), guarded by a cancellation flag. Surfaces a destructive Alert with a "Back to connections" CTA on connect failure. Calls `connections.disconnect` (best-effort, swallows errors) when the user hits the back button.

**Files modified**

- [renderer/src/App.tsx](apps/desktop/src/renderer/src/App.tsx) — new `active: ActiveConnection | null` state. When `null` → ConnectionsView (with the new `onOpen` callback); when set → SessionView. Engine status footer hides while in session view (it's also redundant when the user is staring at live data). Theme toggle moves to `z-20` so it sits above the session view's chrome.
- [renderer/src/connections/ConnectionsView.tsx](apps/desktop/src/renderer/src/connections/ConnectionsView.tsx) — accepts `onOpen` prop and threads it down to ConnectionList. Otherwise unchanged (still owns the dialog state machine and the delete confirm).
- [renderer/src/connections/ConnectionList.tsx](apps/desktop/src/renderer/src/connections/ConnectionList.tsx) — title region is now a `<button>` that calls `onOpen(profile)`. Edit / delete buttons live next to it as siblings so their clicks don't bubble. Card gets a subtle border hover state.

**Reasoning**

- **Activation lives in SessionView, not in App.tsx or ConnectionsView.** The model "click → engine connects → engine returns identity" needs the same lifecycle as "schema query enabled when engine is active." Putting connect in SessionView pairs the lifetimes naturally: mount = connect, unmount = leave back to list (with a best-effort disconnect).
- **`utils.client.*.mutate(input)` for the connect-on-mount call**, not `useMutation`. `useMutation` returns a fresh object every render, which would either churn the effect or force an `eslint-disable` for the dep array. The imperative client (`trpc.useUtils().client`) is stable, so the effect has clean dependencies.
- **Disconnect on back-button only, not on unmount.** If the user navigates away from session view without going through the explicit back button (eg via a future "switch connection" affordance), the adapter just stays cached. The engine's `connect` is idempotent — re-activating the same id reuses the existing adapter — so this isn't a leak in the common case. We pay a small memory cost (one pool per opened connection per process lifetime) until we add explicit eviction.
- **`schema.refresh` writes directly into the `schema.get` cache via `setData`** instead of invalidating. `refresh` already returns the fresh snapshot, so `setData` skips an extra round-trip and gives the sidebar an instant rerender. If the refresh mutation fails, the cache stays at the last good snapshot.
- **Force-expand-on-filter** in `SchemaTree`. When the user types into the search box, every matching item should be visible without them having to click chevrons. Implementation: the tree has a `forceExpanded` prop the sidebar passes `true` for whenever the query is non-empty. The user's per-node expand/collapse state still persists for when they clear the filter.
- **Filter drops empty group keys.** If a schema matches via tables but has no matching views, the result's `views` key is *absent*, not `[]`. Keeps the shape clean for downstream React-key generation and matches the engine's pattern (`views?: ViewInfo[]`). Tested explicitly.
- **Tabs identified by `(kind, schema, name)`.** Opening the same item twice focuses the existing tab — no duplicate tabs for the same table. The X-button click stopPropagation prevents the close-button click from also registering as a tab-select.
- **Functions render but aren't clickable.** They surface from the engine (`SchemaInfo.functions?`) but we haven't designed what "opening" a function means yet. Showing them grayed-out documents the schema completeness without committing to a UX.
- **Plain rendering, no virtualization.** Per the prompt — even with 10 schemas × 50 tables = 500 rows, React can DOM that in <50 ms. When an adapter starts surfacing 5000+ tables we'll wire in `@tanstack/react-virtual` (already used by TanStack Table).

**Acceptance verification**

- `pnpm typecheck` workspace-wide → all four packages clean.
- `pnpm test` workspace-wide → **94 ✓** (dsl 31, engine 5, desktop 24, adapter-postgres 17, metadata-sqlite 17), 3 skipped (the docker-compose verify still gated by `VERIFY_DOCKERCOMPOSE`). The 10 new schema-filter tests fit the same vitest-discovered pattern as the Phase 1.5 form-validation tests.
- `pnpm --filter @perspectives/desktop rebuild:electron` → ✔ Rebuild Complete (so the binary is back to Electron ABI for the user's next `pnpm dev`).
- Manual flow: connect → schema sidebar populates from `schema.get` → search filters live → refresh button rewrites the cache → clicking a table opens a tab with the placeholder content → back button releases the adapter and returns to the list.

**Caveats / follow-ups**

- **No virtualized tree.** Acceptable per the prompt's guidance; `@tanstack/react-virtual` lands when a real user hits a schema large enough to feel sluggish.
- **No keyboard navigation** inside the tree (arrow keys, Enter to open). Standard tree a11y pattern; lands when we have an accessibility pass.
- **No "close all tabs" / "close others" affordance** on the tab bar — a tab right-click menu would be the natural place. Add when there's a real user need.
- **Connect-failure UX is minimal.** A destructive Alert + a back button. No "edit credentials and retry" inline path — the user has to go back and re-edit. Could integrate the connection form here later, but not in scope for the schema sidebar prompt.
- **Disconnect is best-effort.** The error path is silently swallowed because the user wants to leave regardless. If the engine ever needs to surface "disconnect failed, retry?" we'll revisit, but that's an unusual failure mode (network blip during pool drain).
- **Session view holds the tab state in-component.** Switching connections clears tabs by design. If we ever want persistence across sessions, a `settings` KV entry keyed by connection id would do it.

## 2026-06-01 — Phase 1.7: virtualized data grid

**What was done**

Built `@perspectives/desktop`'s reusable DataGrid: TanStack Table (headless) + TanStack Virtual, with type-aware cells, sort-on-header-click, column resize, sticky header, row-number gutter, cell selection with arrow-key navigation, Cmd/Ctrl+C cell copy, per-row "Copy as JSON / TSV" gutter menu, empty/loading states, and an `onReachEnd` callback for incremental loading. Built against deterministic mock data via a dev harness mounted at `#grid`. 26 unit tests for the pure formatting layer and 9 DOM tests (jsdom + @testing-library/react) for the grid itself; full workspace test count is now **103 passing + 3 skipped** (up from 94 + 3 in 1.6).

**Files created**

- [renderer/src/grid/types.ts](apps/desktop/src/renderer/src/grid/types.ts) — `DataGridColumn`, `DataGridRow`, `DataGridProps`, `SortSpec`, `SortDirection`. Small surface area on purpose.
- [renderer/src/grid/format.ts](apps/desktop/src/renderer/src/grid/format.ts) — pure formatters: `classifyCell`, `isArrayType`, `isRightAligned`, `formatTimestamp/Date/Number/Json`, `truncate`, `formatCell`, `rowToTsv`, `rowToJson`. Single source of truth for "what string does this cell display?" — the on-screen rendering and the clipboard go through the same path so WYSIWYG holds.
- [renderer/src/grid/format.test.ts](apps/desktop/src/renderer/src/grid/format.test.ts) — 26 unit tests covering pg-type classification (numeric / bool / timestamp / date / time / json / array / text / null), right-alignment rules, ISO-formatted timestamps from strings and `Date`s, bigint formatting, numeric-string formatting (pg returns `numeric` as string), cyclic-object defensiveness, TSV escaping, and JSON bigint stringification.
- [renderer/src/grid/cells.tsx](apps/desktop/src/renderer/src/grid/cells.tsx) — presentational cell renderers. `NullBadge` (muted italic "NULL"), `BooleanCell` (green check + "true" / muted dash + "false"), `JsonCell` (mono font, truncated at 80 chars, optional expand button that fires `onExpand`; modal lands in 1.9), `TextCell` with hover-title for long values, plus right-aligned `tabular-nums` for numbers / timestamps so digits don't dance.
- [renderer/src/grid/DataGrid.tsx](apps/desktop/src/renderer/src/grid/DataGrid.tsx) — the grid itself (~430 lines). Header row (sticky), body (virtualized via `useVirtualizer`), row gutter (row number + kebab → copy menu), keyboard handler (`ArrowUp/Down/Left/Right`, `Home/End`, `PageUp/PageDown`, `Cmd/Ctrl+C`). Pure `cycleSort` helper exported for unit testing.
- [renderer/src/grid/DataGrid.test.tsx](apps/desktop/src/renderer/src/grid/DataGrid.test.tsx) — 4 `cycleSort` cases + 5 DOM cases (header rendering, sort emission cycle asc→desc→null, empty message, loading skeleton, `onReachEnd` one-shot per row-count epoch). Stubs `ResizeObserver` and the layout-dimension getters so the virtualizer thinks the viewport is real.
- [renderer/src/grid/mock.ts](apps/desktop/src/renderer/src/grid/mock.ts) — deterministic seeded mock-row generator. `mulberry32(i)` ensures the same `i` always produces the same row. 10 columns spanning every supported cell kind.
- [renderer/src/grid/GridHarness.tsx](apps/desktop/src/renderer/src/grid/GridHarness.tsx) — story-style dev harness. Header bar with row count, sort indicator, `Toggle loading`, `Empty / Refill`, and `+10k rows` buttons. Reach-end appends another `PAGE_SIZE=500` rows. Footer documents the keyboard shortcuts.
- [renderer/src/grid/index.ts](apps/desktop/src/renderer/src/grid/index.ts) — barrel for the public surface.
- [vitest.config.ts](apps/desktop/vitest.config.ts) — bootstraps jsdom for `*.test.tsx` and `*.dom.test.ts`, keeps node env for plain `.test.ts`. Wires the `@/` alias and the @testing-library/jest-dom setup.
- [test/setup-dom.ts](apps/desktop/test/setup-dom.ts) — `import "@testing-library/jest-dom/vitest";` (one-liner).
- [test/vitest.d.ts](apps/desktop/test/vitest.d.ts) — augments vitest's `Assertion` with jest-dom matcher types.

**Files modified**

- [renderer/src/App.tsx](apps/desktop/src/renderer/src/App.tsx) — added `useHashRoute()` and a top-of-render check: `if (hash === "#grid") return <GridHarness />`. No effect on the normal app flow; hash-based so refresh-in-Electron survives.
- [tsconfig.json](apps/desktop/tsconfig.json) — included `test/` and `vitest.config.ts` so the jest-dom augmentation file is picked up at typecheck time.
- [package.json](apps/desktop/package.json) — added runtime deps `@tanstack/react-table ^8.21.3`, `@tanstack/react-virtual ^3.13.26`; devDeps `jsdom ^29.1.1`, `@testing-library/react ^16.3.2`, `@testing-library/jest-dom ^6.9.1`, `@testing-library/user-event ^14.6.1`, `@types/jsdom`.

**Reasoning**

- **Placement: `apps/desktop/src/renderer/src/grid/`, not `packages/ui/`.** The prompt explicitly allows either. `packages/ui` has no build pipeline, no React deps, no Tailwind wiring; setting it up before Phase 5's server consumer would be premature. The whole `grid/` directory is one `mv` away from becoming the seed of `packages/ui` when it's actually needed. The barrel (`grid/index.ts`) makes the move trivial.
- **TanStack Table for state + sizing, not for sorting or filtering.** We pass `state.columnSizing` + `onColumnSizingChange` to use its resize-handle wiring (`header.getResizeHandler()`), `enableColumnResizing`, and `columnResizeMode: "onChange"` so dragging feels live. We deliberately do *not* hand it sorting — sort is an external callback so the engine can drive a server-side ORDER BY. Same for filtering (Phase 3 territory).
- **TanStack Virtual config.** `overscan: 12` (so a quick flick doesn't reveal blank space), `estimateSize: () => rowHeight`. Single scroll container (header sticky inside it via `position: sticky`) so horizontal scroll moves header and body together. The body is an absolutely-positioned stack inside a spacer sized to `virtualizer.getTotalSize()` — the standard TanStack Virtual pattern.
- **The cell formatter is the clipboard formatter.** `formatCell()` returns a string; `<Cell>` wraps it in styled JSX. `Cmd/Ctrl+C` reads the focused cell via the same `formatCell()`. So whatever you see in the cell is what you paste — no surprise NULL → "null" vs "" ambiguity.
- **Sort cycle asc → desc → null on the same column; resets to asc on a different column.** Same as Postico / TablePlus / DataGrip. The third click should clear, not loop back to asc — otherwise there's no way to "unsort" with the mouse.
- **`onReachEnd` fires once per row-count epoch.** Tracked via a `useRef<number>` that holds the row count at last fire. New rows arriving (count grows) resets the latch automatically. Without this latch, every scroll event inside the threshold band would re-fire — a paginated fetcher would explode.
- **Cell selection lives at the grid level, not per-row.** A single `{row, col} | null` state with `useLayoutEffect` to call `virtualizer.scrollToIndex` when selection changes. Keyboard handler clamps with `Math.max(0, …)` so PageDown at the bottom doesn't underflow.
- **Row context action is a kebab in the gutter, not a right-click menu.** Right-click in Electron requires extra menu-API plumbing and surprises users used to "right click → inspect" in dev tools. Hover-revealed kebab + tiny custom popover is simpler, accessible (`aria-expanded`), and uses zero new deps. Closes on click-outside via a `mousedown` listener gated by `open`.
- **Row coloring: zebra + selection.** Odd rows get `bg-muted/20`; selected row gets `bg-accent/40`. Selected cell gets `ring-2 ring-inset ring-primary`. The composition stays readable in light and dark themes because everything is HSL token-based.
- **Clipboard with a fallback.** `navigator.clipboard.writeText()` is the modern path; some Electron contexts block it without a user gesture grant, so we fall back to the textarea + `document.execCommand("copy")` dance. Yes, `execCommand` is deprecated, but it's the only thing that works when the modern API throws permission errors inside Electron.
- **`#grid` hash-based routing for the harness.** No router needed — `useState` + `hashchange` listener is six lines. Hash-based works in Electron and the harness isn't shipping to production.
- **Format functions are deterministic + side-effect-free.** Tested via vitest in node env (no jsdom needed). DOM tests live in `.tsx` files which the `environmentMatchGlobs` maps to jsdom. Other workspace tests (router, integration, dsl, engine, postgres) stay on node.
- **`Intl.DateTimeFormat("en-CA", …)`** for timestamps. en-CA renders date parts in ISO order (`YYYY-MM-DD HH:MM:SS`) which is stable across locales and sortable as a string. We do the final assembly manually via `formatToParts()` because `format()` adds `,` or other locale glyphs between date and time.
- **`tabular-nums`** Tailwind class on numbers and timestamps so 0/1 don't have different widths in proportional fonts; column digits line up across rows.

**Acceptance verification**

- `pnpm typecheck` workspace-wide → all 4 packages clean (strict, exactOptionalPropertyTypes, no `any`).
- `pnpm test` workspace-wide → **103 ✓ + 3 skipped**: dsl 31, engine 5, desktop 59 (was 24; +35 grid tests = 26 format + 9 DataGrid), adapter-postgres 17, metadata-sqlite 17. The 3 skipped continue to be the docker-compose verify gated by `VERIFY_DOCKERCOMPOSE`.
- Native binary state at end of session: rebuilt for Electron ABI (so the next `pnpm dev` is immediate). To run `pnpm test` again, run `pnpm --filter @perspectives/desktop rebuild:node` first — same ABI dance documented in the 1.5 entry.
- Manual harness flow (browser): launch `pnpm dev`, navigate to `#grid` in the URL or via `window.location.hash = "#grid"` in devtools. Verify: sort cycle on `id` and `email` columns, column drag-resize on the right edge of headers, arrow-key navigation, Cmd+C on a cell, kebab → JSON / TSV copy, `+10k rows` scaling to 10k+ rows scrolling smoothly, loading skeleton via `Toggle loading`, empty state via `Empty`.

**Caveats / follow-ups**

- **No virtual column rendering.** Horizontal virtualization is a real concern when a table has 200+ columns. Current implementation renders all cells in the visible row regardless of horizontal viewport. Not a v1 problem; switch to `@tanstack/react-virtual` on the column axis if/when someone has a wide schema.
- **No column reordering** via drag — Phase 3 territory (perspective editor).
- **Column widths are component-local state**, not persisted. The prompt explicitly said "persist widths in component state for now"; lifting to the perspective DSL is Phase 3.
- **Selection is single-cell only.** No marquee selection, no shift-arrow extend. Real spreadsheet selection semantics are a separate prompt's worth of work.
- **`onExpand` plumbing for JSON cells exists but is unwired.** The expand button only renders if `onExpand !== undefined`; right now DataGrid never passes one. Phase 1.9's expansion modal will thread a callback from `SessionView` → DataGrid → JsonCell.
- **No real-row integration with `SessionView` yet.** `TablePlaceholder` still shows the "Grid coming soon" card. Phase 1.8 wires the tRPC paginated reader (`engine.getTablePage`) into a DataGrid mounted in place of the placeholder.
- **Clipboard fallback uses deprecated `execCommand`.** Will revisit if/when Electron makes `navigator.clipboard` reliably work without permission prompts in the renderer.
- **Vitest's CJS deprecation warning** prints on every run — same as before. Vitest 3 will silence it; we're on vitest 2.1.x because that's what the rest of the workspace targets.


## 2026-06-02 — Phase 1.8: live table view

**What was done**

Replaced the placeholder card in the table tab with a live, paginated, type-aware view. Opening a table from the schema sidebar now:

1. Issues `data.estimateTable` (fast) and shows `~9,000 rows` immediately.
2. Issues `data.getTablePage` for page 1, renders the DataGrid with column metadata from the schema snapshot.
3. Calls `fetchNextPage` from TanStack Query whenever the grid fires `onReachEnd`, appending rows.
4. Resets the page stack on sort change or page-size change.
5. Exposes a `Refresh` button that resets to page 1 and a `Exact count` button that triggers the slow `data.countTable` on demand.

Open tabs (and the active index) round-trip through the settings KV per connection, so closing and relaunching the app restores the user's session view. Total workspace tests: **120 ✓ + 3 skipped**, up from 103 + 3 in 1.7. Sixteen new tests this prompt: 9 for the `useTablePage` hook (mocked fetchers, no DB), 7 for the persisted-tabs storage shape.

**Files created**

- [renderer/src/session/useTablePage.ts](apps/desktop/src/renderer/src/session/useTablePage.ts) — the pagination + count state machine. Wraps `useInfiniteQuery` for paged rows, `useQuery` for the cheap estimate, and an on-demand `useQuery` (gated by `enabled`) for the exact count. Exposes `rows`, `serverColumns`, `fetchNext`, `refresh`, `computeExact`, `estimate`, `exact`, plus the loading/error flags. All fetchers are passed in as args so the hook is testable without tRPC.
- [renderer/src/session/useTablePage.test.tsx](apps/desktop/src/renderer/src/session/useTablePage.test.tsx) — 9 hook tests via `renderHook` from `@testing-library/react`, wrapped in a `QueryClientProvider`: initial-load, append-with-cursor-forwarding, stops at last page, estimate fetched alongside, exact gated on user action, refresh clears pages, exact latch resets on key change, error propagation, and `enabled: false` defers fetches.
- [renderer/src/session/TableView.tsx](apps/desktop/src/renderer/src/session/TableView.tsx) — the table-tab UI: header bar (qualified table name, count display, loaded-rows indicator, exact-count + refresh buttons, page-size selector) + `<DataGrid>` configured with schema-derived columns and the hook's state. Sort state is local; sort changes invalidate the keyset by participating in the query key.
- [renderer/src/session/tabs-storage.ts](apps/desktop/src/renderer/src/session/tabs-storage.ts) — `persistedTabsKey(connectionId)` + a Zod-guarded `loadPersistedTabs(raw)` that returns `null` for missing/malformed payloads and clamps `activeIndex` into range. Versioned (`v: 1`) so older payloads can be ignored on the next bump.
- [renderer/src/session/tabs-storage.test.ts](apps/desktop/src/renderer/src/session/tabs-storage.test.ts) — 7 unit tests covering nulls, version mismatch, garbage, out-of-range index clamping, empty tabs case, and the wrapper.
- [main/trpc/routers/settings.ts](apps/desktop/src/main/trpc/routers/settings.ts) — new `settings.get` / `settings.set` router with a defensive key validator (no whitespace / control chars). Values are `z.unknown()` — the renderer parses per-key.

**Files modified**

- [packages/engine/src/service.ts](packages/engine/src/service.ts) — two thin pass-throughs: `getSetting<T>(key)` / `setSetting<T>(key, value)` over the metadata store's KV. Engine never interprets the values.
- [main/trpc/router.ts](apps/desktop/src/main/trpc/router.ts) — wires the new settings sub-router under `settings`.
- [renderer/src/session/SessionView.tsx](apps/desktop/src/renderer/src/session/SessionView.tsx) — new `restored` latch + two effects: one to load `settings.get` once per connectionId and seed `tabs`/`activeTabIndex`, the other to write through every change post-restore. Active tab now dispatches between `<TableView>` (kind: "table") and `<TablePlaceholder>` (kind: "view") so the placeholder remains the home for views until Phase 3 makes them queryable.
- [apps/desktop/test/integration.test.ts](apps/desktop/test/integration.test.ts) — extended the full-stack test with a settings round-trip step that persists and reads back an `OpenTab`-shaped payload over real tRPC + sqlite.

**Reasoning**

- **Why a hand-rolled hook over `trpc.data.getTablePage.useInfiniteQuery` directly:** the tRPC-flavored useInfiniteQuery wants a `cursor` field on the input and infers some types from the procedure, but it also makes mocking harder — tests would need an `httpLink` mock or a full `createTRPCMsw` setup. With a plain `useInfiniteQuery` whose `queryFn` calls injected fetchers, the test is a straight `renderHook` against `vi.fn()` returners. Result: zero tRPC plumbing in the test, identical TanStack semantics in production.
- **Query key shape: `["tablePage", connectionId, schema, table, sortDefs, pageSize]`.** Any change here resets pagination automatically — TanStack Query treats it as a new query. The hook adds a `"tablePage"`/`"tableEstimate"`/`"tableCount"` prefix so the three queries don't collide.
- **`keyHash` via `JSON.stringify(queryKey)`.** The exact-count latch needs to detect *value* changes to the query key, not identity. Callers (and tests) often pass an inline array — identity changes every render. JSON.stringify normalises that for the equality check.
- **Refresh = `qc.resetQueries(...)`**, not `pages.refetch()`. `refetch()` re-fetches every loaded page, so a user who'd scrolled to page 5 would see all 5 pages refresh in place. `resetQueries` clears the cache back to page 1 and the active observer subscription triggers an immediate refetch — the user lands at the top.
- **Exact count is opt-in.** It's an O(table) `COUNT(*)` on Postgres — running it eagerly on every open would punish anyone with a 100M-row audit table. `useQuery({enabled: enabled && exactRequested})` keeps it dormant until the button is clicked. The latch resets on key change so a stale "exactly 9,217" doesn't linger after the user filters or re-sorts.
- **`refetchOnWindowFocus: false` + `staleTime: Infinity` on the pages query.** A keyset cursor is anchored to the snapshot it was emitted from. If the window-focus refetch kicked in between page 3 and page 4, the cursor for "after row 300" could lie. The user must invoke Refresh deliberately.
- **`enabled: tableInfo !== undefined`.** While the schema query is still loading, we don't yet know the column shape, so no point asking for rows. Once the schema arrives and we find the table, the hook flips on and the row fetch fires.
- **Settings persistence is per-connection + versioned.** Key shape `session:<connId>:tabs.v1` namespaces by both connection and schema version. The loader is strict (Zod-parsed, version-pinned) and returns `null` instead of throwing on bad data — so users who hand-edit or update across an incompatible schema bump get a fresh empty session, not an exception.
- **Restore latch (`restored: boolean`).** Without it, the write-on-change effect runs on the initial empty state *before* the restore round-trip completes, and clobbers the persisted payload. The latch makes the write strictly downstream of the read.
- **Reset state across `connectionId` changes.** When the user navigates Connection A → list → Connection B, the SessionView component re-runs the restore effect with B's id. We also explicitly reset `tabs`/`activeIndex` to empty so that if B's persisted payload is missing, B doesn't inherit A's tabs visually.
- **Views still go to TablePlaceholder.** The engine's `getTablePage` lookup only consults `SchemaInfo.tables`, not `views`, so wiring views into TableView would 404. Views land in Phase 3 when SQL-base perspectives + schema-derived view introspection plug together. For now `kind: "view"` opens the same placeholder card as before.
- **Settings router accepts `z.unknown()` for values.** The KV is JSON-typed; per-key shape validation belongs in the consumer (here, `loadPersistedTabs`). Forcing a single shape at the router would force every consumer through the same payload union.
- **Column metadata sourced from the schema snapshot (cached), not from PageResult.** The schema is cheap and already loaded by the sidebar; PageResult.columns arrives only after the first fetch. Using the schema lets the grid render its loading skeleton with the correct column shape *during* the first fetch, not after.

**Acceptance verification**

- `pnpm typecheck` workspace-wide → all 4 packages with typecheck scripts clean (strict, exactOptionalPropertyTypes).
- `pnpm test` workspace-wide → **120 ✓ + 3 skipped**: dsl 31, engine 5, desktop 75 (was 59; +16 = 9 useTablePage + 7 tabs-storage), adapter-postgres 17, metadata-sqlite 17. The 3 skipped continue to be the docker-compose verify gated by `VERIFY_DOCKERCOMPOSE`. The full-stack integration test now also exercises the new settings router.
- Native binary state at end of session: rebuilt for Electron ABI so the next `pnpm dev` is immediate. As before, run `pnpm --filter @perspectives/desktop rebuild:node` before `pnpm test`.
- Manual run: `pnpm dev`, click a saved connection, click a table in the sidebar. Expect: header shows `~<N> rows • N loaded`; the grid populates within ~200 ms; scrolling near the bottom appends another `pageSize` rows; clicking a header cycles sort + resets pagination; changing the page-size selector resets pagination; clicking Exact count replaces the `~` with the precise number; clicking Refresh wipes back to page 1; opening a second table opens a second tab; closing the app and relaunching restores the same tabs + active tab.

**Caveats / follow-ups**

- **Views are still placeholders.** Requires either (a) extending `findTable` in `EngineService.getTablePage` to also consult `SchemaInfo.views[]`, or (b) waiting for Phase 3 to handle SQL-base perspectives properly. Pick (a) if user feedback shows views are commonly browsed; defer otherwise.
- **No cell-expand modal** — phase 1.9.
- **No active-row preservation across refresh.** After Refresh the user lands at the top of page 1. If the user had scrolled to row 7,000, that position is lost. Could be improved by re-issuing the same cursor stack after refresh, but the user explicitly asked for "refetches from the first page" so this is on-spec.
- **No per-table page-size persistence.** The page-size selector resets to 100 every time a tab is reopened. Could be persisted under another settings key if user feedback says it's annoying.
- **Persisted-tabs payload is unbounded by total size** — the loader caps `tabs.length` at 64 via Zod, but doesn't enforce a byte limit. At realistic schema/table name lengths, 64 × 600 bytes ≈ 38 KB. Fine.
- **The grid runs against the schema columns, not the PageResult columns.** If a table has 100 columns and the query selects all of them, both lists match. When perspectives in Phase 3 start projecting subsets, we'll switch the grid's columns prop to `pageState.serverColumns` (which mirrors what the engine actually returned).
- **Settings router doesn't expose `delete` or `keys()` yet.** Add when there's a renderer caller that needs them.
- **Exact-count and refresh share the loading indicator** in the header but not on the grid body — the grid keeps showing its current rows while the refresh refetches. A flash of empty between reset and first-page-arrived is theoretically possible but in practice the round-trip completes in <50 ms on a dev Postgres.


## 2026-06-02 — Phase 1.9: cell detail view

**What was done**

Added a modal cell-detail view that opens from any grid cell, surfaced through three triggers: (a) the existing JSON/array expand affordance now actually opens a dialog instead of being a placeholder, (b) a new Maximize2 button on long-text and bytea cells, and (c) pressing Enter (or Space) on a focused cell while the grid has keyboard focus. The dialog renders per-kind:

- **text** → wrapped, scrollable `<pre>` so multi-paragraph values survive.
- **json/array** → recursive `JsonTree` with per-node disclosure; arrays show numbered indices, objects show keys; first two depths expanded by default.
- **bytes** → human note (`Binary data — N bytes…`) plus a hex dump of the first 256 bytes. Raw bytes never reach the screen as mojibake.
- **null / boolean / number / date / time / timestamp** → simple `<pre>` with the formatted value.

Plus a *Copy raw* button at the footer that round-trips through the existing clipboard helper. Read-only this phase — no editing affordances. Total workspace tests: **131 ✓ + 3 skipped** (up from 120 + 3 in 1.8). Twenty-six new tests this prompt: 9 cell-format additions covering the `bytes` kind, 8 JsonTree DOM, 9 CellDetail DOM.

**Files created**

- [renderer/src/grid/CellDetail.tsx](apps/desktop/src/renderer/src/grid/CellDetail.tsx) — the dialog. `CellDetailDialog({ target, onClose })` opens when `target !== null`; the body dispatches per-kind. `CopyButton` does a feedback flash on success. `rawForClipboard()` decides what string lands on the clipboard for each kind (verbatim for text, JSON for structured, summary + hex for bytes, formatted scalar otherwise).
- [renderer/src/grid/JsonTree.tsx](apps/desktop/src/renderer/src/grid/JsonTree.tsx) — recursive, per-node collapsible. Primitives leaves: numbers blue, booleans amber, strings emerald, null muted italic. Composites get a Chevron disclosure button; `initiallyExpandedDepth` (default 2) seeds the open state; user overrides persist per-node via local state. Empty composites render as `[ ]` / `{ }`.
- [renderer/src/grid/CellDetail.test.tsx](apps/desktop/src/renderer/src/grid/CellDetail.test.tsx) — 9 DOM tests: null cell, long text, JSON object, JSON-string parsing (for drivers that return jsonb as a string), bytea note + hex, copy verbatim for text, copy JSON for structured, footer Close → onClose, hidden when target is null.
- [renderer/src/grid/JsonTree.test.tsx](apps/desktop/src/renderer/src/grid/JsonTree.test.tsx) — 8 DOM tests: primitives, strings double-quoted, null italic, default expansion, depth-bounded collapse, toggle, array item-count summary when collapsed, empty composite literals.

**Files modified**

- [renderer/src/grid/format.ts](apps/desktop/src/renderer/src/grid/format.ts) — added the `bytes` cell kind, `isBinary()`, `bytesLength()`, `bytesPreview()`, `formatBytesSummary()`, the `BYTES_TYPES` Set, and a new branch in `classifyCell` that wins over dbType when the *value* is a `Uint8Array`/`ArrayBuffer`. `formatCell` now emits `<bytea, N bytes>` for binary values instead of letting `String(uint8array)` produce comma-joined byte numbers.
- [renderer/src/grid/format.test.ts](apps/desktop/src/renderer/src/grid/format.test.ts) — 9 new tests for the bytes kind: classify by value vs dbType, isBinary, bytesLength, bytesPreview truncation + hex casing, `<bytea, …>` formatting in `formatCell`.
- [renderer/src/grid/cells.tsx](apps/desktop/src/renderer/src/grid/cells.tsx) — extracted a shared `ExpandButton`. `TextCell` now takes an optional `onExpand` and shows the button if length > 80. `BytesCell` is new (Binary icon + length label + always-visible expand button). `JsonCell` shows the expand button whenever the value is composite, not just when the inline string was truncated — a 2-key object that fits inline is still worth inspecting.
- [renderer/src/grid/DataGrid.tsx](apps/desktop/src/renderer/src/grid/DataGrid.tsx) — new `onExpandCell?: (col, value) => void` prop. The grid threads it down to every cell as a per-cell expand thunk; the keyboard handler treats Enter and Space as "expand the focused cell"; double-click on a cell also expands. Threaded through `Body` → `BodyRow`.
- [renderer/src/grid/types.ts](apps/desktop/src/renderer/src/grid/types.ts) — `onExpandCell` added to `DataGridProps`.
- [renderer/src/grid/mock.ts](apps/desktop/src/renderer/src/grid/mock.ts) — mock data gains a `bio` (varying-length text) column and an `avatar` (`bytea` Uint8Array) column so the harness exercises every renderer branch. Mock JSON now includes a small `history` array so the tree shows arrays-of-objects.
- [renderer/src/grid/GridHarness.tsx](apps/desktop/src/renderer/src/grid/GridHarness.tsx) — wires `onExpandCell` so the harness mounts the dialog the same way TableView does. Footer caption updated to mention Enter and the inspect affordance.
- [renderer/src/session/TableView.tsx](apps/desktop/src/renderer/src/session/TableView.tsx) — local `detailTarget` state; renders `<CellDetailDialog>` next to the grid; `onExpandCell` builds the `{label, dbType, value}` payload from the column.

**Reasoning**

- **One trigger surface for all expansion paths.** All three entry points (cell button, keyboard, double-click) funnel into the same `onExpandCell(col, value)` callback — caller decides what to render. The grid stays pure presentation: it never owns the modal.
- **Modal, not side panel.** The side panel would compete for horizontal space with the schema sidebar already on the left, and Phase 4's form view will probably want the side-panel slot. A modal is also less of a behavioural change vs the user's current scrolling/sort cadence — it doesn't reflow anything underneath.
- **Enter + Space both expand.** Enter pairs naturally with arrow-key navigation; Space is what spreadsheet users reach for. Both pre-default so they don't accidentally scroll the grid or activate browser shortcuts.
- **JsonTree initiallyExpandedDepth=2.** Most pg JSONB cells are flat objects with maybe one nested array. Two levels means "everything visible by default for typical shapes; nested arrays-of-objects collapse cleanly." Easy to override per-call.
- **JsonTree handles JSON-string drivers.** Some pg drivers return JSONB as native objects, some return it as a string. `parseIfString` in `CellDetail.tsx` tries to parse a string that starts with `{`/`[`; if parsing fails the original string is shown — so a non-JSON text column accidentally classified as JSON still renders meaningfully.
- **Bytes never lands on the screen as raw bytes.** `formatCell` short-circuits to a length summary. The detail view shows a length-bytes note + first-256-byte hex dump. Round-tripping a Uint8Array through `JSON.stringify` would have produced `{"0":222,"1":173,...}` which is the wrong kind of "what you see is what you copy."
- **`bytesPreview` over `Buffer.toString('hex')`.** Browsers don't have `Buffer`, so the renderer can't reach for it. A pure-Uint8Array loop with `padStart(2, "0")` keeps it portable and small.
- **Expand affordance shown even on JSON cells that fit inline.** If the rendered string is short, the user can still want the structured tree view. Composite values always get the button.
- **`Maximize2` icon for the affordance.** Consistent with the JSON cell from Phase 1.7 — same glyph keeps the meaning predictable. Bytes also uses always-visible (rather than hover-only) because the cell content alone (`bytea 1,024 B`) doesn't hint at "click to see more."
- **Copy raw on the dialog mirrors the format chosen for rendering.** A user copying from a JSON-tree dialog expects to paste JSON, not `[object Object]`. A user copying from a text dialog expects the verbatim string. The single `rawForClipboard()` helper centralises that choice.
- **Footer copy + close pair.** Both buttons in the same footer so the user doesn't lose mouse position; Radix's built-in X close in the corner stays for keyboard-driven dismissal.
- **No editing affordances.** Phase 1.9's scope is read-only. The dialog doesn't surface any input fields, and the data flow (grid → expand callback → modal → state) doesn't have a write path. When inline editing lands in Phase 4 we'll likely repurpose this modal as the per-row form panel.

**Acceptance verification**

- `pnpm typecheck` workspace-wide → all 4 packages clean.
- `pnpm test` workspace-wide → **131 ✓ + 3 skipped**: dsl 31, engine 5, desktop 101 (was 75; +26 = 9 format + 8 JsonTree + 9 CellDetail), adapter-postgres 17, metadata-sqlite 17.
- Native binary state at end of session: rebuilt for Electron ABI so the next `pnpm dev` is immediate.
- Manual run (Electron, table tab): open a customer row's `addresses` JSONB column → Maximize2 button → tree shows nested objects, click chevrons to drill down, Copy raw → JSON pastes. Focus a long-text cell, press Enter → wrapped scrollable preview. Open a bytea cell (would require a bytea column in your DB) → "Binary data — N bytes" + hex dump.
- Manual run (`#grid` harness): the new `bio` column has long values for some rows — hover, click Maximize2 → wrapped preview. `avatar` column shows `bytea N B` → Enter opens hex dump. `meta` column with the new `history` array shows arrays-of-objects in the tree.

**Caveats / follow-ups**

- **No keyboard shortcuts to navigate inside the tree** — Tab navigates between disclosure buttons (browser default) but no Right/Left arrow to expand/collapse. Fine for v1; can add when there's a real screen-reader pass.
- **`bytesPreview` is fixed at 256 bytes** — for the v1 read-only inspector this is enough to spot signatures (PNG header, ZIP magic). A "show more" affordance can land when someone files a real complaint.
- **Hex dump is rendered as a single wrapped line, not a column with offsets**. A two-column `offset | bytes | ascii` view would be nicer but is hard to make responsive within the dialog width. The current pre wraps with `break-all` so even very long blobs are scrollable.
- **The JSON tree is not virtualized.** A 10k-key object would blow up the DOM. In practice JSONB cells in user data are small (< 100 keys), but if someone hits a giant payload we'll need a switch to "expand on demand" for large composites.
- **JsonTree colors are hard-coded blue/amber/emerald.** Works on both light and dark via the `dark:` variants but doesn't go through the theme tokens. A token-based palette is a bigger refactor than this phase warrants.
- **The radix Dialog has both a built-in X close and our footer Close button.** Two buttons for the same action is technically redundant but matches the standard shadcn pattern, and screen readers see the X as "Close" via the sr-only span. Test had to disambiguate; that's the only friction.
- **No "Open in new tab" for FK-like values.** Phase 2 will introduce navigation, at which point the modal grows a "Go to row" affordance for FK-typed cells.


## 2026-06-02 — Phase 1.10: SQL console

**What was done**

Added a SQL-console tab kind alongside table/view. A new `data.runReadOnlySql` engine + tRPC method runs the user's raw SQL inside a `BEGIN TRANSACTION READ ONLY` / `ROLLBACK` envelope — any write attempt fails at the database level with SQLSTATE 25006, mapped to `ValidationError`. The console UI is CodeMirror 6 + `@codemirror/lang-sql` (PostgreSQL dialect) with autocomplete pre-loaded from the active connection's schema snapshot. Cmd/Ctrl+Enter runs (Run button mirrors it); results render in the existing DataGrid using column metadata from the result's field OIDs; the header shows row count + execution time; errors surface in a destructive Alert. Local query history (last 50, dedup-move-to-front) persists per connection through the same settings KV that holds open tabs. Total workspace tests: **189 ✓ + 3 skipped**, up from 131 + 3 in 1.9.

**Files created**

- [packages/adapter-postgres/src/adapter.ts](packages/adapter-postgres/src/adapter.ts) — new `runReadOnlySql(sql)` method. Acquires a dedicated client (the BEGIN/ROLLBACK pair has to stay on the same session), runs `BEGIN TRANSACTION READ ONLY`, then the user's SQL, then `ROLLBACK`. Failures inside the txn get a rolled-back-and-mapped error path; success still ROLLBACKs (no COMMIT needed and it neutralises any `SET LOCAL` side effects).
- [apps/desktop/src/main/trpc/routers/data.ts](apps/desktop/src/main/trpc/routers/data.ts) — new mutation `data.runReadOnlySql`, declared as a *mutation* (not query) so React Query never caches it; each click runs fresh.
- [apps/desktop/src/main/trpc/inputs.ts](apps/desktop/src/main/trpc/inputs.ts) — `runReadOnlySqlInputSchema` with a 1 MiB SQL ceiling.
- [apps/desktop/src/renderer/src/session/SqlConsoleView.tsx](apps/desktop/src/renderer/src/session/SqlConsoleView.tsx) — the console component (~330 lines). Editor + Run button + status bar + collapsible History sidebar + DataGrid results + CellDetail wiring (reused from 1.9). `Mod-Enter` keymap inside CodeMirror plus a window-level fallback so the shortcut works even if the editor swallows the keydown.
- [apps/desktop/src/renderer/src/session/sql-completion.ts](apps/desktop/src/renderer/src/session/sql-completion.ts) — `buildSqlSchemaMap(snapshot)` flattens a `SchemaSnapshot` into the `{tableName: [columns]}` shape `@codemirror/lang-sql` consumes. Emits both `schema.table` and bare `table` forms; the bare form is dropped when the table name is ambiguous across schemas.
- [apps/desktop/src/renderer/src/session/sql-history.ts](apps/desktop/src/renderer/src/session/sql-history.ts) — `pushHistory(prev, sql)` (move-to-front, dedupe, cap at 50), `sqlHistoryKey(connectionId)`, Zod-validated load/save.
- [apps/desktop/src/renderer/src/session/sql-history.test.ts](apps/desktop/src/renderer/src/session/sql-history.test.ts) — 8 unit tests covering namespacing, malformed payload tolerance, payload truncation to MAX_HISTORY, dedup-move-to-front, whitespace handling, cap enforcement.
- [apps/desktop/src/renderer/src/session/sql-completion.test.ts](apps/desktop/src/renderer/src/session/sql-completion.test.ts) — 3 unit tests covering empty-snapshot, schema-qualified entries, and bare-name disambiguation when the same table exists in two schemas.

**Files modified**

- [packages/engine/src/adapter.ts](packages/engine/src/adapter.ts) — added `runReadOnlySql(sql)` to the `DatabaseAdapter` interface.
- [packages/engine/src/service.ts](packages/engine/src/service.ts) — added `EngineService.runReadOnlyQuery(connectionId, sql)` as a thin delegate.
- [packages/adapter-postgres/src/errors.ts](packages/adapter-postgres/src/errors.ts) — `25006` (`read_only_sql_transaction`) now maps to `ValidationError` rather than the catch-all `ConnectionError`. Users see "cannot execute UPDATE in a read-only transaction" verbatim.
- [packages/adapter-postgres/test/runtime.test.ts](packages/adapter-postgres/test/runtime.test.ts) — 5 new tests: SELECT returns rows + column metadata, UPDATE rejected with read-only error, CREATE TABLE rejected with read-only error, session GUC rolled back even on success, syntax error mapped to ValidationError.
- [apps/desktop/test/integration.test.ts](apps/desktop/test/integration.test.ts) — extended the full-stack test to call `caller.data.runReadOnlySql` for both a SELECT success path and an UPDATE rejection through real tRPC + real adapter + real Postgres.
- [renderer/src/session/types.ts](apps/desktop/src/renderer/src/session/types.ts) — `OpenTab` is now a discriminated union of `table` / `view` / `sql`. SQL tabs identify by stable per-tab `id` (so multiple consoles can coexist) and carry a `title` for the tab strip.
- [renderer/src/session/tabs-storage.ts](apps/desktop/src/renderer/src/session/tabs-storage.ts) — Zod schema is now a `discriminatedUnion`; SQL variant requires `{id, title}`. The persistence version stays at v1 because existing v1 payloads (table/view only) still parse against the new union.
- [renderer/src/session/tabs-storage.test.ts](apps/desktop/src/renderer/src/session/tabs-storage.test.ts) — 2 new tests for the SQL variant: accept valid SQL tab in the round-trip, reject SQL payload missing `id`.
- [renderer/src/session/TabBar.tsx](apps/desktop/src/renderer/src/session/TabBar.tsx) — tab-strip now picks icon + label by kind. SQL tabs render the `FileCode2` icon and the `title` field (no schema prefix); table/view tabs unchanged.
- [renderer/src/session/SessionView.tsx](apps/desktop/src/renderer/src/session/SessionView.tsx) — new `openSqlConsole()` callback emits a new tab with an id like `sql-<base36-ts>-<count>` and a title like `SQL N`. Topbar gains a "New SQL" button (visible only when connected). Tab dispatch grows a `sql` branch that mounts `<SqlConsoleView>`.
- [renderer/src/session/TablePlaceholder.tsx](apps/desktop/src/renderer/src/session/TablePlaceholder.tsx) — prop type narrowed to `Extract<OpenTab, {kind: "table"|"view"}>` so the typechecker forbids passing a `sql` tab (a static guarantee that this fallback path never receives one).
- [apps/desktop/package.json](apps/desktop/package.json) — added `@uiw/react-codemirror`, `@codemirror/lang-sql`, `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`.

**Reasoning**

- **Database-level read-only enforcement is the only correct choice.** Parsing SQL to spot writes is a footgun: comment trickery, CTEs that hide INSERTs in `WITH ... AS (INSERT ...)`, function calls that mutate, custom triggers — there's always one more vector. `BEGIN TRANSACTION READ ONLY` is enforced by Postgres itself with no escape. Even DDL fails inside it. Tests cover UPDATE *and* CREATE TABLE to make the point that the rule isn't statement-aware.
- **Dedicated client, not the pool's auto-commit.** A `BEGIN`+`COMMIT` pair has to land on the same session. `pool.query()` doesn't guarantee that; `pool.connect()` does. We `release()` in `finally` so the client always returns.
- **ROLLBACK on success too.** Even though no writes happened, a `SET LOCAL` inside the user's SQL would survive a COMMIT. ROLLBACK is symmetric — it discards both writes and session-local GUCs — and a read-only txn has nothing to gain from a COMMIT. The 4th adapter test verifies this explicitly with a `SET LOCAL search_path` followed by a `SHOW search_path` probe.
- **Mutation, not query, in tRPC.** `data.runReadOnlySql` is *technically* a read, but treating it as a mutation makes React Query do the right thing: no cache, no background refetch, no `staleTime` math. Each Run is a deliberate user action.
- **`runReadOnlySql` is named to match its semantics, not its execution layer.** The engine's method is `runReadOnlyQuery` (consumer-facing) and the adapter method is `runReadOnlySql` (because the adapter is dialect-specific and that's the layer where "SQL" is the right word). The naming distinction matches the existing `runQuery` (typed-plan) vs `runSql` (raw) split.
- **CodeMirror 6 via `@uiw/react-codemirror`.** The wrapper handles the React lifecycle around CodeMirror's imperative DOM correctly; rolling our own would be ~80 lines of `useEffect` glue. Plus the existing `@codemirror/lang-sql` plug-and-play for the schema-completion `schema` prop.
- **Autocomplete payload: bare names dropped on collision.** Two schemas with the same table name (a real situation — `audit.customers` vs `public.customers`) would otherwise let the completer pick the wrong column set silently. Dropping the bare name forces the user to write `public.customers`, which the completer can then service from the qualified entry.
- **History as a per-connection setting, not per-tab.** Re-creating the same query across SQL tabs is the common case (try a query in one tab, paste into another to compare). Connection-scope keeps history useful across tab churn.
- **History dedupes with move-to-front.** Re-running the same query 50× would otherwise push everything else out. Move-to-front keeps the last-run query at the top but doesn't multiply it.
- **History on success only.** Failed queries go to error display but not to history — a typo gets discarded the moment it's fixed.
- **`pushHistory` is a pure function.** Testable without React, without tRPC. Move-to-front + cap + whitespace-trim are all covered by 8 unit tests.
- **Single window-level `Mod-Enter` listener as a safety net.** CodeMirror's keymap is the primary path; the window listener catches the case where the editor's DOM swallows the keydown (it shouldn't, but safer than hunting an edge case).
- **`pgOidToTypeName` already covers what the grid needs.** The grid's `classifyCell` only cares about coarse buckets — number / bool / timestamp / json / array / bytes / text. The existing OID mapping is enough; we don't need to expand it for the console.
- **Tabs persist by id, including SQL tabs.** Restarting the app brings back the user's SQL tabs (titles preserved); editor content is *not* yet persisted — that's a Phase 3 nice-to-have when perspectives become the persistence boundary anyway.
- **No SqlConsoleView DOM smoke test.** Wiring tRPC + React Query + CodeMirror under jsdom is more flake than value. The adapter test (run against the real seeded container) covers the security-critical read-only enforcement; the pure helpers cover the data path. If a UI regression slips through, the manual flow surfaces it immediately.

**Acceptance verification**

- `pnpm typecheck` workspace-wide → all 4 packages with typecheck scripts clean.
- `pnpm test` workspace-wide → **189 ✓ + 3 skipped**: dsl 31, engine 5, desktop 114 (was 101; +13 = 8 sql-history + 3 sql-completion + 2 tabs-storage sql variant), adapter-postgres 22 (was 17; +5 SQL console enforcement), metadata-sqlite 17.
- Adapter test against the seeded container directly confirms: `SELECT id, country_code FROM customers ORDER BY id LIMIT 3` returns 3 rows with `id` typed as `int8`; `UPDATE customers SET country_code = 'XX' WHERE id = 1` throws with `/read-only/i`; `CREATE TABLE ...` throws with `/read-only/i`; a `SET LOCAL search_path` is undone after the transaction rolls back; a syntax error (`SLECT garbage ...`) surfaces as a ValidationError matching `/syntax/i`.
- Integration test through real tRPC: `caller.data.runReadOnlySql` returns the SELECT's rows and rejects the UPDATE with the read-only error.
- Native binary state at end of session: rebuilt for Electron ABI so the next `pnpm dev` is immediate.
- Manual run: `pnpm dev`, open a connection, click "New SQL" in the topbar. Paste `SELECT * FROM customers LIMIT 10` → Cmd+Enter → grid populates within ~200 ms; "10 rows · 12 ms" in the header. Type `UPDATE customers SET name = 'x'` → Cmd+Enter → red Alert: "cannot execute UPDATE in a read-only transaction". Type a table name → suggestions appear from the active schema. Open the History sidebar → previous queries listed; click one → editor reloads. Quit + relaunch → SQL tabs persist with their titles; history persists per connection.

**Caveats / follow-ups**

- **Editor content is not persisted.** Closing a SQL tab loses its draft. Save-draft-per-tab is a small follow-up (one settings key per `sql:<id>`), but skipped this phase to keep scope tight.
- **No multi-statement support.** `pg` returns only the *last* statement's rows for a semicolon-delimited script via `client.query()`. The console currently runs whatever the user types as a single block — Postgres still executes all statements, but only the last result set surfaces in the grid. A "split on `;`, run sequentially, show rows from the last SELECT" pass would be a polish iteration.
- **No statement-cancellation.** A long-running SELECT can't be aborted from the UI. `pg_cancel_backend(pid)` on the session's PID would do it; the current `runReadOnlySql` swallows the PID after release. Add when there's a real complaint.
- **History clears across versions.** When `HISTORY_VERSION` bumps, the old payload falls through to the empty-state. Acceptable for v1; an "import legacy history" step is a follow-up only if user data warrants it.
- **CodeMirror's default light theme only.** No dark-mode variant wired yet. The rest of the app theme-switches via the `dark` class on `<html>`; CodeMirror has its own theme system. Use `@uiw/codemirror-theme-tokyo-night` (or similar) when polishing.
- **Autocomplete shows every table, not the ones referenced in the current query.** That's the default `@codemirror/lang-sql` behavior; a context-aware completer (FROM/JOIN parser) is a much larger lift.
- **No "EXPLAIN" affordance.** A button to run the current query under `EXPLAIN ANALYZE` would be the natural follow-up; it would still go through `runReadOnlySql` (EXPLAIN is read-only) but want a side-panel renderer for the plan tree. Out of scope this phase.

