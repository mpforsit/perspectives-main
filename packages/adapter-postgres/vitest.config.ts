import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pulling postgres:16 the first time + initialising the container can run
    // long. After the image is cached locally, startup is ~3 s.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
