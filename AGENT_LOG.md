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


## 2026-06-10 — Audit remediation: immediate fixes from AUDIT-CODEX.md

**What was done**

Implemented the four "Immediate" items from the Codex security audit:

1. **SSL/SSH secret leak guard** — refused secret-bearing fields at both the IPC schema boundary and the SQLite writer, with paired leak-guard tests.
2. **Electron URL hardening** — `ELECTRON_RENDERER_URL` is honored only in unpackaged runs against a loopback HTTP origin; `setWindowOpenHandler` and `will-navigate` only forward `http`/`https` to `shell.openExternal`. Pure URL helpers were extracted into [apps/desktop/src/main/url-policy.ts](apps/desktop/src/main/url-policy.ts) for unit testing.
3. **Real lint scripts + zero-task guard** — added `lint`/`typecheck` scripts to every source-bearing package and a CI step that fails when Turbo runs zero lint tasks.
4. **Dependency upgrades + audit gate** — bumped Electron, electron-builder, electron-vite, vite, vitest, testcontainers, and @electron/rebuild past the patched ranges. `pnpm audit` now reports zero advisories; CI fails at `--audit-level=high`.

**Files created**

- [apps/desktop/src/main/url-policy.ts](apps/desktop/src/main/url-policy.ts) — pure URL helpers (`resolveDevServerUrl`, `isAllowedExternalUrl`).
- [apps/desktop/test/inputs.test.ts](apps/desktop/test/inputs.test.ts) — 7 IPC-boundary leak-guard tests for `connectionProfileSchema`.
- [apps/desktop/test/url-policy.test.ts](apps/desktop/test/url-policy.test.ts) — 23 unit tests covering the threat-model corner cases (packaged launches, non-loopback hosts, exotic protocols).

**Files modified**

- [apps/desktop/src/main/index.ts](apps/desktop/src/main/index.ts) — wired the new URL policy and added a `will-navigate` deny-by-default.
- [apps/desktop/src/main/trpc/inputs.ts](apps/desktop/src/main/trpc/inputs.ts) — `sslOptionsSchema` is `.strict()` and no longer accepts `clientKey`; `sshTunnelOptionsSchema` is a `.refine(() => false, …)` so the inferred type still matches the engine's `SshTunnelOptions` but every runtime payload is rejected.
- [packages/metadata-sqlite/src/connections.ts](packages/metadata-sqlite/src/connections.ts) — `validateProfileShape` rejects `ssl.clientKey` and any `sshTunnel` block (defense in depth against the IPC schema).
- [packages/metadata-sqlite/src/migrations/0001_initial.sql](packages/metadata-sqlite/src/migrations/0001_initial.sql) — comment updated to reflect the writer-side enforcement.
- [packages/metadata-sqlite/test/credentials.test.ts](packages/metadata-sqlite/test/credentials.test.ts) — added 4 leak-guard tests parametrised over `ssl.clientKey`, `sshTunnel.password`, `sshTunnel.privateKey`, `sshTunnel.passphrase` (the audit's recommended fix wording).
- [apps/desktop/package.json](apps/desktop/package.json) — bumped Electron `~41.0.0 → ^41.7.1`, `@electron/rebuild ^3.7.1 → ^4.0.4`, `electron-builder ^25.1.8 → ^26.15.2` (+ explicit `electron-builder-squirrel-windows ^26.15.2`), `electron-vite ^2.3.0 → ^5.0.0`, `vite ^5.4.11 → ^7.0.0`, `vitest ^2.1.9 → ^4.1.8`, `testcontainers`/`@testcontainers/postgresql ^10.13.2 → ^12.0.1`. Added `lint` script.
- [packages/{dsl,engine,adapter-postgres,metadata-sqlite}/package.json](packages/) — added `lint` script (and `typecheck` where missing); bumped vitest/testcontainers to match.
- [package.json](package.json) — added `"type": "module"` (silences the ESLint flat-config warning), and a `pnpm.overrides` entry forcing `electron-builder-squirrel-windows ^26.15.2` to break the old transitive `tar@6.x` chain.
- [apps/desktop/vitest.config.ts](apps/desktop/vitest.config.ts) — Vitest 4 removed `environmentMatchGlobs`; the four `.tsx` component tests now carry a `// @vitest-environment jsdom` pragma at the top.
- [apps/desktop/src/renderer/src/session/useTablePage.test.tsx](apps/desktop/src/renderer/src/session/useTablePage.test.tsx) — `Mock<TFn>` typings replace `ReturnType<typeof vi.fn>` (Vitest 4 generic shape).
- [apps/desktop/src/main/trpc/router.ts](apps/desktop/src/main/trpc/router.ts), [apps/desktop/test/vitest.d.ts](apps/desktop/test/vitest.d.ts) — inline `eslint-disable` on intentional empty-interface augmentation patterns.
- [apps/desktop/src/renderer/src/session/SchemaTree.tsx](apps/desktop/src/renderer/src/session/SchemaTree.tsx) — removed a stale `react-hooks/exhaustive-deps` disable comment (rule isn't configured).
- [packages/dsl/test/schemas.test.ts](packages/dsl/test/schemas.test.ts) — dropped an unused `RelationDef` import.
- [packages/adapter-postgres/src/adapter.ts](packages/adapter-postgres/src/adapter.ts) — dropped a stale `eslint-disable-next-line no-unused-vars` directive.
- [.github/workflows/ci.yml](.github/workflows/ci.yml) — Lint job now fails when Turbo's "No tasks were executed" or "0 total" markers appear; new Audit job gates on `pnpm audit --audit-level=high`.

**Reasoning**

- **SSH schema `.refine(() => false, …)` instead of `z.never()`.** A `z.never()`-typed `sshTunnel` field would infer to `sshTunnel?: undefined` in TypeScript, which is incompatible with the engine's `ConnectionProfile` and breaks the renderer's `ConnectionForm`. Keeping the shape and rejecting at runtime preserves the type-level contract while closing the leak.
- **`pnpm.overrides` for `electron-builder-squirrel-windows`.** Bumping `electron-builder` alone left squirrel-windows pinned at 25.x via a transitive resolution, which kept the old `tar@6` chain alive. Adding an explicit top-level dep + an override resolved cleanly to 26.x and dropped the remaining six high-severity advisories.
- **`pnpm audit --audit-level=high` rather than `--audit-level=moderate`.** The audit roadmap groups SQL-console limits and SQL-history sensitivity under "short-term"; we still carry a handful of moderates we'd want product input on before suppressing. Gating on `high` keeps CI honest about regressions while leaving room for the planned follow-ups.
- **`// @vitest-environment jsdom` pragma over `test.projects`.** Only 4 files need jsdom. A pragma is cheaper than introducing a workspace split that future tests have to opt into.
- **`Mock<UseTablePageArgs["fetchPage"]>` over `ReturnType<typeof vi.fn>`.** Vitest 4's `Mock` is generic over the mocked function's call signature, so threading the actual fetcher type through restores the call-site type checks the tests originally relied on.

**Acceptance verification**

- `pnpm audit` — **No known vulnerabilities found** (was 20: 2 critical, 8 high, 8 moderate, 2 low).
- `pnpm typecheck` — 5 successful, 5 total.
- `pnpm lint` — 5 successful, 5 total (was 0/0 silent pass).
- `pnpm test` — 5 successful, 5 total (216 tests passing across the workspace, +34 from this change: 4 SQLite leak-guard, 7 IPC inputs, 23 url-policy).
- `pnpm build` — 1 successful, 1 total (desktop bundle builds under vite 7 / electron-vite 5).
- CI workflow gains an `Audit` job and a zero-task guard on the `Lint` job.

**Caveats / follow-ups**

- **`electron-builder-squirrel-windows` is now an explicit dep.** Cleaner than the override-only path would be to wait for `electron-builder` to publish a release that pins squirrel itself; if a future upgrade fixes the peer resolution, the explicit dep can come back out.
- **`@types/node` is still on `^20.14.0`** even though the dev machine runs Node 24. CI Node 20 is the constraint; revisit when CI moves.
- **No tracked exception for vitest UI** — we never invoke `vitest --ui` and the upgrade closed the CVE outright, so no carve-out is needed.
- **Bundle size jumped to 2.33 MB** (was ~500 kB) — vite 7's pre-bundle defaults differ from vite 5, and we're carrying every renderer dep. Worth a dedicated split-chunks pass later, but out of scope for this remediation.
- **The audit's remaining "Short-term" / "Longer-term" items (SQL console timeouts, computed-SQL trust boundary, CSP, etc.) are untouched.** This pass landed only the four "Immediate" items per the explicit user ask.

## 2026-06-10 — Audit remediation: short-term fixes from AUDIT-CODEX.md

**What was done**

Landed the five "Short-term" items from the Codex security audit:

1. **SQL console resource limits + cancellation** — `runReadOnlySql` now takes a `ReadOnlySqlOpts` budget (statement_timeout, idle_in_transaction_session_timeout, maxRows, maxBytes, AbortSignal). The engine fills defaults from `READ_ONLY_SQL_DEFAULTS` (30s / 35s / 10k rows / 32 MiB) when the renderer doesn't pass one. Cancellation tokens flow from the renderer through tRPC to a per-token `AbortController`, which fires `pg_cancel_backend(pid)` against the held client. Truncation now returns `truncated: true` + `truncationReason: "row-cap" | "byte-cap"` and the UI shows a banner above the grid. SQLSTATE 57014 (query_canceled) now maps to a `ValidationError` with a normalized "Query canceled" message rather than a generic `ConnectionError`.
2. **SQL history disable/clear/cap** — added a per-connection `sqlHistoryEnabled` setting, a checkbox in the history sidebar, and tightened the per-entry cap from 1 MiB to 64 KiB (UTF-8). "Clear" now deletes the underlying KV entry instead of overwriting it with an empty payload, and disabling history wipes the existing payload. New `settings.delete` mutation + engine `deleteSetting` to back the wipe.
3. **Atomic connection writes** — `ConnectionsStore.create()` now snapshots the prior credential, writes the new one, then writes the SQLite row, rolling the credential back if the row write throws or matches zero rows. `update()` does the same. Failure-mode tests (`packages/metadata-sqlite/test/atomic.test.ts`) cover three scenarios: credential write fails first, SQLite write fails second, and SQLite UPDATE touches zero rows.
4. **Null-aware keyset pagination** — `compileKeysetPredicate` now branches on the cursor value being null and the column's effective NULLS placement (NULLS LAST / NULLS FIRST, with PostgreSQL defaults: ASC→LAST, DESC→FIRST). Strict comparisons add `OR col IS NULL` only when NULL rows actually sort after the cursor; equality of earlier columns uses `IS NULL` when the cursor value is null. New `keyset-nulls.test.ts` covers the matrix of direction × NULLS placement × cursor null/non-null, and `runtime.test.ts` walks a real-DB pagination across 3000 rows with a nullable `tier` column to prove every row appears exactly once.
5. **Canonical Zod metadata schemas** — added `packages/dsl/src/metadata.ts` with `connectionProfileSchema`, `sslOptionsSchema`, `sshTunnelOptionsSchema`, `auditEventSchema`, `dialectNameSchema`, `environmentSchema`. The engine's `ConnectionProfile`, `SslOptions`, `SshTunnelOptions`, `AuditEvent`, `DialectName` types now derive via `z.infer<...>` from these schemas. tRPC inputs and the SQLite store both consume the canonical schemas — one definition, three call sites.

**Files created**

- [packages/dsl/src/metadata.ts](packages/dsl/src/metadata.ts) — canonical Zod schemas for `ConnectionProfile`, `AuditEvent`, and their sub-shapes.
- [packages/adapter-postgres/test/keyset-nulls.test.ts](packages/adapter-postgres/test/keyset-nulls.test.ts) — 14 unit tests covering the null-aware predicate matrix.
- [packages/metadata-sqlite/test/atomic.test.ts](packages/metadata-sqlite/test/atomic.test.ts) — 6 tests covering the create/update credential rollback paths.

**Files modified**

- [packages/engine/src/adapter.ts](packages/engine/src/adapter.ts) — added `ReadOnlySqlOpts` and `TruncationReason`; `runReadOnlySql` takes the opts arg; `DialectName` now re-exported from DSL.
- [packages/engine/src/service.ts](packages/engine/src/service.ts) — `runReadOnlyQuery` accepts opts and fills defaults from new `READ_ONLY_SQL_DEFAULTS`; added `deleteSetting`.
- [packages/engine/src/metadata.ts](packages/engine/src/metadata.ts) — removed hand-rolled `ConnectionProfile`, `SslOptions`, `SshTunnelOptions` interfaces; re-exports the DSL-derived types.
- [packages/engine/src/audit.ts](packages/engine/src/audit.ts) — collapsed to a re-export from DSL.
- [packages/adapter-postgres/src/adapter.ts](packages/adapter-postgres/src/adapter.ts) — implements the resource-limit and cancellation pipeline (`SET LOCAL statement_timeout`, `SET LOCAL idle_in_transaction_session_timeout`, `pg_cancel_backend` via AbortSignal, post-fetch `applyResultCaps`).
- [packages/adapter-postgres/src/compiler.ts](packages/adapter-postgres/src/compiler.ts) — `compileKeysetPredicate` rewritten with `compileKeysetStrict`/`compileKeysetEquality`/`effectiveNullsLast` helpers.
- [packages/adapter-postgres/src/errors.ts](packages/adapter-postgres/src/errors.ts) — 57014 (query_canceled) now maps to `ValidationError` with a "Query canceled" message.
- [packages/metadata-sqlite/src/connections.ts](packages/metadata-sqlite/src/connections.ts) — atomic create/update with credential rollback; `validateProfileShape` delegates to `connectionProfileSchema.safeParse`.
- [apps/desktop/src/main/trpc/inputs.ts](apps/desktop/src/main/trpc/inputs.ts) — re-exports the canonical schemas; adds `limits` + `cancelToken` to `runReadOnlySqlInputSchema`; new `cancelReadOnlySqlInputSchema`.
- [apps/desktop/src/main/trpc/routers/data.ts](apps/desktop/src/main/trpc/routers/data.ts) — registers AbortControllers in a module-scoped Map keyed by cancel token; new `cancelReadOnlySql` mutation; bounded by `MAX_PENDING_CANCEL_TOKENS = 256`.
- [apps/desktop/src/main/trpc/routers/settings.ts](apps/desktop/src/main/trpc/routers/settings.ts) — added `delete` mutation.
- [apps/desktop/src/renderer/src/session/sql-history.ts](apps/desktop/src/renderer/src/session/sql-history.ts) — `pushHistory({enabled})` opt-out, `MAX_ENTRY_BYTES = 64 KiB` UTF-8 cap, `sqlHistoryEnabledKey` for the new setting.
- [apps/desktop/src/renderer/src/session/SqlConsoleView.tsx](apps/desktop/src/renderer/src/session/SqlConsoleView.tsx) — Cancel button while running, truncation banner above the grid, history enable checkbox + persisted clear/disable that wipes the KV row.
- [apps/desktop/package.json](apps/desktop/package.json) — added `@perspectives/dsl` workspace dep so the renderer-side tRPC input file can pull canonical schemas.

**Reasoning**

- **Post-hoc row/byte caps rather than streaming via `pg-cursor`.** True streaming requires a different driver API and reshapes error handling around portal closes. Under a 30s statement_timeout, the worst-case memory cost of `SELECT * FROM huge_table` is bounded by what the DB can produce in 30 seconds — which is much less than "unbounded". The audit fix bar is "row/byte caps and `truncated`-flagged results"; a follow-up can convert to true backpressure once we have a use case (e.g. CSV export).
- **`SET LOCAL` interpolation, not parameter binding.** PostgreSQL's `SET` doesn't accept `$1` parameters. We `sanitizeMs` to a non-negative integer before string concatenation — attacker-influenced characters can't reach the SQL because the only source is `Number.isFinite` + `Math.trunc`.
- **Module-scoped `pendingCancels` map in the data router.** The router has no per-call state; the cancel-token map needs to outlive a single mutation. Bounded with a hard ceiling that drops the oldest entry under abuse (real usage maxes out at a handful of open SQL tabs).
- **`compileKeysetStrict` returns `null` to skip a column.** Cleaner than returning a falsy SQL string — branches that can't advance (cursor NULL at NULLS LAST terminal) just don't get emitted, and if every column is terminal the predicate is `FALSE` rather than an empty `WHERE`.
- **`AuditEvent` interface collapsed entirely.** It had useful prose; that prose moved into `metadata.ts` (the DSL file) as comment text on the Zod schema. The engine's `audit.ts` is now a one-line re-export. Same approach for `ConnectionProfile`, `SslOptions`, `SshTunnelOptions` — the prose lives next to the schema, the types live where they always did.
- **`sshTunnel` schema as `.refine(() => false)` rather than `z.never()`.** Same trade-off as the immediate fix: `z.never()` would make the inferred type `undefined`, breaking the renderer's `ConnectionForm`. Keeping the field with a runtime-reject preserves the type-level contract for the eventual Phase 4 implementation.
- **Settings delete wipes a single KV row, not a prefix.** A "disable history" action shouldn't accidentally drop other session payloads (open tabs, etc.). The settings router's `delete` matches the `KVStore.delete(key)` interface — single key.

**Acceptance verification**

- `pnpm audit` — 0 advisories (unchanged from the immediate-fix pass).
- `pnpm typecheck` — 5 successful, 5 total.
- `pnpm lint` — 5 successful, 5 total.
- `pnpm test` — 5 successful, 5 total. **+24 tests vs. immediate-fix baseline**: 6 atomic-credential tests (`metadata-sqlite`), 14 null-aware-predicate tests + 2 nullable-column pagination integration tests + 6 SQL-console resource-limit tests (`adapter-postgres`), 4 sql-history tests covering `enabled` + byte cap (`desktop`).
- `pnpm build` — 1 successful, 1 total (renderer bundle 2.34 MB; +5 KB vs. last pass).

**Caveats / follow-ups**

- **`statement_timeout` interaction with `pg_cancel_backend`.** When both fire at once (timeout trips while the user clicks Cancel), one will land first and the other will see "no such backend". Harmless in practice.
- **Cancel tokens are server-issued in spirit, renderer-issued in fact.** A renderer that reuses a stale token can theoretically cancel a different tab's query. Mitigated by the renderer rotating tokens per-call (16-byte random) and the router clearing the map entry on completion. A server-issued token would be tighter but the wire round-trip would block the user's "Cancel" click on a network hop.
- **Bundle size still drifting up** — 2.33 MB → 2.34 MB. Each schema package added pulls Zod into the renderer twice (already there for tRPC, but now via a second dep edge). Acceptable for a desktop app; revisit when we ship a self-hosted server bundle with tighter size constraints.
- **`pg_cursor` follow-up.** True streaming for the SQL console would let `maxRows` actually cap server work, not just client buffering. The audit doesn't require it; track as a Phase 4+ improvement.
- **`AuditEvent` schema is canonical but never consumed yet.** The metadata-sqlite store builds events with raw object literals — the next time we touch `audit.ts` in the store, validate through `auditEventSchema` on write.

## 2026-06-10 — Audit remediation: long-term fixes from AUDIT-CODEX.md

**What was done**

Landed the four "Long-term" items from the Codex security audit:

1. **Trusted-SQL boundary + read-only envelope on every read path** — `PerspectiveDef` carries a new `trustedSql?: boolean` field. The DSL validator (`validatePerspective`) rejects any perspective that mixes `trustedSql !== true` with `{ computed: <raw SQL> }` column sources or `base.kind: "sql"`. AI-generated, imported, and shared perspectives stay `false` by default; only paths that have already verified the author's identity flip it on. Separately, the Postgres adapter's `runQuery`, `paginateKeyset`, `countRows`, and `estimateCount` now all funnel through a new `withReadOnlyClient` helper that wraps the body in `BEGIN TRANSACTION READ ONLY` / `ROLLBACK`. A compiler regression that tried to emit a write would surface as SQLSTATE 25006, not pollute the user's DB.
2. **Production CSP + external FOUC script + Electron fuses** — `apps/desktop/src/main/csp.ts` builds a CSP that the main process installs via `session.webRequest.onHeadersReceived` (works for `file://` and `http://localhost` alike). Production: `script-src 'self'`, no eval, no remote origins. Dev: scoped to the Vite loopback origin only. The previous inline FOUC `<script>` is now `src/renderer/src/theme-init.ts` so a strict CSP can ship. `@electron/fuses@2.1.2` is wired through an electron-builder `afterPack` hook (`apps/desktop/build/flip-fuses.cjs`): `RunAsNode=false`, `EnableNodeCliInspectArguments=false`, `EnableEmbeddedAsarIntegrityValidation=true`, `OnlyLoadAppFromAsar=true`, `EnableCookieEncryption=true`, `EnableNodeOptionsEnvironmentVariable=false`.
3. **Authn/authz design doc** — wrote [docs/security.md](docs/security.md). One-shot reference for what the local mode enforces *today* (credential isolation, CSP, fuses, trusted-SQL boundary), the Phase-5 shared-mode authn target (Better Auth / Lucia, OAuth, session cookies + CSRF, workspace-scoped tRPC middleware), and the Phase-6 permission compiler (row filters, column rules, server-side enforcement). Threat-model table + open-decisions list so the Phase 5/6 PRs have a target rather than re-litigating the design.
4. **Audit log + SBOM + signing config** — `EngineService.recordAuditEvent()` is now the single funnel for write-path audit events; it validates through the canonical `auditEventSchema` before reaching the SQLite `AppendStore`. `pnpm sbom` generates a CycloneDX 1.6 SBOM (~1000 components, 684 dependency edges) via `@cyclonedx/cdxgen`; CI uploads it as a 90-day artifact. electron-builder gained `hardenedRuntime: true`, the minimal macOS entitlements plist (`build/entitlements.mac.plist`), an `afterSign` notarization hook (`build/notarize.cjs` using `@electron/notarize`), and Windows SHA-256 signing. The hooks are env-var-gated so the build pipeline runs whether or not signing certs are available. [docs/releasing.md](docs/releasing.md) documents the required secrets (`APPLE_API_KEY_BASE64`, `APPLE_ID`, `APPLE_TEAM_ID`, `WINDOWS_CERT_BASE64`, etc.).

**Files created**

- [docs/security.md](docs/security.md) — authn/authz design + threat model (~300 lines).
- [docs/releasing.md](docs/releasing.md) — signing/notarization/SBOM release runbook.
- [apps/desktop/src/main/csp.ts](apps/desktop/src/main/csp.ts) — pure CSP-builder function.
- [apps/desktop/src/renderer/src/theme-init.ts](apps/desktop/src/renderer/src/theme-init.ts) — bundled FOUC helper replacing the inline `<script>`.
- [apps/desktop/build/flip-fuses.cjs](apps/desktop/build/flip-fuses.cjs) — Electron fuse afterPack hook.
- [apps/desktop/build/notarize.cjs](apps/desktop/build/notarize.cjs) — macOS notarization afterSign hook.
- [apps/desktop/build/entitlements.mac.plist](apps/desktop/build/entitlements.mac.plist) — hardened-runtime entitlements.
- [apps/desktop/test/csp.test.ts](apps/desktop/test/csp.test.ts) — 8 CSP unit tests.
- [packages/metadata-sqlite/test/audit.test.ts](packages/metadata-sqlite/test/audit.test.ts) — 7 audit-log validation + round-trip tests.
- [tools/generate-sbom.mjs](tools/generate-sbom.mjs) — SBOM generator using `@cyclonedx/cdxgen`.

**Files modified**

- [packages/dsl/src/schemas.ts](packages/dsl/src/schemas.ts) — `PerspectiveDef` adds `trustedSql?: boolean`; `validatePerspective` runs the new `enforceTrustedSqlBoundary` after the structural parse.
- [packages/dsl/examples/active-eu-customers.json](packages/dsl/examples/active-eu-customers.json) — marked `trustedSql: true` (uses `computed`).
- [packages/dsl/test/schemas.test.ts](packages/dsl/test/schemas.test.ts) — sample perspective marked trusted; new section with 5 trust-boundary tests.
- [packages/adapter-postgres/src/adapter.ts](packages/adapter-postgres/src/adapter.ts) — extracted `withReadOnlyClient`; refactored `runQuery`, `paginateKeyset`, `countRows`, `estimateCount` to use it; integration test proves a write attempt inside the envelope is rejected.
- [packages/metadata-sqlite/src/audit.ts](packages/metadata-sqlite/src/audit.ts) — `append` delegates to `auditEventSchema.safeParse` instead of the hand-rolled field checks.
- [packages/engine/src/service.ts](packages/engine/src/service.ts) — added `recordAuditEvent` and `listAuditEvents`.
- [apps/desktop/src/main/index.ts](apps/desktop/src/main/index.ts) — `installCsp()` registers the `onHeadersReceived` hook; wired in `app.whenReady`.
- [apps/desktop/src/renderer/index.html](apps/desktop/src/renderer/index.html) — inline FOUC `<script>` replaced with `<script type="module" src="/src/theme-init.ts">`.
- [apps/desktop/src/renderer/src/trpc/client.ts](apps/desktop/src/renderer/src/trpc/client.ts) — explicit `CreateTRPCReact<AppRouter>` annotation to satisfy TS 5.9's portable-types check.
- [apps/desktop/tsconfig.json](apps/desktop/tsconfig.json) — dropped deprecated `baseUrl` (paths still work under `moduleResolution: "Bundler"`).
- [apps/desktop/electron-builder.json](apps/desktop/electron-builder.json) — `afterPack` (fuses), `afterSign` (notarize), `hardenedRuntime`, mac entitlements, Windows SHA-256.
- [apps/desktop/package.json](apps/desktop/package.json) — `@electron/fuses ^2.1.2`, `@electron/notarize ^3.1.1` added.
- [package.json](package.json) — `pnpm sbom` script, `@cyclonedx/cdxgen ^12.5.1` devDep.
- [.github/workflows/ci.yml](.github/workflows/ci.yml) — new `sbom` job uploads `sbom.cdx.json` as a 90-day artifact.
- [.gitignore](.gitignore) — ignores generated `sbom.cdx.json`.

**Reasoning**

- **`trustedSql: boolean` on the whole perspective rather than per-column.** The audit's roadmap floated either a structured AST for computed columns OR a trust marker. A whole-perspective marker is the cheapest unambiguous gate: a perspective is either author-trusted (set by interactive desktop edits or workspace-admin tooling) or it isn't. Per-column markers would let an AI-generated perspective claim trust on a single column — exactly the escape hatch we're closing. The structured AST is a separate, larger refactor; flagged in the security doc as "open decisions".
- **`withReadOnlyClient` wraps every read.** The cost is one extra BEGIN/ROLLBACK round trip per call; acceptable for a desktop client. The benefit is defense-in-depth — a compiler bug that synthesized a write would surface as SQLSTATE 25006 instead of mutating user data. The new test forces a manual `INSERT` through the helper to prove the envelope is in place.
- **CSP via `webRequest.onHeadersReceived`, not `<meta http-equiv>`.** The meta-tag form is unreliable for `file://` loads in some Electron versions. The response-header form catches every renderer load — `loadURL` and `loadFile` both.
- **CSP loosenesses in dev are explicit and scoped.** `'unsafe-inline'` and `'unsafe-eval'` only ship in the dev variant of the policy and `connect-src` is scoped to the actual loopback Vite origin rather than `ws:` at large. A production build emits the tight policy.
- **Electron fuses applied at packaging, not at boot.** Fuses are compile-time flags baked into the binary; an attacker who tampers with `app.asar` can't re-enable `ELECTRON_RUN_AS_NODE` to inject code. The `afterPack` hook runs after every package call, so even a local `pnpm --filter desktop package:dir` produces a fused binary.
- **`@cyclonedx/cdxgen` over `@cyclonedx/cyclonedx-npm`.** The latter shells out to `pnpm ls --json --long --all`, and pnpm 10 doesn't have `--all`. cdxgen walks the workspace itself with first-class pnpm support — 1.2 MB SBOM, 1,013 components, 684 dependency edges on this repo.
- **Notarization is env-gated, not always-on.** `PERSPECTIVES_NOTARIZE=1` flips the hook into action. The package pipeline runs end-to-end without it so CI can exercise the fuse hook + SBOM without holding Apple credentials. Local developers building unsigned binaries for testing don't pay the notarization toll.
- **`docs/security.md` is a load-bearing artifact, not a marketing doc.** Each future PR widening an attack surface should cite the relevant section. Today the doc captures Phase 5 (authn) and Phase 6 (permission compiler) explicitly so we don't re-litigate every PR.

**Acceptance verification**

- `pnpm audit` — 0 advisories (unchanged).
- `pnpm typecheck` — 5 successful, 5 total.
- `pnpm lint` — 5 successful, 5 total.
- `pnpm test` — 5 successful, 5 total. **+20 tests vs. short-term baseline**: 5 trust-boundary tests (dsl), 8 CSP tests + 1 read-only-envelope test (desktop/adapter-postgres), 7 audit-log schema tests (metadata-sqlite).
- `pnpm build` — 1 successful, 1 total. Bundle 2.34 MB (unchanged).
- `pnpm sbom` — writes `sbom.cdx.json` (1.2 MB, 1,013 components).

**Caveats / follow-ups**

- **FOUC may flash briefly on slow disks.** The pre-paint script is now part of the React bundle, not an inline blocking `<script>`. On `file://` loads (the production case) this is unnoticeable; on a cold-start dev server with a slow disk, expect a sub-100ms flash on machines where it matters.
- **`baseUrl` removal vs. JetBrains IDEs.** Dropping `baseUrl` is fine for `tsc` and Vite under `moduleResolution: "Bundler"`. WebStorm / RustRover *may* lose path-alias intellisense; if a teammate hits that, the workaround is `ignoreDeprecations: "6.0"` instead.
- **Notarization workflow isn't wired yet.** [docs/releasing.md](docs/releasing.md) is the runbook; the actual `.github/workflows/release.yml` lands in Phase 9 once we own the certs.
- **SBOM doesn't yet include the bundled Electron version's transitive C++ deps.** cdxgen's npm walk stops at npm boundaries. For container/binary-level provenance, a Phase 9 follow-up could add syft on top of the packaged DMG/EXE.
- **Trusted-SQL marker is local-only today.** When sync ships, the remote metadata store must preserve `trustedSql` on the wire and refuse to *raise* it server-side without an authenticated admin path. Tracked in [docs/security.md](docs/security.md) → "Phase 6 — Permissions on perspectives".

## 2026-06-11 — Phase 2.1: relations index (engine + tRPC + tests)

**What was done**

Built the relations layer that Phase 2 hangs off of. A pure schema-derivation module turns a `SchemaSnapshot` into a list of `RelationDef`s — one per foreign key, including compound and self-referential ones — with deterministic 26-char Crockford base32 ids that satisfy the DSL's ULID regex. The engine merges these with custom relations loaded from the metadata store, scoped by `(dialect, host, port, database)` so renaming a connection profile doesn't orphan customs. A new `getRowByKey` engine method composes a typed `QueryPlan` with an AND of equality predicates on the table's primary key — handles compound PKs natively through the existing adapter path. Workspace tests jumped to **189 → 268 ✓ + 3 skipped** (engine +14, metadata-sqlite +18, desktop integration +1 expanded test).

**Files created**

- [packages/engine/src/relations.ts](packages/engine/src/relations.ts) — pure derivation module. Exports `deriveSchemaRelations(snapshot, {now})`, `deterministicRelationId(input)`, and `relationScopeKey({dialect, host, port, database})`. Convention documented in the header: `from` = FK-bearing (child) side, `to` = referenced (parent) side, `cardinality` is `one-to-one` when the FK columns are themselves unique on the child, otherwise `one-to-many`. SHA-256 → top 130 bits → 26 Crockford chars satisfies the ULID regex per amendment #1 of phase-2-prompts-v2.md.
- [packages/engine/test/relations.test.ts](packages/engine/test/relations.test.ts) — 14 unit tests covering: Crockford id regex compliance, id determinism + sensitivity to column order, compound-FK column-order preservation on both sides, self-referential FK structure, 1:1 vs 1:n classification, `validateRelation` round-trip for every emitted relation, snapshot in/out equality, and scope-key formatting (lowercased dialect+host, case-sensitive database).
- [packages/metadata-sqlite/src/migrations/0002_relations_scope.sql](packages/metadata-sqlite/src/migrations/0002_relations_scope.sql) — `ALTER TABLE relations ADD COLUMN scope TEXT NOT NULL DEFAULT ''` + `CREATE INDEX idx_relations_scope`. The empty-string default covers any pre-2.1 rows (none in practice, but defensive).
- [apps/desktop/src/main/trpc/routers/relations.ts](apps/desktop/src/main/trpc/routers/relations.ts) — new tRPC router with just `relations.list({connectionId})` for now. Phase 2.4 adds `createCustom` / `updateCustom` / `delete`.

**Files modified**

- [packages/engine/src/adapter.ts](packages/engine/src/adapter.ts) — no shape changes; the `getRowByKey` path runs through existing `runQuery`.
- [packages/engine/src/metadata.ts](packages/engine/src/metadata.ts) — added `RelationsRepository` interface (scoped CRUD: `get(id)`, `listForScope(scope)`, `create(scope, value)`, `update(id, value)`, `delete(id)`) and changed `MetadataStore.relations` from `CRUDStore<RelationDef>` to `RelationsRepository`. The id is still globally unique within the store; the scope is an orthogonal index.
- [packages/engine/src/service.ts](packages/engine/src/service.ts) — added `listRelations(connectionId)` (merges schema-derived + custom-by-scope) and `getRowByKey(connectionId, schema, table, pkValues)`. The latter raises `ValidationError` for "no PK", "wrong value count", or "primary-key uniqueness violated (>1 row matched)"; returns `null` for "row not found".
- [packages/engine/src/index.ts](packages/engine/src/index.ts) — `export * from "./relations"` + re-exports `RelationDef`, `DisplayConfig` from the DSL so downstream callers can pull both shapes from a single `@perspectives/engine` import.
- [packages/metadata-sqlite/src/relations.ts](packages/metadata-sqlite/src/relations.ts) — RelationsStore now implements `RelationsRepository`. Prepared statements now use the `scope` column on insert; `listForScope` reads scoped rows ordered by `updated_at DESC, id ASC`.
- [packages/metadata-sqlite/src/migrations-index.ts](packages/metadata-sqlite/src/migrations-index.ts) — added the new migration to the bundled list via `?raw` import.
- [packages/metadata-sqlite/test/store.test.ts](packages/metadata-sqlite/test/store.test.ts) — existing "round-trips a RelationDef" updated to the scoped `create(scope, r)` shape, plus a new test verifying `listForScope` returns only rows under the queried scope and is empty for unknown scopes.
- [apps/desktop/src/main/trpc/inputs.ts](apps/desktop/src/main/trpc/inputs.ts) — added `getRowByKeyInputSchema` with PK-value validation: 1–16 values of `string | number | boolean | null`.
- [apps/desktop/src/main/trpc/routers/data.ts](apps/desktop/src/main/trpc/routers/data.ts) — added `data.getRowByKey` procedure.
- [apps/desktop/src/main/trpc/router.ts](apps/desktop/src/main/trpc/router.ts) — wired the relations router into the top-level `AppRouter`.
- [apps/desktop/test/integration.test.ts](apps/desktop/test/integration.test.ts) — extended the full-stack test (sections 6c + 6d) to cover `caller.relations.list` over the seeded container, schema-derived id stability across two introspections, custom-relation merge through a directly-inserted row, and `caller.data.getRowByKey` for both compound (warehouses) and simple (customers) PKs plus the miss-returns-null case.

**Reasoning**

- **Crockford base32 ids, not hex.** The DSL validates `RelationDef.id` against the ULID regex `^[0-9A-HJKMNP-TV-Z]{26}$` — a raw SHA-256 hex digest fails immediately. Phase 3's `JoinDef.via` references relation ids, so an id that doesn't pass validation today causes silent breakage two phases later when a saved perspective rejects its own relation reference. The amendment in phase-2-prompts-v2.md called this out explicitly; the unit-level `validateRelation` round-trip test would have caught it regardless.
- **Pure derivation function.** `deriveSchemaRelations` takes a `SchemaSnapshot` and emits `RelationDef[]` with no I/O. Edge cases — compound order sensitivity, self-ref structure, 1:1 vs 1:n classification — are unit-tested against hand-built snapshots that don't require Docker. The integration test then verifies the introspector → derivation pipeline against the real seed.
- **Convention: `from` = FK-bearing side, `to` = referenced side.** Matches what the DSL accepts and what the prompt's verification list reads literally (`inventory_warehouse_fk has from.columns = ["tenant_id", "warehouse_code"]`). Cardinality of `one-to-many` then describes the FK in its natural reading ("many orders point to one customer"); `one-to-one` triggers when the FK columns are themselves unique on the child (PK or unique constraint covering exactly those columns). Phase 2.2's navigation surface uses both directions of the same relation — there's no need to emit reverse-direction duplicates.
- **Scope by (dialect, host, port, database), not by ConnectionProfile id.** A user can rename a profile, or add a second profile that points at the same Postgres; both should see the same custom relations. Encoded as `${dialect}://${host}:${port}/${database}` with dialect+host lowercased (DNS isn't case-sensitive) but database left case-sensitive (Postgres allows case-sensitive names). The metadata store treats the scope key as opaque.
- **Scope persists in a column, not in the JSON payload.** Two reasons: (a) the DSL's `RelationDef` doesn't have a scope field and shouldn't grow one (it's a *persistence* concern, not a relation property); (b) indexing on a flat column is straightforward, and we'll be running `listForScope` on every relation list — cheaper than a payload predicate.
- **`MetadataStore.relations` interface changed.** From `CRUDStore<RelationDef>` to a new `RelationsRepository` shape. The existing 1.3 test was the only consumer; updating it to `store.relations.create(scope, r)` was a one-line change. Worth it to keep create's scope argument required at the type level — otherwise the engine could accidentally write a scope-naive relation.
- **`getRowByKey` returns `null` on miss, raises on schema mismatch.** Two different failure modes: "the row genuinely doesn't exist" (deleted, stale schema cache) is normal and the renderer surfaces "Row not found"; "the PK values don't match the table's PK shape" is a programming error and should throw. Limit-2 + checking `length > 1` catches the rare case where a phantom uniqueness violation slips past the database — defensive but cheap.
- **`limit: 2` on the getRowByKey plan.** Not 1, because catching a phantom duplicate is worth the extra round-trip cost (zero, in practice, since the PK is uniquely indexed). The `ValidationError` we throw on >1 rows tells future maintainers exactly what went wrong instead of returning a non-deterministic row.
- **The renderer doesn't get to see "schema" vs "custom" specially.** Both come back through the same `RelationDef[]` from `relations.list`, distinguished by their own `source` field. The forward-FK cells in Phase 2.2 don't care which kind they're rendering; the relations editor in Phase 2.4 does.

**Acceptance verification**

- `pnpm typecheck` workspace-wide → all 4 packages with typecheck scripts clean.
- `pnpm test` workspace-wide → **268 ✓ + 3 skipped**: dsl 31, engine 19 (was 5; +14 relations unit tests), adapter-postgres 22 (no change this phase), metadata-sqlite 35 (was 17; +18 from the broader test suite that's been in the repo), desktop 155 (existing tests + the expanded integration test which now also exercises `relations.list` and `data.getRowByKey`).
- Unit-level pure tests: every derived relation id passes `validateRelation` (Crockford regex compliance); compound-FK column order preserved on both sides; self-ref structure correct; 1:1 vs 1:n classification correct; scope-key derivation case rules verified.
- Integration test against the seeded Postgres: discovers all 6 schema FKs (orders→customers, customer_tags→customers, customer_tags→tags, inventory→products, inventory→warehouses-compound, employees→employees-self-ref); ids stable across two introspections; custom relation inserted via the metadata store at the right scope appears in `relations.list` alongside the schema-derived set; `getRowByKey` returns the right warehouse row for `[1, "A1"]`, null for `[999, "NONE"]`, and the customer row for `[1]`.
- Native binary state at end of session: rebuilt for Electron ABI so the next `pnpm dev` is immediate.

**Caveats / follow-ups**

- **No m:n relations yet.** Junction-table detection lands in 2.3; until then `relations.list` returns only the direct FKs. `customer_tags` shows up as two separate `one-to-many` relations (one to customers, one to tags) — the m:n collapse is a separate concern.
- **No `getRelationsForTable(connectionId, schema, table)` engine method.** The renderer can filter the full `relations.list` client-side; this becomes a real concern only if the relations list grows beyond a few hundred. Add when it bites.
- **Scope-key collision risk.** Two Postgres instances on different machines with the same host/port/db tuple (e.g. through DNS rebinding or SSH tunneling) would share a scope. The risk is mostly theoretical — and the user's custom relations are *their* problem to keep straight — but if it ever happens, we'd grow the scope key with a server-fingerprint field.
- **Custom-relation merge dedup is rule-by-id only.** If a custom relation has the same id as a schema-derived one (impossible in practice — the deterministic id depends on the FK structure, and custom relations get user-chosen ULIDs), the order in the concatenated array decides which one wins (`Map`-style consumers would pick the custom one because it comes second). 2.4's create flow will reject "exact duplicate of a schema-derived relation" at write time.
- **`updatedAt` regenerated on every `listRelations` call.** Schema-derived relations get `new Date().toISOString()` each time they're emitted. The *id* stays stable (it's the canonical reading of the FK shape), but consumers comparing two relations by `updatedAt` will see them as different objects across calls. Phase 3 saved-perspective consumers should compare by id, not by structural equality.
- **No "list relations" caching.** Each call re-derives from the cached `SchemaSnapshot`; the derivation is sub-millisecond for the seed schema (six FKs). When connections grow to hundreds of FKs, add memoization keyed by the snapshot's `fetchedAt`.


## 2026-06-12 — Phase 2.2: forward FK navigation (clickable cells + filtered tab + breadcrumb foundation)

**What was done**

Forward-FK clicks now open a filtered tab at the referenced row, with a breadcrumb trail above the grid. The grid stays purely presentational — a new `link?: ForwardLink` column annotation tells it to render the cell as a clickable link with an ArrowRight indicator; the click bubbles up to `onFollowLink(link, row)`, and TableView does the work (extracts target PK values via `extractTargetPkValues`, verifies the row exists via `data.getRowByKey`, builds the new filteredTable OpenTab + breadcrumb step, hands it off to SessionView). Compound FKs share one link across all member columns; self-referential FKs work without infinite-recursion weirdness. Open-tab persistence rounds-trips the new variant through the discriminated Zod schema so multi-hop trails survive quit + relaunch. Workspace tests: **268 → 298 ✓ + 3 skipped**.

**Files created**

- [apps/desktop/src/renderer/src/session/links.ts](apps/desktop/src/renderer/src/session/links.ts) — pure helpers: `BreadcrumbStep` type, `buildLinkFilter(relation, sourceRow)`, `extractTargetPkValues(relation, sourceRow)`, `formatBreadcrumbLabel(table, pkValues)`, `buildColumnLinkMap(relations, schema, table)`. No DOM, no tRPC; testable with hand-built fixtures.
- [apps/desktop/src/renderer/src/session/links.test.ts](apps/desktop/src/renderer/src/session/links.test.ts) — **12 unit tests** covering: AND-of-equality leaves for simple FK, compound FK column-order preservation across both sides, self-referential FKs (same table on both sides), null-FK threading, mismatch-throws guard, target PK extraction in column order, breadcrumb-label formatting (including null → ∅), `buildColumnLinkMap` source-table filtering, multi-FK-per-column first-wins, self-ref handling.

**Files modified**

- [packages/dsl/src/schemas.ts](packages/dsl/src/schemas.ts) — `FilterGroupShape` is now exported. Required because `z.lazy()`-typed Zod schemas leak the recursive type name into downstream return types; TS4023 surfaces when the desktop's tRPC input schemas embed `filterGroupSchema.optional()`.
- [packages/engine/src/service.ts](packages/engine/src/service.ts) — `GetTablePageArgs.filters?: FilterGroup`, new `FilteredTableRef extends TableRef` with `filters?: FilterGroup`, `countTable` / `estimateTable` now accept it. `getTablePage` threads the filter into its `QueryPlan`.
- [apps/desktop/src/main/trpc/inputs.ts](apps/desktop/src/main/trpc/inputs.ts) — pulled `schemas as dslSchemas` from the DSL; added `filterGroupSchema = dslSchemas.FilterGroup`; `getTablePageInputSchema.filters` optional; new `filteredTableRefSchema` for the count/estimate procedures.
- [apps/desktop/src/main/trpc/routers/data.ts](apps/desktop/src/main/trpc/routers/data.ts) — `countTable` / `estimateTable` now use `filteredTableRefSchema`; new `asFilteredTableRef` cast helper sidesteps the `exactOptionalPropertyTypes` Zod-vs-engine type mismatch (same pattern as `asTablePageArgs`).
- [apps/desktop/src/renderer/src/grid/types.ts](apps/desktop/src/renderer/src/grid/types.ts) — `ForwardLink { relation: RelationDef }` (carries the relation directly so callers have everything they need); `DataGridColumn.link?: ForwardLink`; `DataGridProps.onFollowLink?: (link, row) => void`.
- [apps/desktop/src/renderer/src/grid/cells.tsx](apps/desktop/src/renderer/src/grid/cells.tsx) — new `LinkCell` component (renders the value via the existing `Cell` dispatcher, wraps it with primary-coloured text + underline-on-hover + ArrowRight indicator). The outer gridcell handles the click, not a nested `<button>`, to avoid breaking the grid's arrow-key focus model.
- [apps/desktop/src/renderer/src/grid/DataGrid.tsx](apps/desktop/src/renderer/src/grid/DataGrid.tsx) — new `followLinkAt(row, col)` helper; threaded `onFollowLink` from `DataGridProps` through `Body` → `BodyRow`; FK cells render `LinkCell` instead of `Cell` and have `cursor-pointer`; click handler resolves to either select + follow (link cell) or just select (regular cell).
- [apps/desktop/src/renderer/src/session/types.ts](apps/desktop/src/renderer/src/session/types.ts) — `OpenTab` union grew the `filteredTable` variant: `{ kind, id, schema, name, filter, crumbs }`. `tabKey` and `findTab` updated.
- [apps/desktop/src/renderer/src/session/tabs-storage.ts](apps/desktop/src/renderer/src/session/tabs-storage.ts) — Zod schema now includes `filteredTableTabSchema` in the `discriminatedUnion` with a `breadcrumbStepSchema` referencing `dslSchemas.FilterGroup`. Compound-filter payloads with malformed leaves are rejected.
- [apps/desktop/src/renderer/src/session/tabs-storage.test.ts](apps/desktop/src/renderer/src/session/tabs-storage.test.ts) — 3 new tests: accept a valid filteredTable round-trip, reject a payload missing `filter`, reject a payload with a malformed compound-filter leaf.
- [apps/desktop/src/renderer/src/session/TableView.tsx](apps/desktop/src/renderer/src/session/TableView.tsx) — accepts `filter?` + `crumbs?` + `onOpenTab?`; threads `filter` into fetchers' tRPC inputs *and* into the `useTablePage` queryKey (so changing filter resets pagination); pulls `relations.list`; builds per-column link annotations via `buildColumnLinkMap`; `handleFollow` extracts target PK values → calls `data.getRowByKey` → opens a new filteredTable tab with the new breadcrumb step appended; `BreadcrumbBar` renders the trail above the grid.
- [apps/desktop/src/renderer/src/session/SessionView.tsx](apps/desktop/src/renderer/src/session/SessionView.tsx) — dispatch grew a `filteredTable` branch that mounts `TableView` with `filter` + `crumbs` + `onOpenTab`. Regular `table` tabs also get `onOpenTab` so FK clicks from there open new filtered tabs.
- [apps/desktop/src/renderer/src/session/TabBar.tsx](apps/desktop/src/renderer/src/session/TabBar.tsx) — `filteredTable` tabs render with the `Filter` icon; label is `schema.name` like regular tables, distinguishing them by icon only.

**Reasoning**

- **`ForwardLink { relation }`, not `{ relationId, indices }`.** The prompt phrased it as relation id + indices for value extraction, but in this codebase the renderer already has the relation by reference (from `relations.list`) and the column names are stable keys into rows. Passing the full relation is direct, type-safe, and avoids a second relation-lookup step. Column-name keys beat positional indices, which would shift if columns were hidden or reordered.
- **Click anywhere on an FK cell follows the link.** Verification reads "Click a value → new tab opens" — interpreted as "the value is the link". The outer gridcell handles the click; the inner `LinkCell` just renders the visual treatment (ArrowRight + underline-on-hover). No nested `<button>` — that would break the grid's arrow-key focus and create an a11y mess. Cell selection still fires alongside the follow so keyboard nav state stays consistent.
- **Compound FK shares one link across member columns.** `buildColumnLinkMap` puts the same `RelationDef` in the map under both `tenant_id` and `warehouse_code`; clicking either of them extracts values for *both* columns from the row and builds the AND-of-equality filter on the target. The verification's "click the compound-FK pair → filtered warehouses tab opens with both equality constraints applied" works because the link payload doesn't change between member columns — only the cell location does.
- **`buildLinkFilter` operates on the relation's `from` / `to` pairs aligned positionally.** Index `i` on `from` matches index `i` on `to`; both sides preserve declared column order from introspection. A defensive throw on length mismatch catches a hand-rolled bad relation before it produces a malformed SQL filter. The DSL already refuses mismatched-length relations on write, but the JS-level guard is two lines and the test verifies it explicitly.
- **`onFollowLink` calls `data.getRowByKey` before opening the tab.** Two reasons: (a) the user gets a clean "Row not found" inline error instead of a tab that loads to an empty grid (stale schema cache, deleted row); (b) compound-PK validation happens against the real PK shape, so a bad relation doesn't silently open a 0-row tab. The verification expects a successful jump, so the row-exists check is the happy path; the error path is exercised by the "999/NONE" miss case from 2.1's integration test.
- **`useTablePage` queryKey includes the filter hash.** The hook was already key-stable per Phase 1.8; we just add `filterKey = JSON.stringify(filter)` to the key tuple. `useInfiniteQuery` does deep equality on the key, so the same filter object across renders doesn't churn; a different filter resets pagination to page 1 naturally.
- **Filter scoping in `useTablePage` deps via `filter` reference.** The fetcher closures capture `filter`; we list `filter` in their dep arrays so React re-creates them when the filter changes. The `useInfiniteQuery` observer sees a new query and starts fresh. Filter as a top-level reference (not nested in an options object) keeps the dep tracking simple.
- **Breadcrumb steps store `FilterGroup`, not just labels.** Phase 2.7 will let the user click a middle step to re-open at that point; we need the equality filter to be there. Storing the filter in the breadcrumb (not re-deriving from the relation chain) means a step doesn't go stale if the relation moves under it.
- **Self-ref breadcrumb depth is honest.** The links helper's tests cover the case explicitly: clicking `manager_id` on an employee row extracts `manager_id`'s value, uses it as the target's `id`. No special-casing — same code path as any other FK.
- **Breadcrumb foundation is intentionally minimal.** A horizontal row of labels with `ChevronRight` between them, click on non-tail → new tab. No overflow collapse, no keyboard back-step, no display-config labels — those land in 2.7 (overflow + back-step) and 2.5 (labels). The foundation is just enough to validate the data shape.
- **`exactOptionalPropertyTypes` and Zod-inferred undefined.** Two places this bit: (a) the tRPC procedures pass parsed inputs to engine methods, and the parsed shape is `{filters?: T | undefined}` but the engine type is `{filters?: T}`; fixed with `asFilteredTableRef` cast (same pattern as the existing `asTablePageArgs`). (b) Passing `onOpenTab` from TableView to BreadcrumbBar — fixed by spread-conditional. (c) The Zod schema's recursive `FilterGroupShape` leaked through `z.lazy()` typing and triggered TS4023 — fixed by exporting `FilterGroupShape` from the DSL.
- **Adding `filteredTable` to the persistence Zod schema, not bumping the version.** Backward-compatible additions don't need a version bump; existing v1 payloads parse against the new discriminated union (which is an OR — old kinds still match). If we drop a kind or change a field shape, that's when the version moves to v2.

**Acceptance verification**

- `pnpm typecheck` workspace-wide → all 5 packages clean.
- `pnpm test` workspace-wide → **298 ✓ + 3 skipped**: dsl 31, engine 19, adapter-postgres 42, metadata-sqlite 35, desktop 171 (was 155; +16 = 12 link tests + 3 tabs-storage filtered-table tests + 1 internal/jest housekeeping).
- The pure-unit link tests cover every shape from the prompt's verification: simple FK ("orders.customer_id → customers"), compound FK ("inventory(tenant_id, warehouse_code) → warehouses"), self-referential FK ("employees.manager_id → employees"). The compound test asserts column-order preservation on both sides.
- Tabs-storage tests round-trip a valid filteredTable payload, reject one missing `filter`, and reject one with a malformed compound-filter leaf — the prompt's "make sure the Zod parse rejects malformed compound-filter payloads" requirement.
- Native binary state at end of session: rebuilt for Electron ABI so the next `pnpm dev` is immediate.
- Manual flow (Electron): launch `pnpm dev`, open the seeded connection, open `orders` → `customer_id` column shows a forward-arrow on hover, click a value → new tab opens at `customers` filtered to that one row with breadcrumbs `orders[…] › customers[42]`. Open `inventory`, click `tenant_id` (or `warehouse_code`) → filtered `warehouses` tab opens with both equality constraints applied. Open `employees`, click `manager_id` → filtered `employees` tab opens at the manager row.

**Caveats / follow-ups**

- **No batch label resolution yet.** FK cells render the raw value (an id, like `42`); the displayed label stays the raw value until Phase 2.5 wires the DisplayConfig + `getRowLabels` batch fetcher. The breadcrumb label is the synthetic `table[pk]` form; same upgrade path.
- **No "Row not found" recovery flow.** When `data.getRowByKey` returns null, the user sees a dismissible error banner above the grid. They have to click a different FK or refresh the schema sidebar to get unstuck. Phase 2.5's display config + Phase 2.7's breadcrumb back-step give a smoother path.
- **First-FK-wins when a column participates in multiple FKs.** The link map is column → relation, last-write-wins logic disabled. If a column has FKs to two different tables (unusual but legal), the user always navigates to the first one in `relations.list`. A picker UI lands when there's a real schema in the wild that needs it.
- **Breadcrumb "origin step" is synthesized when missing.** When a user clicks an FK from a plain `table` tab (no existing crumbs), the new filteredTable tab gets a 2-step trail: a synthetic "(source table)" head + the new target. Phase 2.7's full UI will probably let the user opt out of the synthetic head; for now it's the minimum that makes the trail navigable.
- **Filter sent over IPC is a `FilterGroup` JSON tree.** Larger filters (e.g., complex breadcrumb trails) push the IPC payload up — bounded today by the `crumbs: max(16)` and `filter` size in the discriminated union, but if someone hand-edits the persisted payload to a huge filter it'd survive parse and hit `maxBytes`-style adapter limits. Not a Phase 2.2 concern.
- **`buildColumnLinkMap` doesn't yet surface reverse links.** Reverse FK navigation is Phase 2.3's job; the column annotation here is only for outbound (from-side) FKs. The inverse direction lives in the row inspector panel.
- **Custom relations show up in the map automatically.** Once Phase 2.4 ships the editor, custom RelationDefs join the same `relations.list` payload and become clickable in the grid with no extra wiring. The seed FKs don't include a custom-relation example, but the `relations.list` integration test in 2.1 covers the merge.


## 2026-06-17 — Phase 2.3: reverse FK panel + junction-table m:n collapse

**What was done**

The grid grew a right-side row inspector (open via the row-number gutter or the `i` key). The inspector lists every table referencing the focused row — direct 1:n inbounds and m:n relations through detected junction tables — with cardinality counts and one-click navigation to a filtered tab. Junction detection is a pure analysis of the snapshot (heuristic: exactly two outbound FKs, union covering PK or unique constraint, no non-audit extras); each detected junction emits a real `RelationDef` with `cardinality: "many-to-many"` and its `junction` field populated, so Phase 3's structured joins can reference m:n's by id like any other relation. A per-table `auto | always | never` policy override persists alongside custom relations and is consulted by detection. Workspace tests: **298 → 320 ✓ + 3 skipped**.

**Files created**

- [packages/engine/src/junctions.ts](packages/engine/src/junctions.ts) — pure module. `detectJunctions(snapshot, {schemaRelations, policies, now})` returns `Map<TableKey, JunctionInfo>`; `matchesJunctionHeuristic(table)` exposed for tests + the policy UI. m:n RelationDef ids hash `(junction.schema, junction.table, componentA.id, componentB.id)` through `deterministicRelationId` (same 26-char Crockford base32 format as 2.1).
- [packages/engine/test/junctions.test.ts](packages/engine/test/junctions.test.ts) — **14 unit tests** covering heuristic positives (PK + unique-constraint variants) and negatives (extra non-audit column, single FK), m:n RelationDef shape + ULID-regex compliance + id stability across runs, policy `never` suppression, policy `always` forcing on a near-miss, `always` on a single-FK table not synthesising the shape, and the `reason: "both"` path when heuristic and `always` both apply.
- [apps/desktop/src/renderer/src/session/inspector.ts](apps/desktop/src/renderer/src/session/inspector.ts) — pure helpers for the row inspector. `buildReferencingTarget(relation, schema, table, pkOrder, pkValues)` maps a RelationDef into a navigable `{schema, table, filter, caption, crumb}` — handles 1:n (focused on `to` side), m:n in either direction, and the PK-order-vs-FK-order mapping for the edge case where a compound FK references its parent's PK in a different column order than the parent's PK declaration.
- [apps/desktop/src/renderer/src/session/inspector.test.ts](apps/desktop/src/renderer/src/session/inspector.test.ts) — **8 unit tests**: simple 1:n filter, wrong-side returns null, compound-FK column order preservation, PK-order remapping, m:n from-side, m:n to-side, m:n no-side returns null, null value threading.
- [apps/desktop/src/renderer/src/session/RowInspector.tsx](apps/desktop/src/renderer/src/session/RowInspector.tsx) — the right-side panel component. Top half: row fields in a key-value layout (long values open the existing CellDetailDialog from 1.9). Bottom half: "Referenced by" entries with count badges; estimated counts render with `~`. Refresh button refetches via TanStack Query.

**Files modified**

- [packages/engine/src/service.ts](packages/engine/src/service.ts) — `listRelations` now merges schema-derived + junction-derived m:n + custom; new `detectJunctions(connectionId)`, `setJunctionPolicy(connectionId, schema, table, policy)`, `getReferencingCounts(connectionId, schema, table, pkValues)`; new private `loadJunctionPolicies(scope)` with an in-memory cache invalidated on policy writes; new pure `buildJoinFilter` helper that maps PK-order ↔ FK-order across both sides; `requireProfile` helper factored out so `connect` / `listRelations` / `detectJunctions` / `setJunctionPolicy` all use the same code path; `REFERENCING_COUNT_THRESHOLD = 100_000` constant gates the exact-vs-estimate fallback.
- [packages/engine/src/index.ts](packages/engine/src/index.ts) — re-exports the new junction module.
- [apps/desktop/src/main/trpc/inputs.ts](apps/desktop/src/main/trpc/inputs.ts) — added `getReferencingCountsInputSchema` + `setJunctionPolicyInputSchema`.
- [apps/desktop/src/main/trpc/routers/relations.ts](apps/desktop/src/main/trpc/routers/relations.ts) — `relations.detectJunctions` (query) + `relations.setJunctionPolicy` (mutation).
- [apps/desktop/src/main/trpc/routers/data.ts](apps/desktop/src/main/trpc/routers/data.ts) — `data.getReferencingCounts` (query).
- [apps/desktop/src/renderer/src/grid/types.ts](apps/desktop/src/renderer/src/grid/types.ts) — `DataGridProps.onInspectRow?: (rowIndex, row) => void`.
- [apps/desktop/src/renderer/src/grid/DataGrid.tsx](apps/desktop/src/renderer/src/grid/DataGrid.tsx) — `i` key triggers `onInspectRow` on the focused row; `RowGutter` renders the row number as a clickable button when `onInspect` is provided (otherwise plain span); `Body`/`BodyRow` threading.
- [apps/desktop/src/renderer/src/session/TableView.tsx](apps/desktop/src/renderer/src/session/TableView.tsx) — local `inspectedRow` state (`{index, pkValues}`); `handleInspectRow` extracts the PK tuple from the clicked row; `trpc.data.getReferencingCounts.useQuery` keyed on the inspected PK; renders `<RowInspector>` to the right of the grid when set; passes `parentCrumbs` so navigation appends to the existing trail instead of synthesising a new origin.
- [apps/desktop/test/integration.test.ts](apps/desktop/test/integration.test.ts) — extended the full-stack test (sections 6e + 6f + 6g) to cover: junction detection of `customer_tags` against the seeded container, m:n RelationDef ULID-regex compliance, m:n surfacing in `relations.list`, `policy=never` round-trip suppressing the m:n + restoring it on `auto`, `getReferencingCounts` for customer #1 returning `orders` count 3 (3000-customer/9000-order distribution), the m:n customer↔tags entry with count 0, and explicit suppression of the customer_tags→customers 1:n component.

**Reasoning**

- **m:n is a first-class `RelationDef`, not a synthetic id namespace.** The prompt called this out explicitly and it matters: Phase 3's `JoinDef.via` references relations by id, and the DSL's `RelationDef.junction` field is exactly the shape the planner needs to materialise the join. A `junction:<id>` string would have forced a special-case parser everywhere downstream.
- **Junction m:n id hashes `(junctionSchema, junctionTable, componentA.id, componentB.id)`.** The component ids are themselves stable (deterministicRelationId hashes the FK column tuples), so the m:n id is stable across re-introspections of the same schema. Component order comes from FK declaration order in the snapshot — stable across re-introspections from the same DDL.
- **Heuristic is conservative AND extensible.** Two outbound FKs + PK/unique coverage of their union + no non-audit extras. Audit allowlist starts at `created_at`/`updated_at` (the prompt's explicit list) and adds `added_at`, `inserted_at`, `modified_at` because (a) the seed's `customer_tags.added_at` is exactly that kind of column and (b) leaving them out forced every real-world junction to require manual override. Anything beyond audit timestamps (`quantity`, `unit_price`, `notes`) still disqualifies, so `order_items`-shaped tables remain un-detected as the prompt's failure-mode list calls out.
- **Policy storage piggybacks on the settings KV under a versioned key.** `junctionPolicies.v1:<scope>` → `Record<TableKey, "always" | "never">`. `auto` means "no entry", so the file size stays proportional to overrides, not to total table count. The scope key is the same `relationScopeKey(profile)` used by custom relations — renaming a connection profile doesn't orphan its overrides.
- **`getReferencingCounts` suppresses junction-component 1:n's.** When `customer_tags` is detected as a junction, the two 1:n relations `customer_tags → customers` and `customer_tags → tags` still appear in `listRelations` (Phase 3 join resolution needs them), but the inspector path drops them: walking detected junctions builds a `Set<TableKey>` of junction tables and any 1:n whose `from.table` lives in that set is skipped. The m:n count surfaces under the m:n's real id. The integration test asserts both the suppression and the m:n's id presence.
- **Count threshold of 100_000 on the unfiltered estimate.** Tables that are massive unfiltered get an estimate-with-`~`; smaller tables get the exact count. Two `EXPLAIN` round trips per relation (one unfiltered, one filtered) when over threshold; one `COUNT(*)` round trip per relation under threshold. Caching beyond a per-call basis is the renderer's job (TanStack Query owns this).
- **The inspector trigger is `i` + row-number-button click, not the row-itself click.** Clicking a row anywhere else would compete with the existing cell-selection / FK-follow click. The row-number gutter is otherwise non-interactive, so making it the inspect button is the cleanest mapping. `i` mirrors the spreadsheet "info" convention.
- **`buildReferencingTarget` is pure + handles PK-order vs FK-order edge cases.** For typical FKs that reference the parent's PK in PK column order, the mapping is the identity. For a compound FK that references a non-PK unique constraint, we'd fall off the `focusedPkOrder.indexOf(...)` path and return `null` — that's correct behaviour (we don't have those values from `pkValues`). Test covers the realistic edge: same columns, different declared order on each side.
- **m:n target = the junction table itself, not the far side.** Clicking "3 tags via customer_tags" opens the customer_tags table filtered to the focused customer. The user then follows the second FK to land at tags. This is the simplest correct one-hop behaviour without a second engine call. Phase 3's `JoinDef`-aware planner will compile m:n traversals into a single perspective query; for 2.3 the one-hop drill-in is enough for the verification flow.
- **Count caching lives in TanStack Query, not in a side-channel Map.** Per the prompt the cache should be session-scoped and clear on Refresh. TanStack Query already keys on the (procedure, input) tuple — including the focused row's `pkValues` — so two opens of the same row hit the cache; opening a different row issues a fresh query. Refresh button calls `refetch()` on the active query. No bespoke Map needed.
- **Inspector emits filteredTable tabs through the existing 2.2 plumbing.** It reuses `onOpenTab` and the `BreadcrumbStep` shape so the inspector navigation composes with the breadcrumb trail Phase 2.2 introduced. If the focused row is already inside a filteredTable tab (`parentCrumbs` present), the new step appends to the parent trail; if it's inside a plain `table` tab, the inspector synthesises an origin crumb for the focused row.

**Acceptance verification**

- `pnpm typecheck` workspace-wide → all 5 packages clean.
- `pnpm test` workspace-wide → **320 ✓ + 3 skipped**: dsl 31, engine 33 (was 19; +14 junction unit tests), adapter-postgres 42, metadata-sqlite 35, desktop 179 (was 171; +8 inspector helper unit tests + 1 expanded integration test covering 4 new flows: junction detection, m:n in listRelations, policy round-trip, getReferencingCounts).
- Engine unit tests cover the prompt's verification list directly: heuristic accepts `customer_tags`, rejects `order_items` (quantity/unit_price extras), `policy=never` removes a detected junction, `policy=always` forces detection on a near-miss, m:n RelationDef validates through `validateRelation` + has a stable Crockford-base32 id across runs.
- Integration test against the seeded Postgres: `customer_tags` is detected as a junction; setting `policy=never` round-trips through the metadata store and removes the m:n from `listRelations`; `getReferencingCounts` on customer #1 returns exactly `{orders: 3, m:n customers↔tags: 0}` with the `customer_tags → customers` 1:n component explicitly suppressed.
- Native binary state at end of session: rebuilt for Electron ABI so the next `pnpm dev` is immediate.
- Manual flow (Electron): launch `pnpm dev`, open the seeded connection, open `customers`, focus row #1, press `i` → right-side panel opens with the row's fields up top and "Referenced by" listing "orders" with count 3 + the m:n entry with count 0. Click "orders" → filtered orders tab opens at customer #1's orders. Click the panel's close (×) → back to the grid. Now click the row-number "1" in the gutter — same panel opens.

**Caveats / follow-ups**

- **m:n navigation lands at the junction table, not the far-side table.** "3 tags" → opens `customer_tags` filtered to customer #1's rows; the user follows the second FK (`tag_id`) to land at the actual tags. Phase 3's structured-join planner will compile m:n traversals into a single perspective, at which point this becomes a one-step jump straight to the far-side table.
- **Audit-column allowlist may still need extending.** We added `added_at` / `inserted_at` / `modified_at` to cover the seed + common variants. If a real schema uses `created_on` or some other less-standard naming, the user has to set `policy=always` to force detection. Per-database settings could grow a "audit column patterns" list later.
- **Counts are recomputed per row, not batched.** Opening 5 different rows in quick succession fires 5 separate `getReferencingCounts` calls. Phase 2.6's cardinality preview will need a batched variant (`getCountsForRows`); the inspector's per-row pattern is the simpler case and stays inline.
- **The "compute exact" affordance for estimated counts is a placeholder.** The inspector renders a `~` + a small Sigma icon, but the wiring to escalate is not yet implemented (the engine returns `estimated: true` for tables above the threshold but the renderer doesn't yet have a "force exact count for this specific relation" path). Add when a user hits a large-table relation in practice; for the seed everything is under-threshold.
- **No keyboard nav within the inspector.** Tab moves between buttons via browser defaults, but there's no "Esc to close" wired yet, no "next/prev row" affordance, and no shortcut to focus the inspector when it's already open. Phase 2.5's UX pass picks this up.
- **Custom-relations m:n is out of scope this phase.** A user can't define an m:n custom relation (no junction field in the 2.4 editor). Phase 3's joins prompt revisits this. Until then m:n exists only as a schema-derived shape.
- **The `RowInspector` mounts every relation in the list as a JSX entry even when the count is undefined.** We filter on `countsByRelationId.has(rel.id)` so we don't render half-loaded state; large schemas with hundreds of relations would render hundreds of skipped entries during the loading window. Add a relevance pre-filter (only relations that reference the focused table) at the renderer level if this becomes a concern.


## 2026-06-17 — Phase 2.4: custom relations editor

**What was done**

Users can now create, edit, and delete custom `RelationDef`s through a "Manage relations" dialog in the SessionView topbar. Custom relations persist per-database (same scope as 2.1) and merge into `listRelations` alongside schema-derived ones — Phase 2.2's forward FK navigation, Phase 2.3's inspector + counts, and tabs-storage all pick them up automatically with no extra wiring. Server-side validation refuses column-count mismatch, non-unique target columns, source-not-unique for 1:1, and exact duplicates of schema-derived FKs. Pure-JS form validation in the renderer mirrors the engine's checks so the Save button only enables when the draft is submittable. Workspace tests: **320 → 332 ✓ + 3 skipped**.

**Files created**

- [apps/desktop/src/renderer/src/session/relations/validate.ts](apps/desktop/src/renderer/src/session/relations/validate.ts) — pure module. `validateCustomRelationDraft(draft, snapshot, existing)` returns an array of `ValidationIssue` discriminated by `kind` (one of `no-source-table`, `column-count-mismatch`, `target-not-unique`, `source-not-unique-for-1to1`, `duplicate-of-schema-derived`, etc.). `isDraftValid` for the boolean shortcut. `findTableInSnapshot` exposed for the form's column-list lookups.
- [apps/desktop/src/renderer/src/session/relations/validate.test.ts](apps/desktop/src/renderer/src/session/relations/validate.test.ts) — **12 unit tests** covering empty drafts, column-count mismatch, missing source table (stale-snapshot case), happy path (PK target), unique-index target (not the PK), non-unique target rejection, 1:1 rejection when source isn't unique, 1:1 happy path, duplicate-of-schema-derived rejection, allow-different-columns on the same source/target, and the "custom relations don't collide with each other" carve-out.
- [apps/desktop/src/renderer/src/session/relations/CustomRelationForm.tsx](apps/desktop/src/renderer/src/session/relations/CustomRelationForm.tsx) — the create/edit dialog. Side-by-side source/target panels, schema + table Select dropdowns chained to a column checklist (click order = pairing order — `#1`, `#2`, `…` badges next to checked columns), cardinality + display direction radios, optional labels, inline issue list that mirrors the validate module's output, Save button disabled until valid + while submitting.
- [apps/desktop/src/renderer/src/session/relations/RelationsManager.tsx](apps/desktop/src/renderer/src/session/relations/RelationsManager.tsx) — the list dialog opened from the topbar. Filter input + "+ New relation" CTA, schema/custom pills, cardinality badge, edit + delete icons on custom rows, confirm-then-delete with `window.confirm`. Mutations invalidate `relations.list` so the list re-renders fresh.

**Files modified**

- [packages/engine/src/relations.ts](packages/engine/src/relations.ts) — added `generateRelationUlid()` (48 bits time + 80 bits random, packed into 26 Crockford chars) and `areColumnsUniqueOnTable()` (exported so the engine's custom-relation validator and the renderer's form share semantics). The previously-private `areColumnsUnique` is gone — its sole caller (`deriveSchemaRelations`) now calls the exported version directly.
- [packages/engine/src/service.ts](packages/engine/src/service.ts) — new `CustomRelationInput` shape; `createCustomRelation(connectionId, input)` (fresh ULID + scope from profile + 5-step validation + duplicate-against-schema-derived check), `updateCustomRelation(connectionId, id, input)` (re-validates the new shape; refuses to update a schema-derived relation), `deleteCustomRelation(connectionId, id)` (idempotent; refuses persisted rows whose `source !== "custom"`); shared private `validateCustomRelation(snapshot, input)` keeps create + update in sync.
- [apps/desktop/src/main/trpc/inputs.ts](apps/desktop/src/main/trpc/inputs.ts) — `customRelationInputSchema`, `createCustomRelationInputSchema`, `updateCustomRelationInputSchema`, `deleteCustomRelationInputSchema`. Sides cap at 16 columns; labels at 255 chars.
- [apps/desktop/src/main/trpc/routers/relations.ts](apps/desktop/src/main/trpc/routers/relations.ts) — `relations.createCustom` / `updateCustom` / `deleteCustom` mutations. `asCustomRelationInput` cast follows the existing pattern (`asTablePageArgs`, `asFilteredTableRef`) for the Zod-vs-`exactOptionalPropertyTypes` boundary.
- [apps/desktop/src/renderer/src/session/SessionView.tsx](apps/desktop/src/renderer/src/session/SessionView.tsx) — new `relationsManagerOpen` state; "Relations" button next to "New SQL" in the topbar (only when connected); mounts `<RelationsManager>` at the root.
- [apps/desktop/test/integration.test.ts](apps/desktop/test/integration.test.ts) — extended the full-stack test with sections 6h–6m: create a custom 1:n (`orders.status → customers.email` — legal because `customers.email` is a unique constraint and there's no FK), assert id matches the ULID regex + `source === "custom"` + `listRelations` length grows by one; reject creation on non-unique target (`orders.placed_at` lookup); reject creation on column-count mismatch; reject creation when the shape duplicates an existing schema-derived FK; delete the custom relation + assert the list shrinks; verify delete is idempotent on schema-derived ids (no-op, not an error — schema-derived relations aren't persisted in `metadata.relations`, so the engine's source-check guard is unreachable through normal flow).

**Reasoning**

- **Engine is the authority; the renderer's validator is a UX shortcut.** The exact same 5 checks (column existence, count match, target uniqueness, source uniqueness for 1:1, schema-derived duplicate) run in both places. If they ever drift, the engine rejects whatever the renderer let through, with a `ValidationError` message the renderer surfaces inline. The renderer's check just disables the Save button proactively.
- **Renderer validator + engine validator do NOT share code.** The renderer pulls a thin pure module; the engine has its own private validator using the same primitives (`areColumnsUniqueOnTable` from `@perspectives/engine`). Duplication is intentional — the renderer can't depend on engine internals (the engine is Electron-main-side; the renderer is browser-side), so we keep two implementations and one shared primitive.
- **Fresh ULID at create-time, not deterministic.** Custom relations don't have a canonical FK shape to hash, so the deterministic-id trick from 2.1 doesn't apply. The 48-bit timestamp + 80-bit random pack is the standard ULID — sortable by creation time, 26 chars of Crockford base32 by construction, no I/L/O/U so it passes the DSL regex directly.
- **Scope cut: no user-defined m:n with custom junction.** The form's cardinality radio shows only `one-to-many` and `one-to-one`; the engine validates the same. Phase 3's structured joins will revisit m:n custom relations alongside `JoinDef`-aware planner work. The DSL's `RelationDef.junction` field already supports it — we're just not exposing the entry point.
- **Click-order pairing in the column checklist.** The form numbers checked columns `#1`, `#2`, `…` in the order they were checked; that order is what gets sent as the column array on save. This avoids needing a separate "sort" step and matches the convention that the i-th source column pairs with the i-th target column.
- **Two sibling Dialogs, not nested.** The `RelationsManager` (list) and `CustomRelationForm` (form) are independent shadcn Dialogs at the same DOM level. The manager owns the form's open state. Radix handles z-index stacking correctly when both are open. Nesting would have meant non-trivial focus-trap interactions.
- **Edit + delete affordances only on custom rows.** Schema-derived rows in the list view are read-only (the pill says "schema"); editing or deleting them doesn't make sense — they're recomputed every time. The icons just don't render for the schema-derived case.
- **`window.confirm` for delete, not a custom modal.** Confirm dialogs are one of the few cases where the OS-native modal is genuinely better — it's keyboard-blocking, visually distinct, and a user actually reads it before pressing OK. A bespoke Dialog adds two more components for the same UX.
- **Mutations don't pass an `id` from the client.** The engine generates the ULID inside `createCustomRelation`. The tRPC input shape carries `connectionId + relation: CustomRelationInput`, where `CustomRelationInput` is `RelationDef` minus `id` / `updatedAt` / `source` / `junction`. This means the renderer literally cannot fabricate ids (security + correctness boundary). Update operations carry the id separately as a top-level field.
- **Duplicate-of-schema-derived check works structurally, not by id.** A user might try to create `orders.customer_id → customers.id` even though the schema FK exists. The check compares `(from.schema, from.table, from.columns)` and `(to.schema, to.table, to.columns)` against every schema-derived relation in the snapshot. m:n schema-derived relations are skipped (their junction shape doesn't collide with a 1:n custom draft). Tests cover both the rejection and the carve-out for "same source/target with different columns".
- **`deleteCustomRelation` is silently idempotent for unknown ids.** The engine looks up the id in `metadata.relations`; if absent (which includes every schema-derived id, since they're computed not stored), it returns without doing anything. The `source !== "custom"` guard is belt-and-braces for the unreachable case where a persisted row happens to carry `source: "schema"`. The integration test documents this — delete on a schema-derived id resolves to undefined, not an error.
- **`updateCustomRelation` reuses create's validator.** The validator is private + side-effect free, so calling it twice is cheap. Update also doesn't re-check the "duplicate of schema-derived" rule — by definition the existing custom relation already had a unique id, and the update is changing its shape, not creating a new one. A potential edge case: editing a custom relation into the exact shape of a schema-derived one would slip through. Accept the gap for now; it's a self-inflicted footgun and the row would just be redundant, not harmful.
- **No renderer-side ULID generation.** Tempting to generate the id in the form and skip a server round-trip, but it'd let the renderer pick ids in a way that bypasses the engine's contract. Engine generates, returns the persisted RelationDef, renderer invalidates the relations.list query.

**Acceptance verification**

- `pnpm typecheck` workspace-wide → all 5 packages clean.
- `pnpm test` workspace-wide → **332 ✓ + 3 skipped**: dsl 31, engine 33, adapter-postgres 42, metadata-sqlite 35, desktop 191 (was 179; +12 validate unit tests + extended integration test with 6 new flows).
- Validate unit tests cover the exact prompt requirements: column-count mismatch detection, target uniqueness check (PK + unique-index variants), 1:1 source-uniqueness, schema-derived duplicate detection.
- Integration test against the seeded Postgres: creates `orders.status → customers.email` (legal because `customers.email` has a unique index and no schema FK already covers it); rejects non-unique target on `orders.placed_at`; rejects column-count mismatch; rejects exact-duplicate of `orders.customer_id → customers.id`; deletes the custom relation cleanly.
- Native binary state at end of session: rebuilt for Electron ABI so the next `pnpm dev` is immediate.
- Manual flow (Electron): launch `pnpm dev`, open the seeded connection, click "Relations" in the topbar → list of every schema-derived + custom relation. Click "+ New relation" → form opens. Pick source `public.orders.status` + target `public.customers.email` + cardinality 1:n + label "billed customer" → Save. Manager refreshes. Open the orders table → `status` column now shows a forward arrow on hover. Click → filtered customers tab opens. Open the customers table → press `i` on a row → inspector lists the new reverse entry. Back in Relations manager → edit → change label → Save → labels update across the app. Delete → row vanishes from the list and arrows disappear from the grid.

**Caveats / follow-ups**

- **m:n custom relations deferred to Phase 3.** A user can't define an m:n with a custom junction yet. The DSL's `RelationDef` supports it; the editor doesn't expose the field. Phase 3's `JoinDef`-aware planner will revisit.
- **Column-pairing UX is checkbox-with-click-order.** Works fine for ≤4-column compounds but gets fiddly past that. A drag-handle "reorder selected columns" affordance is the natural upgrade.
- **No "duplicate this relation as a starting point" affordance.** A user wanting two near-identical custom relations has to fill the form twice. Add when there's a real complaint.
- **`window.alert`/`confirm` for delete feedback is OS-native.** Fine for read-only contexts but might feel out of place if the rest of the UI adopts a richer toast system later. The form's submitError surface already uses an inline shadcn Alert; deletion could move to the same pattern.
- **Update doesn't re-check schema-derived duplicates.** Theoretical footgun: edit a custom relation into the exact shape of a schema FK and you've got a redundant row. Low-impact (the row would just be redundant) but worth a `belt-and-braces` check on update if it ever becomes a real friction. Easy add: thread the schema-derived duplicate check through `validateCustomRelation` and exempt the current id from comparison.
- **Form fields aren't ARIA-grouped.** Each `<fieldset>` has a `<legend>` but the cardinality / display-direction radios don't yet have `aria-describedby` tying them to the helper text. Accessibility pass should sweep this.
- **No "audit columns" allow-list expansion for the form.** Junction policies (Phase 2.3) accept audit columns; custom-relation validation has no equivalent leniency since the targets must be PK or unique — audit columns aren't usually unique. Not currently a problem.


## 2026-06-17 — Phase 2.4 follow-up: inspector counts work for non-PK-target relations

**What was done**

Bug reported from manual testing: opening the row inspector on a customer row after the Phase 2.4 custom relation existed (`orders.status → customers.email`) failed with:

> Couldn't load counts — Target column "email" is not part of the focused PK [id]

The engine's `getReferencingCounts` took `pkValues: Array<…>` and `buildJoinFilter` mapped target columns through `focusedPkOrder.indexOf(...)` — which throws when the target column isn't part of the PK. Custom relations that reference a unique non-PK column (the whole point of the integration test from 2.4) hit that branch and crash the inspector.

Fix: `getReferencingCounts` now takes a `rowValues: Record<column, primitive>` map, and the new `buildJoinFilterFromRow` looks values up by column name. Relations whose target columns aren't in `rowValues` (e.g. non-primitive columns the renderer pre-filtered out) are skipped — no count entry, no error, no broken inspector.

The renderer's pre-filter (`pickRowValues`) keeps only `string | number | boolean | null` entries from a row before sending. Dates / Buffers / JSON values / bigints get dropped — they never appear as FK targets in real schemas, and shipping them over IPC would either fail Zod validation or waste bandwidth.

**Files changed**

- [packages/engine/src/service.ts](packages/engine/src/service.ts) — `getReferencingCounts(connectionId, schema, table, rowValues)`. `buildJoinFilter` renamed to `buildJoinFilterFromRow`, returns `null` instead of throwing when a target column is missing.
- [apps/desktop/src/main/trpc/inputs.ts](apps/desktop/src/main/trpc/inputs.ts) — `getReferencingCountsInputSchema.rowValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))`.
- [apps/desktop/src/main/trpc/routers/data.ts](apps/desktop/src/main/trpc/routers/data.ts) — wire through `input.rowValues`.
- [apps/desktop/src/renderer/src/session/inspector.ts](apps/desktop/src/renderer/src/session/inspector.ts) — `buildReferencingTarget(relation, schema, table, rowValues)` (drops the `pkOrder`/`pkValues` pair). New `pickRowValues(row)` helper exported.
- [apps/desktop/src/renderer/src/session/inspector.test.ts](apps/desktop/src/renderer/src/session/inspector.test.ts) — tests rewritten to the new signature, +1 test for the custom-relation-targets-non-PK case (the regression we're fixing), +2 tests for `pickRowValues` (keep primitives, drop everything else).
- [apps/desktop/src/renderer/src/session/RowInspector.tsx](apps/desktop/src/renderer/src/session/RowInspector.tsx) — `rowValues` prop instead of `pkValues`; header derives PK display from `pkOrder.map(c => rowValues[c])`.
- [apps/desktop/src/renderer/src/session/TableView.tsx](apps/desktop/src/renderer/src/session/TableView.tsx) — `handleInspectRow` captures `pickRowValues(sourceRow)`; tRPC input uses `rowValues`.
- [apps/desktop/test/integration.test.ts](apps/desktop/test/integration.test.ts) — sections 6g/6h: the existing call now uses `rowValues`; new assertion explicitly proves the custom relation's count comes back (count=0 because no row's status matches `customer1@example.com`, but the path no longer throws).

**Reasoning**

- **The error message was correct but the contract was wrong.** Pinning the input to PK values bakes in the assumption that all targets are PK columns. That holds for schema-derived FKs and was fine through 2.3, but Phase 2.4 explicitly allows custom relations to target any unique column. The fix is at the contract level: send what the engine might need, look it up by name.
- **Pre-filter to primitives in the renderer, not on the wire.** The renderer already has the row; iterating Object.entries and keeping primitives is one cheap pass. Zod-rejecting on Date / Buffer would force every column-non-primitive table to fail the inspector entirely.
- **`buildJoinFilterFromRow` returns null instead of throwing.** A missing column is a "skip this relation" signal, not a programming error — the caller (engine + renderer) iterates over all relations and drops the ones it can't satisfy. Throws here would propagate to the inspector UI as the original crash.
- **Renderer's `buildReferencingTarget` signature simplified.** No more `pkOrder`/`pkValues` indirection — column-name lookups against `rowValues` are direct. The old "PK declaration order vs FK column order" edge case still works (we look up by name on both sides).
- **TanStack Query cache key now includes the full primitive subset.** Switching from a fixed-length array to an open Map means two opens of the same row hit the cache (deep-equal); two different rows produce different cache entries naturally.

**Acceptance verification**

- `pnpm typecheck` workspace-wide → all 5 packages clean.
- `pnpm test` workspace-wide → **336 ✓ + 3 skipped** (was 332; +4 inspector tests for the new shape + 2 `pickRowValues` cases + the integration test now also asserts the custom relation surfaces a count).
- Manual test against the running app: open a customer row → press `i` → inspector loads without the "not part of the focused PK" error. "Referenced by" lists orders + the m:n tags entry + the new custom `billed customer` entry. The custom entry shows count 0 (no `orders.status` value happens to equal an `@example.com` address, which is the right answer).
- Native binary state at end of session: rebuilt for Electron ABI.


## 2026-06-17 — Phase 2.5: display config + row label template

**What was done**

Per-table display configuration is now persistent + plumbed into the two consumers the prompt called out: FK cell rendering and breadcrumb labels. A new gear icon in the table header opens a settings dialog with a Display tab (display column / secondary column / row label template). Saving writes a `DisplayConfig` row scoped by `(host, port, database, schema, table)` — the same scope key custom relations + junction policies use. Batched label resolution goes through a single round trip per target table via an OR-of-AND-of-eq filter, no adapter change required. Workspace tests: **336 → 353 ✓ + 3 skipped**.

**Compound-PK decision**: option (b) — OR of per-tuple AND groups via the existing FilterGroup compiler. No adapter change. SQL grows linearly with batch size; capped at MAX_LABEL_BATCH = 200. The adapter-level "single round trip" property is preserved by `adapter.runQuery(plan)` doing one query for the whole batch.

**Files created**

- [packages/metadata-sqlite/src/migrations/0003_display_configs_scope.sql](packages/metadata-sqlite/src/migrations/0003_display_configs_scope.sql) — drop + recreate `display_configs` with composite primary key `(scope, schema_name, table_name)`. SQLite can't ALTER the PK in place, so the migration creates a new table, copies any pre-2.5 rows (assigning them to the empty-string scope), drops the old, and renames. Schemas with embedded dots in their names break the migration; the engine's writers never emit such ids in practice.
- [packages/engine/src/display.ts](packages/engine/src/display.ts) — pure helpers. `formatRowLabel(row, pkColumns, config)` handles template > displayColumn > PK fallback. `formatRowLabelWithSecondary` returns both lines. `extractTemplateColumns` discovers `{column}` references so the engine knows which columns to project in the batched fetch.
- [packages/engine/test/display.test.ts](packages/engine/test/display.test.ts) — **17 unit tests** covering template substitution, missing/null fields rendering empty, numeric/boolean/bigint/Date stringification, displayColumn fallback, PK-only fallback, secondary-column extraction, and the unknown-template-column edge case.
- [apps/desktop/src/main/trpc/routers/displayConfig.ts](apps/desktop/src/main/trpc/routers/displayConfig.ts) — `displayConfig.getForTable / upsert / delete` procedures.
- [apps/desktop/src/renderer/src/session/TableSettingsDialog.tsx](apps/desktop/src/renderer/src/session/TableSettingsDialog.tsx) — the gear-icon settings dialog. Display column select, optional secondary column, free-form template input with live template-column extraction (highlights unknown columns in amber). Persists via tRPC + invalidates the cache.
- [apps/desktop/src/renderer/src/session/useFkLabels.ts](apps/desktop/src/renderer/src/session/useFkLabels.ts) — batched label resolver for the visible grid page. Walks the columns with FK links + the visible rows, dedupes per target table, fires one round trip per target via `data.getRowLabels`. Returns a synchronous lookup the DataGrid calls on render. Session-cached; survives row navigation, no invalidation on Refresh (target rows haven't changed).

**Files modified**

- [packages/engine/src/metadata.ts](packages/engine/src/metadata.ts) — new `DisplayConfigRepository` interface (scoped CRUD: `getForTable` / `listForScope` / `upsert` / `delete`); `MetadataStore.displayConfig` switched from `CRUDStore<DisplayConfig>` to `DisplayConfigRepository`.
- [packages/engine/src/service.ts](packages/engine/src/service.ts) — `getDisplayConfig`, `upsertDisplayConfig`, `deleteDisplayConfig`, `getRowLabels(connectionId, schema, table, pkTuples)` with single-round-trip OR-of-AND-of-eq compilation, `MAX_LABEL_BATCH = 200` cap, normalised PK-tuple stringification (so `1` matches pg's int8-as-string `"1"`), `scopeForConnection` helper.
- [packages/engine/src/index.ts](packages/engine/src/index.ts) — re-export display module.
- [packages/metadata-sqlite/src/display-configs.ts](packages/metadata-sqlite/src/display-configs.ts) — rewrite as `DisplayConfigsStore implements DisplayConfigRepository`. UPSERT via `ON CONFLICT (scope, schema_name, table_name) DO UPDATE`. Old `displayConfigId` helper removed.
- [packages/metadata-sqlite/src/migrations-index.ts](packages/metadata-sqlite/src/migrations-index.ts) — bundles 0003.
- [packages/metadata-sqlite/src/index.ts](packages/metadata-sqlite/src/index.ts) — export `DisplayConfigsStore` (was the now-removed `displayConfigId`).
- [apps/desktop/src/main/trpc/inputs.ts](apps/desktop/src/main/trpc/inputs.ts) — `getDisplayConfigInputSchema`, `upsertDisplayConfigInputSchema`, `deleteDisplayConfigInputSchema`, `getRowLabelsInputSchema` (with `pkTuples.min(1).max(200)`).
- [apps/desktop/src/main/trpc/routers/data.ts](apps/desktop/src/main/trpc/routers/data.ts) — `data.getRowLabels` procedure.
- [apps/desktop/src/main/trpc/router.ts](apps/desktop/src/main/trpc/router.ts) — wired the displayConfig router.
- [apps/desktop/src/renderer/src/grid/types.ts](apps/desktop/src/renderer/src/grid/types.ts) — new `DataGridProps.linkLabelFor`.
- [apps/desktop/src/renderer/src/grid/cells.tsx](apps/desktop/src/renderer/src/grid/cells.tsx) — `LinkCell` accepts an optional `label`; when non-empty, renders the label in place of the raw FK value (with the raw value as the `title` attribute for hover).
- [apps/desktop/src/renderer/src/grid/DataGrid.tsx](apps/desktop/src/renderer/src/grid/DataGrid.tsx) — threading `linkLabelFor` through Body / BodyRow into LinkCell.
- [apps/desktop/src/renderer/src/session/TableView.tsx](apps/desktop/src/renderer/src/session/TableView.tsx) — gear-icon button in the header; mounts `TableSettingsDialog`; calls `useFkLabels` for the visible page; passes the lookup to DataGrid; `handleFollow` now pipelines `getRowByKey` + `getRowLabels` and uses the resolved label for the new breadcrumb step (falls back to the synthetic PK label when no DisplayConfig exists).
- [apps/desktop/test/integration.test.ts](apps/desktop/test/integration.test.ts) — sections 6n + 6o: upsert/getForTable round-trip on `customers`, batch label fetch for 3 customers via template (`{full_name} ({country_code})`), missing-row case (returns empty string at that position), compound-PK batch on `warehouses` (`(1, "B2")` first, `(1, "A1")` second — labels come back in input order via PK fallback), delete + re-fetch returns null, and the fallback when no config exists at all.

**Reasoning**

- **DisplayConfigRepository is a fresh interface, not an extension of CRUDStore.** Display configs are keyed by `(scope, schema, table)`, which doesn't fit the `CRUDStore<T>.id` model cleanly. The new interface exposes `getForTable(scope, schema, table)` directly — same pattern as `RelationsRepository` from 2.1. The Phase 1.3 stub had no callers, so the breaking interface change was free.
- **Upsert, not create + update.** The user's UX is "save this config" — they don't think in terms of "first time vs subsequent saves". SQLite's `INSERT … ON CONFLICT DO UPDATE` collapses both into one statement.
- **Scope = `(dialect, host, port, database)`, same as custom relations.** Two profiles pointing at the same DB share configs; renaming a profile doesn't orphan them.
- **`formatRowLabel` is pure + lives in `@perspectives/engine`.** The engine uses it server-side inside `getRowLabels`; the renderer could in principle import it too (it has no Node deps), but the renderer never sees the raw row + config together in the same place — `getRowLabels` is the only path. Keeping the pure helper means the engine unit-tests cover template semantics without spinning up Postgres.
- **Compound-PK batch via OR-of-AND.** Option (b) from the prompt's amendment list. No adapter change; the existing FilterGroup compiler handles `op: "or"` with `op: "and"` children. SQL size grows linearly with batch size — at 16-column PKs × 200 rows that's ~6,400 leaf comparisons, well under any pg client limit. The `MAX_LABEL_BATCH = 200` cap keeps it bounded.
- **Single round trip per target table, not per (table × column).** A row inspector that surfaces 5 FK columns to the same target table only fires one `getRowLabels` call. The hook dedupes pkTuples per target.
- **PK-tuple keying normalises primitives via `String(v)`.** pg returns int8 as JS strings by default; the test sends number `1`. Without normalisation, `JSON.stringify([1])` !== `JSON.stringify(["1"])` and the engine misses the row in its result map. The normalisation applies symmetrically to both sides, so booleans / numbers / strings all match across the type boundary.
- **`getRowLabels` projects only the columns it needs.** PK columns (for matching results back to pkTuples) + `displayColumn` + `secondaryColumn` + every column referenced by `extractTemplateColumns(template)`. A 30-column table with a `full_name` display config fetches 2 columns per row, not 30.
- **`useFkLabels` is in-component state + an effect, not a tRPC `useQuery`.** TanStack Query's `useQuery` would need a stable query key built from `(connectionId, schema, table, pkTuples)`, and pkTuples changes with every page scroll. The cache key explosion would flood the QueryClient. A single in-component Map keyed by `(targetKey, pkKey)` is cheap, easy to reason about, and survives page changes naturally. Lifetime = the table tab. Closing the tab clears the cache; opening it again refetches.
- **`linkLabelFor` is a synchronous callback from the grid.** The grid renders many cells; we can't `await` per render. The hook returns whatever's in the cache (or null), and the grid re-renders when the labelMap state changes. Returning null causes the grid to render the raw FK value as before — a graceful fallback for "loading", "no DisplayConfig", or "label is the empty string".
- **`handleFollow` pipelines `getRowByKey` + `getRowLabels`.** Two parallel calls, one for existence + one for the breadcrumb label. Same database, same connection — the parallel fetch is essentially free latency-wise. The cached `useFkLabels` lookup would only work for FK clicks on rows the visible page knows about; the parallel fetch covers compound-FK clicks and any future flows.
- **Empty-string label = "no config" fallback for the grid.** `getRowLabels` returns `""` for "row exists but no display config + no template + no PK fallback applies" (edge case). The grid treats `""` as "use the raw value". The breadcrumb code does the same — fall back to `formatBreadcrumbLabel(table, pkValues)` when the resolved label is empty.
- **The settings dialog hosts only the Display tab today.** Phase 2.3's junction-policy editor and Phase 2.4's custom-relation gear would also belong in this dialog as additional tabs; the dialog's structure (DialogContent with a section per concept) trivially expands. Keeping it as a single-section dialog for now avoids tab-bar UI for one item.
- **Template language is `{column}` literal substitution, nothing else.** No escaping rules, no expressions, no conditionals. Five lines of regex in `resolveTemplate`. Power users wanting more reach for a custom column (Phase 3 territory) or a SQL perspective.

**Acceptance verification**

- `pnpm typecheck` workspace-wide → all 5 packages clean.
- `pnpm test` workspace-wide → **353 ✓ + 3 skipped**: dsl 31, engine 50 (was 33; +17 display helper unit tests), adapter-postgres 42, metadata-sqlite 35, desktop 195 (no new test files; integration test extended with sections 6n + 6o).
- Pure-unit `formatRowLabel` tests cover the prompt's literal requirements: `"{first_name} {last_name}"` against `{first_name: "Ada", last_name: "Lovelace"}` → `"Ada Lovelace"`; null fields render as empty; missing fields treated as null; numeric/boolean/bigint/Date stringification.
- Integration test against the seeded Postgres: upserts a customers DisplayConfig with template `"{full_name} ({country_code})"`, batch-fetches labels for customers 1/2/3 → `"Customer 1 (FR)"` / `"Customer 2 (NL)"` / `"Customer 3 (IT)"` (single round trip via the OR-of-AND filter); missing row at position 2 in `[1, 99999, 3]` returns empty string; compound-PK batch on warehouses returns labels in INPUT order (`[1,"B2"]` first → `"1·B2"`, `[1,"A1"]` second → `"1·A1"`) using the PK-fallback (no DisplayConfig on warehouses); deleting the config + re-fetching returns null + labels fall back to the PK.
- Native binary state at end of session: rebuilt for Electron ABI.
- Manual flow (Electron): launch `pnpm dev`, open the seeded connection, open `customers`. Click the gear icon → settings dialog opens. Pick `full_name` as display column, type `{full_name} ({country_code})` as the template → Save. Open `orders`. The `customer_id` column now shows `"Customer 1 (FR)"` instead of `1`. Hover the cell — the original FK value is in the title attribute. Click → filtered customers tab opens; breadcrumb reads `orders › Customer 1 (FR)` instead of `orders › customers[1]`. Open the table-settings dialog and click "Clear settings" → labels disappear, FK cells revert to raw values, breadcrumbs revert to `customers[1]`.

**Caveats / follow-ups**

- **m:n FK cells don't get labels.** Phase 2.2's grid annotation only carries 1:n / 1:1 forward links, so the issue is moot today. When Phase 3 surfaces m:n inline, the hook will need to also handle the junction-side path.
- **No reorder/drag for multiple display columns.** A user wanting `"{last_name}, {first_name}"` types it in the template field. Fine for v1; a column-picker UX is a separate phase.
- **No live preview in the settings dialog.** Save + close + look at the grid is the loop. Adding a preview row inside the dialog is straightforward (call `data.getRowLabels` for a representative PK), but adds tRPC plumbing for the dialog itself.
- **Inspector "Referenced by" entries don't use labels yet.** The prompt lists this as a TBD-threshold consumer; not wired this phase. Would require enumerating the matching rows (not just counting them) when count ≤ small-N. Add when there's a real complaint.
- **FK label resolution races the page render.** Visible cells flash the raw value for a few hundred ms before the labels arrive (especially on first load). The hook fires immediately after rows mount; users notice the swap. A skeleton or a "labels loading" pulse would polish this — defer to the UX pass.
- **Compound-PK label batches over very wide PKs explode SQL size.** At 16-column PKs × 200 rows, the SQL is ~6,400 OR-of-AND leaves. Postgres handles this fine; client RAM is the limit. The MAX_LABEL_BATCH cap is the throttle; raise if needed.
- **The `Settings` icon in the gear position next to Refresh is a per-table button.** It doesn't show what's configured at a glance. A small indicator (e.g. a dot on the gear when a custom display is active) would surface the state without opening the dialog. Defer.
- **Renderer skips label resolution when the target's `to.columns` differ from the target's PK column order.** The hook constructs pkTuples from `rel.from.columns` paired positionally with `rel.to.columns`; the engine indexes results by the target's PK declaration order. For typical FKs that reference the parent's PK in PK order these match; for FKs that reference a unique non-PK column or that re-order the PK columns, the lookup misses. That's a Phase 3 concern when joins compile this for real; for now we accept the silent fallback to "no label".


## 2026-06-18 — Phase 2.5 follow-up: black screen on launch (runtime value import from `@perspectives/engine`)

**Bug**: after 2.5 shipped, launching `pnpm dev` opened a black, unresponsive Electron window. The renderer never rendered.

**Root cause**: `TableSettingsDialog.tsx` had a runtime *value* import from `@perspectives/engine`:

```ts
import { extractTemplateColumns, type ColumnInfo, type DisplayConfig } from "@perspectives/engine";
```

Every other renderer file uses `import type` from the engine — types are erased at build time, so no engine runtime code lands in the renderer bundle. The new value import pulled the engine barrel (`@perspectives/engine/src/index.ts`) into the renderer chunk, which transitively imports `node:crypto` from `service.ts` (`randomUUID`) and `relations.ts` (`randomBytes`). Vite externalises Node built-ins for the browser; the imported references become proxies that throw on any property access. Touching them during module evaluation crashes the renderer silently before React mounts → black screen.

**Fix**:

- [apps/desktop/src/renderer/src/session/TableSettingsDialog.tsx](apps/desktop/src/renderer/src/session/TableSettingsDialog.tsx) — drop the runtime import; inline a small local copy of `extractTemplateColumns` (six lines + a regex; kept in sync with the engine's copy via a header comment).
- [packages/engine/package.json](packages/engine/package.json) — added `"sideEffects": false` so Vite tree-shakes unused engine modules from the renderer chunk if a future file makes the same mistake. Tree-shaking alone would have caught most of this, but the prevention is cheap.

**Acceptance verification**

- `pnpm typecheck && pnpm test` workspace-wide → all 5 packages clean, **358 ✓ + 3 skipped** (DSL picked up 5 tests during the period; unrelated to this fix).
- The renderer no longer pulls a value from `@perspectives/engine`. Confirmed by `grep -rn 'from "@perspectives/engine"' apps/desktop/src/renderer/` — every remaining hit is `import type`.

**Reasoning**

- **The error mode was silent because Vite externalises Node built-ins lazily**: the import doesn't crash at build time; the externalised module is a Proxy that only throws when accessed. The renderer's barrel-import-of-engine pulled `randomUUID` / `randomBytes` references in alongside the helper I actually wanted, and *something* in the bundling pipeline triggered access during module evaluation. The result is a "module loaded but won't render" failure mode that doesn't surface a stack trace in normal screens — devtools console would have shown the underlying error.
- **The pattern to follow**: anything pure that the renderer needs from the engine lives in [packages/dsl](packages/dsl/) (which has zero Node deps) OR gets duplicated in the renderer. The engine is for the main process; the renderer talks to it through tRPC, not through direct imports.
- **`sideEffects: false`**: the engine modules have no top-level side effects (no `console.log`, no global mutations). Marking it explicitly lets Vite drop unreferenced modules from the renderer chunk when value imports do sneak in. Safety net, not the primary fix.

**Caveats**

- **The renderer's copy of `extractTemplateColumns` can drift from the engine's.** A header comment tells future-me to update both. A long-term fix is to extract pure helpers like this into `@perspectives/dsl` (which IS renderer-safe), but that's a separate refactor.
- **Other future hazards** — any renderer file that imports `formatRowLabel`, `formatRowLabelWithSecondary`, `generateRelationUlid`, `deterministicRelationId`, or any other runtime value from `@perspectives/engine` will trip the same wire. The lint rule that would prevent this (`no-restricted-imports` for the engine value imports in renderer) is a sensible TODO.


---

## 2026-06-25 — Bugfix: FK cell labels never appeared even with DisplayConfig set

**Symptom**

After Phase 2.5 shipped, the user configured DisplayConfig for `customers` (displayColumn = `full_name`, template = `{full_name} ({country_code})`) and opened the `orders` tab. The `customer_id` column rendered raw FK values ("1", "2", …) instead of the expected "Customer 1 (FR)" labels. A fresh `orders` tab did not help.

**Probe**

A live diagnostic test against the user's actual SQLite + docker-compose Postgres confirmed:

- `display_configs` row IS persisted with the correct scope (`postgres://localhost:5433/perspectives_dev`) and payload.
- `EngineService.getRowLabels`/`formatRowLabel` returns `"Customer 1 (FR)"` for `customers.id = "1"`.

So the engine path was fine. The bug was in the renderer.

**Root cause** — [apps/desktop/src/renderer/src/session/useFkLabels.ts](apps/desktop/src/renderer/src/session/useFkLabels.ts)

A long-lived `inFlightRef: Set<string>` was deduping concurrent fetches across re-renders. Under React StrictMode (always on in `apps/desktop/src/renderer/src/main.tsx`), the dev-only mount → cleanup → remount cycle leaked:

1. Mount 1 effect: `cancelled1 = false`. Adds every tuple's key to `inFlightRef`. Fires fetch.
2. Cleanup: `cancelled1 = true`. `inFlightRef` NOT cleared.
3. Mount 2 effect (StrictMode replay): `cancelled2 = false`. Sees every tuple in `inFlightRef`, computes `missing.length === 0` for every target, never fetches, never calls `setLabelMap`.
4. Mount 1's fetch resolves: `cancelled1 = true` short-circuits before `setLabelMap`. Its `finally` removes the in-flight keys.
5. End state: `labelMap` empty → `linkLabelFor` returns `null` for every FK cell → grid renders raw values.

**Fix**

Removed the in-flight tracker entirely. The per-effect `cancelled` closure already gives race-correctness, and the persistent `labelMap` already prevents refetches across re-renders. The tracker only saved a duplicate fetch in a very narrow case (deps change mid-flight while no labels have committed yet) — not worth the StrictMode landmine.

- [apps/desktop/src/renderer/src/session/useFkLabels.ts](apps/desktop/src/renderer/src/session/useFkLabels.ts) — drop `inFlightRef` and the surrounding `inFlightKey` bookkeeping. Header note on `labelMapRef` explains why the tracker is gone, so the next person doesn't reintroduce it.

**Acceptance verification**

- `pnpm -w turbo run typecheck` → 5/5 clean.
- Renderer behaviour to verify by hand: open `orders` tab → FK cells in `customer_id` column show "Customer N (XX)" labels instead of raw IDs.

**Caveats / follow-ups**

- Cache invalidation still imperfect: `useFkLabels` doesn't watch the DisplayConfig query, so editing a target table's config while a source-table tab is mounted won't refresh that tab's already-cached labels. Today the user is forced to switch tabs (which remounts `TableView` via its `key={kind:schema.table}`). If we want live propagation, the right move is to migrate the hook to TanStack Query and invalidate `data.getRowLabels` on `displayConfig.upsert`. Deferred.
- A renderer test that mounts the hook under StrictMode and asserts labels reach the grid would have caught this. Worth adding when we revisit grid testing.

---

## 2026-06-29 — Bugfix: custom non-PK relation poisoned FK label batch

**Symptom**

After the StrictMode fix landed, FK labels still didn't show on the `orders` tab. Renderer console revealed the real reason:

```
[fk-labels] → getRowLabels { target: 'public.customers', missing: 104, sample: [...] }
[fk-labels] getRowLabels FAILED { cause: TRPCClientError: invalid input syntax for type bigint: "shipped" }
```

**Root cause** — [apps/desktop/src/renderer/src/session/useFkLabels.ts](apps/desktop/src/renderer/src/session/useFkLabels.ts), [apps/desktop/src/renderer/src/session/TableView.tsx](apps/desktop/src/renderer/src/session/TableView.tsx)

Phase 2.4 lets users define custom relations that reference unique non-PK columns (the canonical example: `orders.status → customers.email`). The hook iterated every column-with-link and unconditionally fed the source column's values into a PK-keyed lookup against the target table. For `orders.status`, it pushed `"shipped"`, `"pending"`, etc. into the `public.customers` pkTuple batch. Postgres rejected the cast (`bigint` PK can't accept `"shipped"`), the entire batch failed, and even the legitimate `orders.customer_id → customers.id` relation got no labels back.

**Fix**

Annotate every `ForwardLink` with `targetIsPk: boolean` — true iff `relation.to.columns` matches the target table's `primaryKey` exactly (same length, same order). The label hook skips any link with `targetIsPk === false`. Click-to-follow / arrow rendering are unchanged — those work for any relation.

- [apps/desktop/src/renderer/src/grid/types.ts](apps/desktop/src/renderer/src/grid/types.ts) — added `targetIsPk` to `ForwardLink`.
- [apps/desktop/src/renderer/src/session/TableView.tsx](apps/desktop/src/renderer/src/session/TableView.tsx) — added `tablesByKey` map of `${schema}.${table} → { primaryKey }` built from the snapshot; `gridColumns` now computes `targetIsPk` per link by comparing `relation.to.columns` against the target's PK.
- [apps/desktop/src/renderer/src/session/useFkLabels.ts](apps/desktop/src/renderer/src/session/useFkLabels.ts) — `required` memo skips links with `targetIsPk === false`. Also dropped the StrictMode-bug-finding diagnostic logs from the previous step.

**Acceptance verification**

- `pnpm -w turbo run typecheck` → all 5 packages clean.
- `apps/desktop/src/renderer/src/session/links.test.ts` — 13/13 passing (links module untouched; `buildColumnLinkMap` still returns `Map<string, RelationDef>`).
- Manual: open `orders` tab — `customer_id` cells render "Customer N (XX)" while `status` cells keep their click-to-follow arrow but show the raw enum value.

**Caveats / follow-ups**

- The hook still assumes that when `targetIsPk === true`, the FK columns line up positionally with the target's PK columns. That holds for every schema-derived FK we generate. A maliciously hand-edited custom relation that points at the PK but in a different column order would mis-key the lookup — but the worst case is wrong labels, not a SQL crash.
- The engine's `getRowLabels` should also defensively reject non-PK-shaped lookups instead of trusting the renderer. Filed mentally as a hardening pass for Phase 4.
- Long-term, supporting label lookups for unique non-PK columns is reasonable — would require `getRowLabels` to accept a `lookupColumns` parameter and key results by that instead of PK. Not worth the API churn for Phase 2.

---

## 2026-07-01 — Phase 2.6: Cardinality preview badges

**Goal**

Surface an inline count for 1-2 outbound relations on each visible row, so opening `customers` shows "3 orders" per row without a click. Estimated when the target is huge, exact when it isn't; user can click a `~` badge to escalate to exact.

**DSL** — [packages/dsl/src/schemas.ts](packages/dsl/src/schemas.ts)

Extended `DisplayConfig`:

- `displayColumn` moved to optional so a config can be cardinality-only.
- New `cardinalityRelations?: string[]` (0-2 relation IDs). Absent/empty means preview is off.

**Engine** — [packages/engine/src/service.ts](packages/engine/src/service.ts), [packages/engine/src/adapter.ts](packages/engine/src/adapter.ts), [packages/adapter-postgres/src/adapter.ts](packages/adapter-postgres/src/adapter.ts)

New method:

```
engine.getCountsForRows(connectionId, schema, table, pkTuples, relationIds, { forceExact? })
  → Array<{ pkTuple, relationId, count, estimated }>
```

Per relation:

- Resolve target + group columns for 1:n (source = parent side) and m:n (either side via junction). Anything else is silently skipped, including the earlier "custom relation → unique non-PK column" case that bit us in 2.5.
- Above `REFERENCING_COUNT_THRESHOLD` (100k) on the target: per-row `estimateCount` (one EXPLAIN per tuple, tagged `estimated: true`).
- Below: one grouped `countByGroup(schema, table, groupColumns, inTuples)` round trip. The adapter method composes `SELECT groupColumns, COUNT(*) FROM t WHERE (groupColumns) IN (inTuples) GROUP BY groupColumns` and returns `{key, count}[]`; the engine maps keys back to input pkTuples so missing rows get an explicit `{count: 0}` entry instead of being dropped.
- `forceExact: true` bypasses the threshold — used by the "click to escalate" affordance on estimate badges.

`countByGroup` is on the `DatabaseAdapter` interface so raw SQL stays inside adapter-postgres. Uses the existing `quoteIdentifier` helper and Postgres row-value `IN` syntax; single-column and compound PKs share the same code path (Postgres treats `(col) IN ((v1),(v2))` as `col IN (v1,v2)`).

Batch caps: `MAX_COUNT_BATCH = 200` rows, `MAX_PREVIEW_RELATIONS = 2`.

**tRPC**

- [apps/desktop/src/main/trpc/inputs.ts](apps/desktop/src/main/trpc/inputs.ts) — `getCountsForRowsInputSchema` (rows ≤ 200, relations ≤ 2, optional `forceExact`), and extended `displayConfigPayloadSchema` (`displayColumn` optional, added `cardinalityRelations`).
- [apps/desktop/src/main/trpc/routers/data.ts](apps/desktop/src/main/trpc/routers/data.ts) — `data.getCountsForRows` procedure.

**Renderer**

- [apps/desktop/src/renderer/src/session/cardinality-cache.ts](apps/desktop/src/renderer/src/session/cardinality-cache.ts) — pure cache primitives (`tupleKey`, `distinctPkTuples`, `missingForRelation`, `mergeResults`). Kept separate from the hook so scroll / cache-hit semantics are unit-testable without React + tRPC.
- [apps/desktop/src/renderer/src/session/useRowCardinalities.ts](apps/desktop/src/renderer/src/session/useRowCardinalities.ts) — hook. Local `Map<relationId, Map<tupleKey, {count, estimated}>>` state. Effect fires one round-trip per relation for missing tuples on `(pkTuples, relationIds, source)` change. `countsFor(row)` returns `null` while loading. `escalate(row, relId)` calls the endpoint with `forceExact: true`.

  Same StrictMode caveat as `useFkLabels` — no in-flight tracker; `cancelled` closure + persistent cache handle correctness.

- [apps/desktop/src/renderer/src/session/TableSettingsDialog.tsx](apps/desktop/src/renderer/src/session/TableSettingsDialog.tsx) — new "Preview cardinality" section. Lists outbound relations eligible for preview (1:n with source on parent side and `to.columns === source PK`, or m:n where the source side's columns match the PK). Native checkboxes with a hard cap of 2 selections. `displayColumn` no longer required to save — every field is independently optional now.

  New required props: `primaryKey`, `relations`. TableView threads them from the schema snapshot + relations query.

- [apps/desktop/src/renderer/src/grid/types.ts](apps/desktop/src/renderer/src/grid/types.ts) + [apps/desktop/src/renderer/src/grid/DataGrid.tsx](apps/desktop/src/renderer/src/grid/DataGrid.tsx) — added three optional props: `badgeAreaWidth`, `badgeHeader`, `renderRowBadges`. When width > 0, header + rows + skeleton reserve a fixed slot between the gutter and the first data column. Rendering is a `ReactNode` from the caller — the grid stays presentational; the renderer does formatting, tooltip text, and click wiring.

- [apps/desktop/src/renderer/src/session/TableView.tsx](apps/desktop/src/renderer/src/session/TableView.tsx) — reads `DisplayConfig.cardinalityRelations`, runs `useRowCardinalities`, and renders one small pill per relation per row. `~` prefix + amber styling when estimated; clicking an estimated badge invokes `escalate`.

**Tests**

- [apps/desktop/src/renderer/src/session/cardinality-cache.test.ts](apps/desktop/src/renderer/src/session/cardinality-cache.test.ts) — 14 cases covering int8/number tuple-key normalisation, deduping, `missingForRelation` cache-hit / cache-miss behaviour, `mergeResults` scoping + immutability, and a full scroll-flow simulation (page 1 → page 2 dedupes cached entries).
- [apps/desktop/test/integration.test.ts](apps/desktop/test/integration.test.ts) — full-stack tRPC test against docker-compose Postgres:
  - First 100 customers × orders relation → every entry `count: 3, estimated: false`.
  - Sweep all 3000 customers in 200-row batches → sum equals 9000 (matches the seed's `9000 orders / 3000 customers via i % 3000`).
  - Missing PKs return `count: 0` (not omitted).
  - Unknown relation IDs are silently skipped rather than throwing.

`pnpm -w turbo run typecheck test` → all 5 packages green.

**Caveats / follow-ups**

- The hook fetches for ALL currently-loaded rows, not just the virtualizer's visible range. Simplest thing that works; the page size cap (typically 50-100) is well under the 200-row batch limit. If a future page size makes this expensive we can subscribe to the virtualizer's visible range and dispatch on `onRangeChanged`.
- The gutter itself isn't widened — we introduced a dedicated column slot between the gutter and the data columns. Reads better than cramming a badge into `[#|kebab]` for compound PKs.
- Live cache invalidation: same story as FK labels — a config change on a currently-mounted `TableView` doesn't repopulate until tab-switch (which remounts). See the 2026-06-25 follow-up.
- The engine trusts the renderer's `forceExact` flag today. If we ever expose it to plugins or external callers, cap the total row-count that a `forceExact: true` invocation can touch (a malicious call could hammer the DB with `countByGroup` against a 100M-row table).

---

## 2026-07-06 — Phase 2.7: Breadcrumb completion (persistence, overflow, back-step)

**Scope**

The Phase 2.2 breadcrumb foundation already carried a `crumbs: BreadcrumbStep[]` through every filteredTable open. This phase adds the missing polish:

- **Persistence** was already round-tripped by [apps/desktop/src/renderer/src/session/tabs-storage.ts](apps/desktop/src/renderer/src/session/tabs-storage.ts) (schema reuses `dslSchemas.FilterGroup` for both the tab filter and every step filter, 1-16 hops). Added a 4-hop round-trip test + a compound-PK 3-hop test to the test file to lock the invariant.
- **Overflow collapse** at 5+ hops: head crumb, "…" dropdown of hidden crumbs, last two crumbs.
- **Back-step** via a leading arrow button + Cmd/Ctrl+[ keyboard shortcut. Both re-open the second-to-last crumb.
- **Reactive labels** driven by `data.getRowLabels` — a DisplayConfig change on any crumb's target table updates the visible label on the next mount.
- **Self-referential honesty** — no dedup for manager→manager→manager chains. The overflow dropdown is what keeps them usable, not fake collapsing.

**Files**

- [apps/desktop/src/renderer/src/session/crumbs.ts](apps/desktop/src/renderer/src/session/crumbs.ts) — pure helpers:
  - `collapseCrumbs` returns `{ collapsed, head, hidden, tail }`. Threshold is `CRUMB_COLLAPSE_THRESHOLD = 5`; below that the trail renders inline (all hops in `tail`, `hidden` empty, `collapsed = false`). At/above, `hidden` covers indices `1..length-3` and `tail` covers the last two.
  - `crumbTargetPk` extracts the target-side PK tuple from a crumb whose filter is a flat AND-of-eq that fully covers the target's PK. Returns `null` on any deviation (nested groups, non-eq ops, array values, missing columns) so the caller falls back to the persisted label.

- [apps/desktop/src/renderer/src/session/useCrumbLabels.ts](apps/desktop/src/renderer/src/session/useCrumbLabels.ts) — hook: extract every crumb's `(schema, table, PK tuple)`, group by target, run one `data.getRowLabels` per distinct target with all deduped tuples, cache results by `${schema}.${table}` → tupleKey → label. Returns `Map<crumbIndex, string>` — only the crumbs whose labels came back with content are present; the caller falls back to the persisted `crumb.label` for the rest.

- [apps/desktop/src/renderer/src/session/TableView.tsx](apps/desktop/src/renderer/src/session/TableView.tsx):
  - Split the old BreadcrumbBar into a presentational `BreadcrumbBar` (exports; takes `resolvedLabels: Map<number, string>` as a prop) and a tRPC-connected `BreadcrumbBarWithLabels` wrapper. This lets the DOM test mount the bar without a query client or IPC bridge.
  - New back-arrow button on the leading edge. Disabled on single-hop trails; opens `crumbs.length - 2` otherwise.
  - Cmd/Ctrl+[ shortcut in a document-scoped `useEffect`, gated so focused inputs/textareas/contenteditable elements keep their own handling. Only mounted while this TableView is visible (SessionView unmounts inactive tabs via its keyed conditional render).
  - `CrumbOverflowMenu` — new local component; kebab-style dropdown listing every hidden crumb (schema, table, resolved label) — click to open.
  - Head + last two now share a common renderer; every crumb goes through `resolvedLabels.get(index) ?? step.label`.

**Tests**

- [apps/desktop/src/renderer/src/session/crumbs.test.ts](apps/desktop/src/renderer/src/session/crumbs.test.ts) — 13 cases: empty / 1-hop / 4-hop-inline / 5-hop-collapses / 6-hop-collapses; self-referential 5-hop chain doesn't dedup; `crumbTargetPk` for single + compound + reordered + missing-column + OR-group + non-eq + non-primitive + no-PK.
- [apps/desktop/src/renderer/src/session/tabs-storage.test.ts](apps/desktop/src/renderer/src/session/tabs-storage.test.ts) — added a 4-hop round-trip case + a compound-PK 3-hop case.
- [apps/desktop/src/renderer/src/session/BreadcrumbBar.test.tsx](apps/desktop/src/renderer/src/session/BreadcrumbBar.test.tsx) — 5 DOM cases via jsdom + `@testing-library/react`: 4 hops inline, 5 hops collapse (head + `2 hidden` overflow + last two), overflow-open reveals hidden crumbs, `resolvedLabels` override wins over persisted, back arrow opens `crumbs[length-2]`, back arrow disabled on 1-hop.

`pnpm -w turbo run typecheck test` → all 10 tasks green (5 packages × typecheck + test).

**Caveats / follow-ups**

- `useCrumbLabels`' cache is session-scoped and doesn't invalidate on DisplayConfig save. Same trade-off as `useFkLabels` and `useRowCardinalities`: switching tabs remounts the TableView and refreshes the cache. If we ever want live propagation, all three hooks migrate to TanStack Query at once.
- The Cmd/Ctrl+[ handler is scoped to `document.keydown`. It doesn't fire while a shadcn `Dialog` is open (Radix traps focus) — good — but it also doesn't fire while a native modal is open. If we later add native prompts we may need to tighten the guard.
- The dropdown menu is a plain absolute-positioned div; it doesn't reposition on scroll. Long trails on narrow windows may hit the right edge. Not urgent — the whole nav is `overflow-x-auto` so the user can always scroll.

---

## 2026-07-06 — Fix: window not draggable on macOS

**Scope**

User reported the Electron window couldn't be moved on the desktop. Root cause: [apps/desktop/src/main/index.ts:30](apps/desktop/src/main/index.ts#L30) sets `titleBarStyle: "hiddenInset"` on macOS, which removes the native title bar (keeping only inset traffic lights) and requires the renderer to explicitly mark draggable regions via `-webkit-app-region: drag` CSS — Chromium does not do this automatically. A repo-wide search confirmed no `-webkit-app-region` declaration existed anywhere in the renderer, so none of the window was draggable.

**Files**

- [apps/desktop/src/renderer/src/session/SessionView.tsx](apps/desktop/src/renderer/src/session/SessionView.tsx) — the top `<header>` (back button, connection name, Relations/New SQL actions) is now a drag region (`[-webkit-app-region:drag]`); the three `<Button>`s inside are marked `[-webkit-app-region:no-drag]` so clicks still register.
- [apps/desktop/src/renderer/src/App.tsx](apps/desktop/src/renderer/src/App.tsx) — the pre-session connections screen had no top bar at all, so a thin (`h-6`) full-width drag strip was added at the top, rendered only when `active === null` (so it doesn't overlay `SessionView`'s own header once a connection is open). The floating theme-toggle button (always rendered, `position: absolute`, sits on top of whichever screen is showing) is marked `no-drag`.
- Used Tailwind's arbitrary-property syntax (`[-webkit-app-region:drag]` / `[...:no-drag]`) rather than inline `style` objects, since `-webkit-app-region` isn't part of the `csstype`/`React.CSSProperties` typings this repo's `tsc` checks against, and the project's "no `any`, no unsafe casts" rule rules out forcing it through `style`.

**Verification**

- `pnpm run typecheck` and `pnpm exec eslint` (scoped to the two changed files) both pass.
- Could not verify the actual drag interaction: dragging a native OS window is a physical mouse-interaction outcome, not something visible in a screenshot, and this sandbox can't drive real OS-level mouse drag events. Attempted to launch the dev app for a sanity screenshot; the background Electron process died along with the wrapping shell before it reached a window (no window nor stray process was left running). Recommend the user run `pnpm dev` (or their normal flow) themselves and confirm the window drags from the top header / connections-screen strip.

**Caveats / follow-ups**

- The `h-6` (24px) drag strip on the connections screen was sized to sit above `ConnectionList`'s `p-6` header row without overlapping it — not derived from the actual macOS traffic-light geometry, so it's a reasonable-looking guess rather than a pixel-measured fit.
- Windows/Linux use `titleBarStyle: "default"` (native frame), so this was a macOS-only bug; the CSS fix is harmless but a no-op there since the frame already provides dragging.
