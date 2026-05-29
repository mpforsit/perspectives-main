import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    // `superjson` is pure ESM as of v2; the main and preload bundles are CJS,
    // so `require("superjson")` fails at runtime. Bundling it inline (excluding
    // it from externalization) sidesteps the ESM/CJS mismatch.
    plugins: [externalizeDepsPlugin({ exclude: ["superjson"] })],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
      },
    },
  },
  preload: {
    // `superjson` is pure ESM as of v2; the main and preload bundles are CJS,
    // so `require("superjson")` fails at runtime. Bundling it inline (excluding
    // it from externalization) sidesteps the ESM/CJS mismatch.
    plugins: [externalizeDepsPlugin({ exclude: ["superjson"] })],
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
