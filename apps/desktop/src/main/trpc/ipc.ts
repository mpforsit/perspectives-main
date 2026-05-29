/**
 * IPC adapter that bridges Electron's `ipcMain.handle` to the tRPC router.
 *
 * The wire shape (`TrpcIpcRequest` / `TrpcIpcResponse`) is defined in
 * `src/shared/bridge.ts` and shared with the preload + renderer. This module
 * is the only piece on the main side that needs to know about it.
 */

import { ipcMain } from "electron";
import { callTRPCProcedure, getTRPCErrorFromUnknown } from "@trpc/server";
import superjson, { type SuperJSONResult } from "superjson";

import {
  TRPC_IPC_CHANNEL,
  type TrpcIpcRequest,
  type TrpcIpcResponse,
} from "../../shared/bridge";

import { appRouter, createContext } from "./router";

function isTrpcIpcRequest(value: unknown): value is TrpcIpcRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate["path"] !== "string") return false;
  const type = candidate["type"];
  if (type !== "query" && type !== "mutation") return false;
  return true;
}

export function registerTrpcIpc(): void {
  ipcMain.handle(
    TRPC_IPC_CHANNEL,
    async (_event, raw: unknown): Promise<TrpcIpcResponse> => {
      if (!isTrpcIpcRequest(raw)) {
        return {
          kind: "error",
          code: "BAD_REQUEST",
          message: "Malformed tRPC IPC request",
        };
      }

      try {
        const result = await callTRPCProcedure({
          router: appRouter,
          path: raw.path,
          getRawInput: async () =>
            raw.input === undefined ? undefined : superjson.deserialize(raw.input),
          type: raw.type,
          ctx: createContext(),
          signal: undefined,
          // tRPC v11 requires a batch index even for single calls. We aren't
          // batching over IPC; each invoke handles exactly one operation.
          batchIndex: 0,
        });
        return {
          kind: "ok",
          data: superjson.serialize(result) as SuperJSONResult,
        };
      } catch (cause) {
        const error = getTRPCErrorFromUnknown(cause);
        return {
          kind: "error",
          code: error.code,
          message: error.message,
        };
      }
    },
  );
}
