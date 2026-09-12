import { expect, test } from "@playwright/test";

test("renders the homepage", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("billing-kit — Stripe and Paystack billing")).toBeVisible();
});
