import type {
  EngineService,
  FilteredTableRef,
  GetTablePageArgs,
  ReadOnlySqlOpts,
} from "@perspectives/engine";

import {
  cancelReadOnlySqlInputSchema,
  filteredTableRefSchema,
  getCountsForRowsInputSchema,
  getReferencingCountsInputSchema,
  getRowByKeyInputSchema,
  getRowLabelsInputSchema,
  getTablePageInputSchema,
  runReadOnlySqlInputSchema,
} from "../inputs";
import type { TrpcBuilder } from "../router";

// Same Zod-vs-`exactOptionalPropertyTypes` story as `connections.ts`.
const asTablePageArgs = (input: unknown): GetTablePageArgs =>
  input as GetTablePageArgs;
const asFilteredTableRef = (input: unknown): FilteredTableRef =>
  input as FilteredTableRef;

/**
 * In-flight SQL-console cancel tokens. The renderer passes a token at
 * `runReadOnlySql` time; if the user clicks "Cancel", the renderer sends
 * the same token to `cancelReadOnlySql` and the AbortController fires,
 * which in turn invokes `pg_cancel_backend` against the held PID inside
 * the adapter. Tokens are removed on completion / cancel; we keep this
 * module-scoped because the router itself has no per-call state.
 *
 * The map is bounded by user behaviour (a user has at most a handful of
 * open SQL tabs); even if a renderer leaks a token by never settling, the
 * underlying query is bounded by `statement_timeout` and the AbortController
 * GCs once dropped. We add a hard ceiling out of paranoia.
 */
const MAX_PENDING_CANCEL_TOKENS = 256;
const pendingCancels = new Map<string, AbortController>();

export function makeDataRouter(t: TrpcBuilder, engine: EngineService) {
  return t.router({
    /** Keyset-paginated rows from a table. The cursor is the engine's
     *  `Cursor` shape — opaque to the renderer; only this router and its
     *  upstream adapter ever read its `values` field. */
    getTablePage: t.procedure
      .input(getTablePageInputSchema)
      .query(({ input }) => engine.getTablePage(asTablePageArgs(input))),

    /** Exact `COUNT(*)` for a table. Slow on large tables — the UI calls
     *  `estimateTable` first and only triggers this on explicit user action.
     *  Accepts an optional filter so filtered-table tabs (Phase 2) get a
     *  count of just the visible subset. */
    countTable: t.procedure
      .input(filteredTableRefSchema)
      .query(({ input }) => engine.countTable(asFilteredTableRef(input))),

    /** Cheap row-count estimate, in the order of magnitude. Surface with a
     *  "~" prefix in the UI. */
    estimateTable: t.procedure
      .input(filteredTableRefSchema)
      .query(({ input }) => engine.estimateTable(asFilteredTableRef(input))),

    /** Single-row lookup by primary key. Used by Phase 2 forward FK
     *  navigation to confirm the target row exists before opening a tab.
     *  Returns `null` when no row matches. */
    getRowByKey: t.procedure
      .input(getRowByKeyInputSchema)
      .query(({ input }) =>
        engine.getRowByKey(
          input.connectionId,
          input.schema,
          input.table,
          input.pkValues,
        ),
      ),

    /** For a focused row, return cardinality counts for every inbound 1:n
     *  + m:n relation. The inspector's "Referenced by" section uses this.
     *  `rowValues` is a column-name → primitive map; relations referencing
     *  columns absent from this map are skipped (no count returned). */
    getReferencingCounts: t.procedure
      .input(getReferencingCountsInputSchema)
      .query(({ input }) =>
        engine.getReferencingCounts(
          input.connectionId,
          input.schema,
          input.table,
          input.rowValues,
        ),
      ),

    /** Batch row-label lookup. Single round trip per (target table)
     *  through an OR-of-AND-of-eq filter on the PK; labels are returned
     *  in `pkTuples` input order. Phase 2.5 — used by the grid to render
     *  FK cell labels and by the breadcrumb / inspector. */
    getRowLabels: t.procedure
      .input(getRowLabelsInputSchema)
      .query(({ input }) =>
        engine.getRowLabels(
          input.connectionId,
          input.schema,
          input.table,
          input.pkTuples,
        ),
      ),

    /** Batch cardinality preview. For each (visible source row, picked
     *  relation) pair, return the count of children. One grouped round
     *  trip per relation on small targets; per-row EXPLAIN on huge ones.
     *  Phase 2.6 — drives the gutter "47 orders · 3 tags" badges. */
    getCountsForRows: t.procedure
      .input(getCountsForRowsInputSchema)
      .query(({ input }) =>
        engine.getCountsForRows(
          input.connectionId,
          input.schema,
          input.table,
          input.pkTuples,
          input.relationIds,
          input.forceExact === true ? { forceExact: true } : undefined,
        ),
      ),

    /** Execute user SQL through a `BEGIN TRANSACTION READ ONLY` envelope.
     *  Powering the SQL console; never used by other UI surfaces. */
    runReadOnlySql: t.procedure
      .input(runReadOnlySqlInputSchema)
      .mutation(async ({ input }) => {
        const opts: ReadOnlySqlOpts = {};
        const limits = input.limits;
        if (limits !== undefined) {
          if (limits.statementTimeoutMs !== undefined) {
            opts.statementTimeoutMs = limits.statementTimeoutMs;
          }
          if (limits.idleInTransactionTimeoutMs !== undefined) {
            opts.idleInTransactionTimeoutMs = limits.idleInTransactionTimeoutMs;
          }
          if (limits.maxRows !== undefined) opts.maxRows = limits.maxRows;
          if (limits.maxBytes !== undefined) opts.maxBytes = limits.maxBytes;
        }
        let controller: AbortController | undefined;
        if (input.cancelToken !== undefined) {
          if (pendingCancels.size >= MAX_PENDING_CANCEL_TOKENS) {
            // Reap the oldest entry — only happens under abuse / a leak.
            const oldest = pendingCancels.keys().next().value;
            if (oldest !== undefined) pendingCancels.delete(oldest);
          }
          controller = new AbortController();
          pendingCancels.set(input.cancelToken, controller);
          opts.signal = controller.signal;
        }
        try {
          return await engine.runReadOnlyQuery(input.connectionId, input.sql, opts);
        } finally {
          if (input.cancelToken !== undefined) {
            pendingCancels.delete(input.cancelToken);
          }
        }
      }),

    /** Cancel an in-flight `runReadOnlySql` call by its token. Idempotent —
     *  a token that's already cleared (query finished or never registered)
     *  is a no-op. See AUDIT-CODEX.md finding #4. */
    cancelReadOnlySql: t.procedure
      .input(cancelReadOnlySqlInputSchema)
      .mutation(({ input }) => {
        const controller = pendingCancels.get(input.cancelToken);
        if (controller !== undefined) controller.abort();
        return { cancelled: controller !== undefined };
      }),
  });
}
