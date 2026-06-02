import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";

import { PostgresAdapter } from "@perspectives/adapter-postgres";
import { EngineService } from "@perspectives/engine";
import { SqliteMetadataStore } from "@perspectives/metadata-sqlite";

import { SafeStorageCredentialStore } from "./credentials";
import { registerTrpcIpc } from "./trpc/ipc";
import { makeAppRouter } from "./trpc/router";

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0a0a0a",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.on("ready-to-show", () => window.show());

  // Open external links in the user's default browser rather than a new window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // In dev, electron-vite injects the renderer dev-server URL; in production
  // we load the bundled index.html shipped under out/renderer/.
  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

/**
 * Compose the engine layer. This is the *only* place in the repository that
 * gets to know about every concrete implementation:
 *   - `SqliteMetadataStore` (local on-disk persistence)
 *   - `InMemoryCredentialStore` (placeholder until the Electron
 *     `safeStorage`-backed implementation lands in a later prompt)
 *   - `PostgresAdapter` via factory closure (per-connection-profile)
 *
 * Anything downstream — the tRPC router, the renderer — only sees
 * `EngineService`.
 */
function composeEngine(): { engine: EngineService; close: () => Promise<void> } {
  const userDataDir = app.getPath("userData");
  const credentialStore = new SafeStorageCredentialStore();
  const metadataStore = new SqliteMetadataStore({
    filePath: join(userDataDir, "perspectives-metadata.sqlite"),
    credentialStore,
  });
  const engine = new EngineService({
    metadataStore,
    credentialStore,
    adapterFactory: (profile) => new PostgresAdapter(profile),
  });
  return {
    engine,
    close: async () => {
      await engine.close();
      await metadataStore.close();
    },
  };
}

app.whenReady().then(() => {
  const composition = composeEngine();
  const appRouter = makeAppRouter(composition.engine);
  registerTrpcIpc(appRouter);

  app.on("before-quit", () => {
    void composition.close();
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
