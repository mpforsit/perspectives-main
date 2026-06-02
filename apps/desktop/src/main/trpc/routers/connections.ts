import type { ConnectionProfile, EngineService } from "@perspectives/engine";

import { connectionIdSchema, connectionProfileSchema } from "../inputs";
import type { TrpcBuilder } from "../router";

// Zod's `.optional()` parses to `T | undefined`, while the engine's
// `ConnectionProfile` declares optional fields as `?: T` (strict — no explicit
// undefined under `exactOptionalPropertyTypes`). The shapes are otherwise
// structurally identical, so a single `as` cast at the deserialization
// boundary is the cleanest bridge — exactly the case CLAUDE.md permits.
const asProfile = (input: unknown): ConnectionProfile => input as ConnectionProfile;

export function makeConnectionsRouter(t: TrpcBuilder, engine: EngineService) {
  return t.router({
    /** List every persisted connection profile. */
    list: t.procedure.query(() => engine.listConnections()),

    /** Probe a profile without persisting it — used by the "Test connection"
     *  button in the connection editor. */
    test: t.procedure
      .input(connectionProfileSchema)
      .mutation(({ input }) => engine.testConnection(asProfile(input))),

    /** Save a new profile. The password is routed to the credential store;
     *  everything else lands in the metadata store. */
    create: t.procedure
      .input(connectionProfileSchema)
      .mutation(({ input }) => engine.createConnection(asProfile(input))),

    /** Replace an existing profile. Implicitly disconnects so a stale
     *  adapter doesn't keep serving queries against the old host/credentials. */
    update: t.procedure
      .input(connectionProfileSchema)
      .mutation(({ input }) => engine.updateConnection(input.id, asProfile(input))),

    delete: t.procedure
      .input(connectionIdSchema)
      .mutation(({ input }) => engine.deleteConnection(input.connectionId)),

    /** Activate a persisted profile — constructs an adapter, probes it,
     *  caches it for later `schema` / `data` calls. */
    connect: t.procedure
      .input(connectionIdSchema)
      .mutation(({ input }) => engine.connect(input.connectionId)),

    /** Tear down the active adapter for this id. Idempotent. */
    disconnect: t.procedure
      .input(connectionIdSchema)
      .mutation(({ input }) => engine.disconnect(input.connectionId)),
  });
}
