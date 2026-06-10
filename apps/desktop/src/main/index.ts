import { join } from "node:path";
import { app, BrowserWindow, session, shell } from "electron";

import { PostgresAdapter } from "@perspectives/adapter-postgres";
import { EngineService } from "@perspectives/engine";
import { SqliteMetadataStore } from "@perspectives/metadata-sqlite";

import { SafeStorageCredentialStore } from "./credentials";
import { buildContentSecurityPolicy } from "./csp";
import { registerTrpcIpc } from "./trpc/ipc";
import { makeAppRouter } from "./trpc/router";
import { isAllowedExternalUrl, resolveDevServerUrl } from "./url-policy";

function currentDevServerUrl(): URL | null {
  return resolveDevServerUrl({
    isPackaged: app.isPackaged,
    rendererUrl: process.env["ELECTRON_RENDERER_URL"],
  });
}

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

  // Open external links in the user's default browser rather than a new
  // window — and only when the URL is http(s).
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  // Top-level navigation away from the loaded renderer is never legitimate.
  // The renderer is a SPA; intra-app routing happens via React state, not
  // browser navigation. Deny everything by default.
  window.webContents.on("will-navigate", (event, target) => {
    const devUrl = currentDevServerUrl();
    if (devUrl !== null && target.startsWith(devUrl.origin)) {
      // Vite HMR triggers a will-navigate when it reloads the document — allow
      // navigation back to the same loopback dev origin.
      return;
    }
    event.preventDefault();
    if (isAllowedExternalUrl(target)) void shell.openExternal(target);
  });

  const devUrl = currentDevServerUrl();
  if (devUrl !== null) {
    void window.loadURL(devUrl.toString());
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

/**
 * Install the Content-Security-Policy on every renderer response. Done as
 * a response header (not a `<meta http-equiv>`) so the policy applies to
 * `file://` loads in packaged builds too — meta-tag CSP is unreliable
 * across Electron versions for non-HTTP origins.
 */
function installCsp(): void {
  const devOrigin = currentDevServerUrl()?.origin;
  const csp = buildContentSecurityPolicy({
    isPackaged: app.isPackaged,
    ...(devOrigin !== undefined ? { devOrigin } : {}),
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    // Strip any upstream CSP — Vite's dev server doesn't set one, but be
    // defensive against the next dependency that does. Case-insensitive
    // delete.
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "content-security-policy") delete headers[key];
    }
    headers["Content-Security-Policy"] = [csp];
    callback({ responseHeaders: headers });
  });
}

app.whenReady().then(() => {
  installCsp();
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
