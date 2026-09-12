import { test as setup } from "@playwright/test";
import { CUSTOMER_EMAIL, OPERATOR_EMAIL } from "@/test/seed";
import { CUSTOMER_STORAGE_STATE, OPERATOR_STORAGE_STATE } from "./auth-state";
import { loginAs } from "./helpers";

/**
 * Logs in once per role and saves the session cookie to a storage-state
 * file the other specs reuse (`test.use({ storageState: ... })`). Doing
 * this once instead of per-test keeps the suite well under the 5-links-
 * per-hour magic-link rate limit and is the standard Playwright pattern
 * for auth reuse.
 */
setup("authenticate as customer", async ({ page }) => {
  await loginAs(page, CUSTOMER_EMAIL);
  await page.context().storageState({ path: CUSTOMER_STORAGE_STATE });
});

setup("authenticate as operator", async ({ page }) => {
  await loginAs(page, OPERATOR_EMAIL);
  await page.context().storageState({ path: OPERATOR_STORAGE_STATE });
});
