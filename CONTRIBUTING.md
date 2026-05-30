# Contributing to Perspectives

Perspectives is built one focused change at a time. The guidelines below keep the codebase consistent so anyone — human or AI — can pick up where the previous commit left off.

## Workflow

**One change per commit.** A commit should do exactly one thing and be describable in a single sentence. If you find yourself writing "and" twice in the commit message, split it. Good commit boundaries look like:

- "Set up the monorepo skeleton."
- "Implement the DSL package."
- "Wire tRPC between main and renderer."

This mirrors how AI-assisted contributions enter the repo — one prompt produces one focused diff, the diff is reviewed, then committed. Human-authored commits follow the same shape so the history reads consistently regardless of who wrote what.

**Open a draft PR early.** CI runs typecheck / lint / test / build on every PR (see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)). Iterate in draft until all four checks are green; mark "ready for review" only once they are.

**Document the why, not the what.** When a commit decides something non-obvious — a library choice, a workaround for a specific bug, a tradeoff — capture the reasoning in [`AGENT_LOG.md`](./AGENT_LOG.md). The diff already shows the what; the log is the project's running ledger of why we did it this way.

**No `--no-verify`, no force-pushes to `main`.** If a pre-commit hook fails, fix the underlying issue. If CI fails on `main`, open a follow-up PR rather than rewriting history.

## Hard rules

These come from the project's system primer ([`CLAUDE.md`](./CLAUDE.md)) and are enforced by typecheck, lint, CI, and review.

- **TypeScript strict everywhere.** No `any`. No `as unknown as T` casts except at clearly-marked deserialization boundaries.
- **Zod schemas in [`packages/dsl`](./packages/dsl) are the source of truth** for every persisted shape. TypeScript types are derived via `z.infer`; never maintain parallel definitions.
- **No raw SQL strings outside [`packages/adapter-postgres`](./packages/adapter-postgres).** UI and engine speak in structured `QueryPlan` objects.
- **Connection credentials are local-only.** They never appear in any payload sent over the network in any mode. A test fails if they do.
- **Every public function gets a test. Every package has a `README.md`** explaining what it is in two sentences.
- **Stick to the tech stack.** pnpm workspaces + Turborepo, TypeScript, React + Vite, shadcn/ui + Tailwind, TanStack Table, tRPC, Electron, Node 20+, Kysely, Better Auth (when needed), Zod, Vitest. Don't introduce other deps without flagging it in the PR description.

## Behavioural guidelines

(Also from [`CLAUDE.md`](./CLAUDE.md). They apply to humans too.)

- **Think before coding.** Surface tradeoffs and assumptions in the PR description. If something is unclear, ask before pushing.
- **Simplicity first.** Minimum code that solves the problem. No abstractions for single-use code. No error handling for impossible scenarios. If 200 lines could be 50, rewrite it.
- **Surgical changes.** Touch only what you must. Don't refactor adjacent code or "improve" comments in the same PR. Don't rename anything unless the rename is the point of the PR.
- **Goal-driven execution.** Define success criteria before writing code — a passing test, a clean type check, or a screenshot of the expected UI. "Make it work" is not a goal.

## Local checks

Before pushing:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build   # optional; recommended when touching apps/desktop
```

`pnpm dev` launches the desktop app — use it to eyeball UI changes before requesting review. `pnpm --filter desktop package` builds an installable artifact when you actually need one (CI doesn't run this).

## Reporting bugs and proposing features

Open an issue with:

- What you tried.
- What you expected.
- What happened.

For features, describe the user value first, then propose an implementation second. The first half is what determines whether we ship it.
