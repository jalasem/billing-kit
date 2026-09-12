import { expect, test } from "@playwright/test";
import { CUSTOMER_STORAGE_STATE } from "./auth-state";
import { computedContrast, tabToText } from "./helpers";

test.use({ storageState: CUSTOMER_STORAGE_STATE });

test.describe("customer portal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/portal");
  });

  test("shows the current plan and invoices", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Pro monthly" })).toBeVisible();
    await expect(page.getByText("active")).toBeVisible();

    await page.getByRole("link", { name: "Invoices" }).click();
    await expect(page).toHaveURL(/\/portal\/invoices$/);
    await expect(page.getByText(/INV-/)).toBeVisible();
  });

  test("cancel at period end shows the cancelling notice", async ({ page }) => {
    await page.getByRole("button", { name: "Cancel at period end" }).click();
    await expect(page).toHaveURL(/\/portal\?updated=1/);
    await expect(page.getByText("Cancelling")).toBeVisible();
    await expect(page.getByText(/will not renew/i)).toBeVisible();

    // Leave the fixture as the other specs expect it.
    await page.getByRole("button", { name: "Keep my subscription" }).click();
    await expect(page.getByRole("button", { name: "Cancel at period end" })).toBeVisible();
  });

  test("keyboard-only navigation reaches every control and Enter activates a focused link", async ({ page }) => {
    await tabToText(page, "Plan");
    await expect(page.getByRole("link", { name: "Plan" })).toBeFocused();

    await tabToText(page, "Invoices");
    await expect(page.getByRole("link", { name: "Invoices" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/portal\/invoices$/);

    await page.goto("/portal");
    await tabToText(page, "Payment method");
    await tabToText(page, "Log out");
    await tabToText(page, "Cancel at period end");
    await tabToText(page, "Pause subscription");
  });

  test("badge and body text meet WCAG contrast (>= 4.5:1)", async ({ page }) => {
    const badgeContrast = await computedContrast(page, "span:has-text('active')");
    expect(badgeContrast).toBeGreaterThanOrEqual(4.5);

    const bodyContrast = await computedContrast(page, "h1");
    expect(bodyContrast).toBeGreaterThanOrEqual(4.5);
  });
});
