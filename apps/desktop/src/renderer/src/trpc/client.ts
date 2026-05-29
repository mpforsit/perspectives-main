/**
 * Renderer-side tRPC client.
 *
 * - `trpc` is the React-Query-bound hook surface generated from the AppRouter
 *   type. The renderer ONLY type-imports the router so the server-side
 *   runtime (`@trpc/server`, our procedures, package.json) doesn't leak into
 *   the browser bundle.
 * - `electronLink` is a custom terminal `TRPCLink` that forwards each
 *   operation through `window.perspectivesAPI.trpc` (a single IPC invocation)
 *   and superjson-encodes inputs / decodes outputs symmetrically with
 *   `main/trpc/ipc.ts`.
 */

import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import superjson, { type SuperJSONResult } from "superjson";

import type { AppRouter } from "../../../main/trpc/router";
import type { TrpcIpcRequest, TrpcIpcResponse } from "../../../shared/bridge";

export const trpc = createTRPCReact<AppRouter>();

function isSuperJSONResult(value: unknown): value is SuperJSONResult {
  return typeof value === "object" && value !== null && "json" in value;
}

export const electronLink: TRPCLink<AppRouter> = () => {
  return ({ op }) =>
    observable((observer) => {
      let cancelled = false;

      const request: TrpcIpcRequest = {
        type: op.type === "subscription" ? "query" : op.type,
        path: op.path,
        input:
          op.input === undefined
            ? undefined
            : (superjson.serialize(op.input) as SuperJSONResult),
      };

      window.perspectivesAPI
        .trpc(request)
        .then((response: TrpcIpcResponse) => {
          if (cancelled) return;
          if (response.kind === "error") {
            const err = new Error(response.message);
            observer.error(
              TRPCClientError.from(err, { meta: { code: response.code } }),
            );
            return;
          }
          const data = isSuperJSONResult(response.data)
            ? superjson.deserialize(response.data)
            : undefined;
          observer.next({ result: { type: "data", data } });
          observer.complete();
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          const err = cause instanceof Error ? cause : new Error(String(cause));
          observer.error(TRPCClientError.from(err));
        });

      return () => {
        // IPC invokes can't be cancelled after dispatch, but we suppress any
        // post-cancellation observer callbacks so they don't surface to React.
        cancelled = true;
      };
    });
};
