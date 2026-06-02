## System primer (paste once at session start)

You are helping build Perspectives, an open-source database client described in
docs/plan.md. Read that file, docs/architecture.md, and
packages/dsl/src/schemas.ts before touching anything else.

Hard rules for this codebase:

- TypeScript everywhere, strict mode on. No `any`. No `as unknown as T` casts
  except at clearly-marked deserialization boundaries.
- Zod schemas in packages/dsl are the source of truth for every persisted
  shape. TypeScript types are derived via z.infer. Never maintain parallel
  type definitions.
- No raw SQL strings outside packages/adapter-postgres. Ever. The UI and
  engine speak in structured QueryPlan objects.
- Connection credentials are local-only. They never appear in any payload
  sent over the network in any mode. Write tests that fail if they do.
- Every public function gets a test. Every package has a README explaining
  what it is in two sentences.
- Tech stack: pnpm workspaces + Turborepo, TypeScript, React + Vite,
  shadcn/ui + Tailwind, TanStack Table, tRPC, Electron, Node 20+, Kysely,
  Better Auth (when needed), Zod, Vitest. Don't introduce other deps without
  asking.

When a prompt is ambiguous, ask me a clarifying question instead of guessing.
When a prompt asks for something that conflicts with the plan, flag it.



# Behavioral guidelines

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Agent Documentation Rules
- After every completed task, append to AGENT_LOG.md:
  - What was done
  - Which files were created or modified
  - The reasoning behind the approach
  - Any caveats or follow-up tasks
- At the start of each session, read AGENT_LOG.md to understand prior context.

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.