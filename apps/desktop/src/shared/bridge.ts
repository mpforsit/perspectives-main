/**
 * Shared types for the Electron IPC bridge between renderer and main.
 *
 * The renderer can only talk to the main process through a single function
 * (`perspectivesAPI.trpc`) exposed via `contextBridge` from the preload script.
 * Both sides of that boundary need to agree on the wire shape, which lives
 * here. The shape mirrors a single tRPC operation: a typed envelope in, an
 * `ok | error` discriminated union out.
 *
 * Inputs and outputs are wrapped as `SuperJSONResult` so that Date / Map /
 * undefined / BigInt round-trip cleanly. Electron's IPC uses structured
 * clone, which would handle most of those natively, but going through
 * superjson keeps the wire format identical to what a future HTTP transport
 * would use.
 */

import type { SuperJSONResult } from "superjson";

/** The single IPC channel the bridge uses. Identical string on both sides. */
export const TRPC_IPC_CHANNEL = "perspectives:trpc";

export type TrpcOperationType = "query" | "mutation";

export interface TrpcIpcRequest {
  type: TrpcOperationType;
  /** Dotted procedure path, e.g. "health.ping". */
  path: string;
  /** superjson-serialized input, or `undefined` when the procedure takes none. */
  input: SuperJSONResult | undefined;
}

export type TrpcIpcResponse =
  | { kind: "ok"; data: SuperJSONResult }
  | {
      kind: "error";
      /** tRPC error code, e.g. "NOT_FOUND", "INTERNAL_SERVER_ERROR". */
      code: string;
      message: string;
    };

/**
 * The surface the preload script exposes to the renderer via
 * `contextBridge.exposeInMainWorld("perspectivesAPI", …)`. Nothing else is
 * exposed — no raw `ipcRenderer`, no Node APIs.
 */
export interface PerspectivesBridge {
  trpc(request: TrpcIpcRequest): Promise<TrpcIpcResponse>;
}
