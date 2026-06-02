import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

/**
 * What's externalized vs bundled, and why:
 *
 *   - `superjson` is pure ESM as of v2; the main and preload bundles are CJS,
 *     so `require("superjson")` fails at runtime. Bundling it inline sidesteps
 *     the ESM/CJS mismatch.
 *
 *   - The `@perspectives/*` workspace packages publish their source TypeScript
 *     directly (`"exports": "./src/index.ts"`) since there's no pre-publish
 *     build step in the monorepo. The Electron main process is CJS, so leaving
 *     these as `require("@perspectives/adapter-postgres")` would crash on the
 *     first `export` keyword. Excluding them from externalization tells
 *     electron-vite to inline their TS into the main bundle, where esbuild
 *     transpiles them along with our own code.
 *
 *   - `pg` and `better-sqlite3` (the native runtime deps that the inlined
 *     workspace packages reach for) DO need to stay external — their
 *     `pg-native` / N-API bindings can't be bundled. They're declared in
 *     this package's `dependencies` so `externalizeDepsPlugin` picks them up
 *     automatically.
 */
const EXCLUDE_FROM_EXTERNALIZE = [
  "superjson",
  "@perspectives/adapter-postgres",
  "@perspectives/dsl",
  "@perspectives/engine",
  "@perspectives/metadata-sqlite",
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: EXCLUDE_FROM_EXTERNALIZE })],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: EXCLUDE_FROM_EXTERNALIZE })],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/preload/index.ts"),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer/src"),
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
      },
    },
  },
});
