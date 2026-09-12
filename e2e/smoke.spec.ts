import { expect, test } from "@playwright/test";

test("renders the milestone 0 placeholder", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("billing-kit — milestone 0")).toBeVisible();
});
