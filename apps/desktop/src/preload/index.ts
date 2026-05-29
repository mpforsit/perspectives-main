/**
 * Preload script — runs in the sandboxed renderer process.
 *
 * Exposes exactly one bridge function (`perspectivesAPI.trpc`) to the renderer
 * via `contextBridge`. The renderer cannot reach `ipcRenderer` directly:
 * `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` keep
 * everything else locked down. All future surface (workspace events,
 * notifications, file dialogs, …) lands here, also through `contextBridge`.
 */

import { contextBridge, ipcRenderer } from "electron";

import {
  TRPC_IPC_CHANNEL,
  type PerspectivesBridge,
  type TrpcIpcRequest,
  type TrpcIpcResponse,
} from "../shared/bridge";

const bridge: PerspectivesBridge = {
  trpc: (request: TrpcIpcRequest): Promise<TrpcIpcResponse> =>
    ipcRenderer.invoke(TRPC_IPC_CHANNEL, request) as Promise<TrpcIpcResponse>,
};

contextBridge.exposeInMainWorld("perspectivesAPI", bridge);
