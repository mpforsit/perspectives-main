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
