import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { customers, invoices, subscriptions, webhookEvents } from "@/db/schema";
import { OPERATOR_STORAGE_STATE } from "./auth-state";
import { db } from "./db";

test.use({ storageState: OPERATOR_STORAGE_STATE });

test.describe("admin", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
  });

  // Compares the dashboard tiles against a live count from the database
  // rather than a hardcoded number — the exact customer count depends on
  // which fixture emails have logged in (each login implicitly creates a
  // customer row), which this spec doesn't control.
  test("dashboard shows counts that match the database", async ({ page }) => {
    const [[{ value: customerCount }], [{ value: activeSubs }], [{ value: openInvoices }], [{ value: failedWebhooks }]] = await Promise.all([
      db.select({ value: count() }).from(customers),
      db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.status, "active")),
      db.select({ value: count() }).from(invoices).where(eq(invoices.status, "open")),
      db.select({ value: count() }).from(webhookEvents).where(and(isNull(webhookEvents.processedAt), isNotNull(webhookEvents.error))),
    ]);

    const customersTile = page.locator("main a", { hasText: "Customers" });
    await expect(customersTile.getByText(String(customerCount), { exact: true })).toBeVisible();

    const activeSubsTile = page.locator("main a", { hasText: "Active subscriptions" });
    await expect(activeSubsTile.getByText(String(activeSubs), { exact: true })).toBeVisible();

    const openInvoicesTile = page.locator("main a", { hasText: "Open invoices" });
    await expect(openInvoicesTile.getByText(String(openInvoices), { exact: true })).toBeVisible();

    const failedWebhooksTile = page.locator("main a", { hasText: "Failed webhooks" });
    await expect(failedWebhooksTile.getByText(String(failedWebhooks), { exact: true })).toBeVisible();
  });

  // "receivable:USD" is guaranteed to have postings from the seeded
  // invoice's issued/paid entries (unlike, say, "bank:USD", which nothing
  // ever posts to) — picked by name rather than "the first row" so the
  // drill-down always has something to drill into.
  test("ledger explorer drills down from an account to an entry", async ({ page }) => {
    await page.goto("/admin/ledger");
    await page.getByRole("row", { name: /receivable:USD/ }).getByRole("link", { name: "View postings" }).click();
    await expect(page).toHaveURL(/\/admin\/ledger\/accounts\//);

    await page.getByRole("link", { name: "View entry" }).first().click();
    await expect(page).toHaveURL(/\/admin\/ledger\/entries\//);
    await expect(page.getByRole("heading", { level: 2, name: "Postings" })).toBeVisible();
  });

  test("verify recomputes an account's balance and reports a match", async ({ page }) => {
    await page.goto("/admin/ledger");
    await page.getByRole("row", { name: /receivable:USD/ }).getByRole("link", { name: "View postings" }).click();
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("status")).toContainText("Verified");
  });

  test("replaying a webhook event marks it processed", async ({ page }) => {
    await page.goto("/admin/webhooks");
    const row = page.locator("tbody tr").first();
    await expect(row.getByText("Unprocessed")).toBeVisible();

    await row.getByRole("button", { name: "Replay" }).click();
    await expect(page.getByRole("status")).toContainText("Replayed event");

    const updatedRow = page.locator("tbody tr").first();
    await expect(updatedRow.getByText("Unprocessed")).toHaveCount(0);
  });
});
