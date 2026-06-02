import type {
  EngineService,
  GetTablePageArgs,
} from "@perspectives/engine";

import {
  getTablePageInputSchema,
  runReadOnlySqlInputSchema,
  tableRefSchema,
} from "../inputs";
import type { TrpcBuilder } from "../router";

// Same Zod-vs-`exactOptionalPropertyTypes` story as `connections.ts`.
const asTablePageArgs = (input: unknown): GetTablePageArgs =>
  input as GetTablePageArgs;

export function makeDataRouter(t: TrpcBuilder, engine: EngineService) {
  return t.router({
    /** Keyset-paginated rows from a table. The cursor is the engine's
     *  `Cursor` shape — opaque to the renderer; only this router and its
     *  upstream adapter ever read its `values` field. */
    getTablePage: t.procedure
      .input(getTablePageInputSchema)
      .query(({ input }) => engine.getTablePage(asTablePageArgs(input))),

    /** Exact `COUNT(*)` for a table. Slow on large tables — the UI calls
     *  `estimateTable` first and only triggers this on explicit user action. */
    countTable: t.procedure
      .input(tableRefSchema)
      .query(({ input }) => engine.countTable(input)),

    /** Cheap row-count estimate, in the order of magnitude. Surface with a
     *  "~" prefix in the UI. */
    estimateTable: t.procedure
      .input(tableRefSchema)
      .query(({ input }) => engine.estimateTable(input)),

    /** Execute user SQL through a `BEGIN TRANSACTION READ ONLY` envelope.
     *  Powering the SQL console; never used by other UI surfaces. */
    runReadOnlySql: t.procedure
      .input(runReadOnlySqlInputSchema)
      .mutation(({ input }) => engine.runReadOnlyQuery(input.connectionId, input.sql)),
  });
}
