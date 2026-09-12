import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: ".env.test" });

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/test/global-setup.ts"],
    // Ledger and idempotency tests share one Postgres database and reset
    // tables between tests, so test files must not run concurrently.
    fileParallelism: false,
    // Full-lifecycle tests make many sequential round trips against a real
    // Postgres instance; the default 5s is too tight on a loaded machine.
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
