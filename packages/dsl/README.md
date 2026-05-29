# @perspectives/dsl

The canonical, machine-checkable definition of every saved object in Perspectives — `PerspectiveDef`, `RelationDef`, `DisplayConfig` — expressed as Zod schemas with TypeScript types derived via `z.infer`. Validation helpers (`validatePerspective`, `validateRelation`, `validateDisplayConfig`) wrap `safeParse` and return a discriminated `ValidationResult<T>` that the engine, the UI, and the AI generation pipeline all share.

## What lives here

- **`src/schemas.ts`** — the Zod schemas plus a handful of strict variants (e.g. `ColumnSource` is `.strict()` so unknown keys are rejected loudly rather than silently dropped).
- **`src/index.ts`** — re-exports everything public.
- **`examples/`** — example perspective JSON documents. Every file is round-tripped through `validatePerspective()` by the test suite.

This package is **types and validators only**. No query planning, no SQL generation, no permission evaluation — those live in `@perspectives/engine` and the adapter packages. Anything that needs to interpret a `PerspectiveDef` consumes these types; this package never reaches back to them.

## The cardinal rule: schemas are the source of truth

Every persisted shape in Perspectives is defined exactly once, here, as a Zod schema. The TypeScript type is derived from the schema via `z.infer<typeof Schema>` — never written by hand alongside the schema. If you're tempted to maintain a parallel `interface` definition, don't: it will drift, and the runtime check and the compiler check will start disagreeing.

The engine MUST round-trip every persisted object through these schemas before saving and after loading. Fields not in the schema do not exist — they are stripped, not passed through.

## Versioning: how to add a new schema version

Every top-level saved object carries a numeric `version` field so the schema can evolve without breaking old payloads. The rules:

- **Backward-compatible additions** (new optional fields; new union variants that don't collide with existing ones) may be made to the current version *in place*. Old payloads still parse; new payloads carry the new field.
- **Breaking changes** — renames, type changes, removed fields, semantically incompatible re-shapings — require a new version. Never silently rewrite v1.

To add a new version of `PerspectiveDef`:

1. Keep the existing `PerspectiveDefV1` schema exactly as it is. Do not edit it.
2. Add a `PerspectiveDefV2` schema next to it, with `version: z.literal(2)`. Define all the new shapes in their own consts so they're easy to diff against v1.
3. Replace the exported `PerspectiveDef` with a discriminated union on `version`:

   ```ts
   export const PerspectiveDef = z.discriminatedUnion("version", [
     PerspectiveDefV1,
     PerspectiveDefV2,
   ]);
   export type PerspectiveDef = z.infer<typeof PerspectiveDef>;
   ```

4. Write a `migrateV1ToV2(input: PerspectiveDefV1): PerspectiveDefV2` function in a new file (`src/migrate.ts`) — pure, total, tested. The metadata stores call it lazily when loading.
5. Add fixtures for both versions under `examples/` so the example test exercises both. The validator accepts either shape going forward.

The same procedure applies to `RelationDef` and `DisplayConfig` when they need to evolve.

## Tests

```sh
pnpm --filter dsl test
```

The suite covers every top-level schema, the recursive filter group, the strict column-source variants, the join shape (including the multi-hop chain and the self-referential case), the `RelationDef` cardinality refinements, and a small loader that validates every JSON document in `examples/`.
