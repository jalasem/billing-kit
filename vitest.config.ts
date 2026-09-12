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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
