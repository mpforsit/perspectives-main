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
import { createTRPCReact, type CreateTRPCReact } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import superjson, { type SuperJSONResult } from "superjson";

import type { AppRouter } from "../../../main/trpc/router";
import type { TrpcIpcRequest, TrpcIpcResponse } from "../../../shared/bridge";

// TypeScript 5.9 enforces portable type inference more aggressively;
// without this annotation the inferred type references an internal tRPC
// declaration whose source path is bundle-mangled (".d-CruH3ncI.d.mts").
// `CreateTRPCReact` is the public alias for the same shape.
export const trpc: CreateTRPCReact<AppRouter, unknown> =
  createTRPCReact<AppRouter>();

function isSuperJSONResult(value: unknown): value is SuperJSONResult {
  return typeof value === "object" && value !== null && "json" in value;
}

export const electronLink: TRPCLink<AppRouter> = () => {
  return ({ op }) =>
    observable((observer) => {
      let cancelled = false;

      const bridge = window.perspectivesAPI;
      if (bridge === undefined) {
        // We're loaded in a context without the Electron preload (e.g. a
        // browser tab pointed at the renderer dev-server URL). There's no
        // engine on the other end — surface a clear, actionable message
        // instead of "Cannot read properties of undefined (reading 'trpc')".
        observer.error(
          TRPCClientError.from(
            new Error(
              "Engine bridge not available — Perspectives runs in the Electron shell, not a browser tab. Launch the app with `pnpm dev` and use the window it opens.",
            ),
          ),
        );
        return () => {};
      }

      const request: TrpcIpcRequest = {
        type: op.type === "subscription" ? "query" : op.type,
        path: op.path,
        input:
          op.input === undefined
            ? undefined
            : (superjson.serialize(op.input) as SuperJSONResult),
      };

      bridge
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
