import { defineConfig, devices } from "@playwright/test";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://billing:billing@localhost:5433/billing_kit";

export default defineConfig({
  testDir: "e2e",
  // The suite shares one seeded fixture (see `src/test/seed.ts`) across
  // every spec, and several specs mutate it (cancel-at-period-end, webhook
  // replay, reconciliation) — one worker keeps them from racing each other.
  fullyParallel: false,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    command: "pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL,
      // Matches `OPERATOR_EMAIL` in `src/test/seed.ts` — kept as a literal
      // here rather than imported, since this file loads before the app's
      // path aliases are guaranteed to be resolved.
      OPERATOR_EMAILS: "operator@example.com",
      APP_URL: "http://localhost:3000",
    },
  },
  use: {
    baseURL: "http://localhost:3000",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      testMatch: /.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
});
