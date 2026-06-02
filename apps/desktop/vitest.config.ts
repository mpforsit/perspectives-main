import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer/src"),
    },
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["src/renderer/**/*.test.tsx", "jsdom"],
      ["src/renderer/**/*.dom.test.ts", "jsdom"],
    ],
    setupFiles: ["./test/setup-dom.ts"],
    globals: false,
  },
});
