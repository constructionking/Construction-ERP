import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/helpers/setup-env.ts"],
    testTimeout: 30_000,
    // Integration tests share one database; run files serially to avoid
    // cross-file interference. Unit tests are fast enough that this doesn't hurt.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
