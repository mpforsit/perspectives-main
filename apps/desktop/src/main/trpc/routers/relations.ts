import type {
  CustomRelationInput,
  EngineService,
} from "@perspectives/engine";

import {
  connectionIdSchema,
  createCustomRelationInputSchema,
  deleteCustomRelationInputSchema,
  setJunctionPolicyInputSchema,
  updateCustomRelationInputSchema,
} from "../inputs";
import type { TrpcBuilder } from "../router";

// Same Zod-vs-`exactOptionalPropertyTypes` cast as the other routers.
const asCustomRelationInput = (input: unknown): CustomRelationInput =>
  input as CustomRelationInput;

/**
 * Phase 2 — relations router.
 *
 * - `list` returns every RelationDef for a connection: schema-derived ones
 *   from the active schema snapshot, junction-derived m:n relations, and
 *   custom ones the user has saved (scoped by the connection's database
 *   identity, not its profile id). Phase 2.4 will add
 *   `createCustom` / `updateCustom` / `delete` here.
 * - `detectJunctions` exposes the junction-detection result (heuristic +
 *   per-table policy override) for the inspector's collapse logic and the
 *   policy editor surface (Phase 2.5).
 * - `setJunctionPolicy` persists a per-table `auto | always | never`
 *   override.
 */
export function makeRelationsRouter(t: TrpcBuilder, engine: EngineService) {
  return t.router({
    list: t.procedure
      .input(connectionIdSchema)
      .query(({ input }) => engine.listRelations(input.connectionId)),

    detectJunctions: t.procedure
      .input(connectionIdSchema)
      .query(({ input }) => engine.detectJunctions(input.connectionId)),

    setJunctionPolicy: t.procedure
      .input(setJunctionPolicyInputSchema)
      .mutation(({ input }) =>
        engine.setJunctionPolicy(
          input.connectionId,
          input.schema,
          input.table,
          input.policy,
        ),
      ),

    /** Phase 2.4 — create a user-defined RelationDef. Engine generates
     *  the id; the renderer never picks it. */
    createCustom: t.procedure
      .input(createCustomRelationInputSchema)
      .mutation(({ input }) =>
        engine.createCustomRelation(
          input.connectionId,
          asCustomRelationInput(input.relation),
        ),
      ),

    /** Update an existing custom relation by id. Re-validates the new
     *  shape; refuses to update a schema-derived relation. */
    updateCustom: t.procedure
      .input(updateCustomRelationInputSchema)
      .mutation(({ input }) =>
        engine.updateCustomRelation(
          input.connectionId,
          input.id,
          asCustomRelationInput(input.relation),
        ),
      ),

    /** Idempotent delete by id. Refuses to delete a schema-derived
     *  relation (those are computed, not persisted). */
    deleteCustom: t.procedure
      .input(deleteCustomRelationInputSchema)
      .mutation(({ input }) =>
        engine.deleteCustomRelation(input.connectionId, input.id),
      ),
  });
}
