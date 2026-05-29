import type { PerspectivesBridge } from "../../shared/bridge";

declare global {
  interface Window {
    /**
     * Bridge exposed by the preload script via `contextBridge`. Always present
     * in the renderer; never present in main / test contexts.
     */
    readonly perspectivesAPI: PerspectivesBridge;
  }
}

export {};
