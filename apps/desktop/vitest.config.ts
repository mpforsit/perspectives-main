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
    // Vitest 4 removed `environmentMatchGlobs`. Default to `node`; individual
    // .tsx component tests opt into jsdom via the `// @vitest-environment
    // jsdom` pragma at the top of the file.
    environment: "node",
    setupFiles: ["./test/setup-dom.ts"],
    globals: false,
  },
});
