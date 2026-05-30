# Perspectives

Perspectives is an open-source database client that turns rigid table-browsing into reusable, shareable, AI-steerable *perspectives* — saved presentations of data with their own columns, filters, sorts, joins, and (in shared mode) permissions. Open source where TablePlus is closed, ergonomic where phpMyAdmin is clunky, collaborative where both are solo. The Electron desktop app, the self-hostable server, and the managed SaaS all run the same engine; PostgreSQL is the v1 target database, with an adapter pattern in place so other engines plug in later.

## Status

**Phase 0 — foundations.** The monorepo skeleton, the DSL package, the engine's interfaces (no implementations yet), the Electron shell with tRPC wired between main and renderer, and CI are in place. We are not yet able to connect to a real database. See [`docs/plan.md`](./docs/plan.md) for the full phased build plan and the running progress in [`AGENT_LOG.md`](./AGENT_LOG.md).

## Getting started

Requirements: Node 20+ and pnpm 10.

```sh
pnpm install                 # install workspace dependencies
pnpm dev                     # launch the Electron desktop app with HMR

pnpm typecheck               # tsc --noEmit across packages that opt in
pnpm lint                    # ESLint
pnpm test                    # Vitest across the workspace
pnpm build                   # compile every package (no installer)

pnpm --filter desktop package    # produce a packaged desktop installer
```

The Electron app will show a small "Engine: online v0.0.1" status block driven through the renderer's tRPC client. That confirms IPC and the React shell are wired correctly — every feature lands on top of that.

## Where to start reading

- [`docs/architecture.md`](./docs/architecture.md) — what Perspectives is, the three-layer architecture, the core abstractions, the repo layout.
- [`docs/plan.md`](./docs/plan.md) — the phased build plan.
- [`docs/dsl.md`](./docs/dsl.md) — the DSL field-by-field with a sample perspective.
- [`docs/glossary.md`](./docs/glossary.md) — short definitions of the project's vocabulary.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — workflow norms and the hard rules every PR is held to.

## License

To be finalised before the first public release. The intent is a permissive open-source license — most likely Apache 2.0 or MIT.
