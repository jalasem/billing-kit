import { expect, test } from "@playwright/test";
import { CUSTOMER_EMAIL, OPERATOR_EMAIL } from "@/test/seed";
import { loginAs } from "./helpers";

test.describe("authentication", () => {
  test("logging in with a magic link lands a customer on the portal", async ({ page }) => {
    await loginAs(page, CUSTOMER_EMAIL);
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
  });

  test("logging in as an operator email lands on the admin dashboard", async ({ page }) => {
    await loginAs(page, OPERATOR_EMAIL);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("unauthenticated access to /portal redirects to /login", async ({ page }) => {
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a customer session cannot reach /admin", async ({ page }) => {
    await loginAs(page, CUSTOMER_EMAIL);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/portal/);
  });

  test("logout clears the session", async ({ page }) => {
    await loginAs(page, CUSTOMER_EMAIL);
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/login/);
  });
});
