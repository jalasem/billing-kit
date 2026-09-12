import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getBalance } from "@/core/ledger";
import { db } from "@/db/client";
import { customers, invoiceLines } from "@/db/schema";
import { FakeProvider } from "@/providers/fake";
import { seedCustomer, seedPlan } from "@/test/billing-fixtures";
import { resetM3Tables } from "@/test/reset-db";
import { issueInvoiceForPeriod } from "./issue";
import { createSubscription } from "../subscriptions/create";

const fakeProvider = new FakeProvider();

beforeEach(async () => {
  await resetM3Tables(db);
});

describe("issueInvoiceForPeriod", () => {
  it("issues a draft-to-open invoice with correct receivable/revenue balances", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 1500n, currency: "USD" });
    const customer = await seedCustomer(db, { email: "issue-1@example.com" });
    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      startTrial: false,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    // No default_authorization, so createSubscription's own first invoice
    // stays open; calling issueInvoiceForPeriod again just returns that
    // same invoice (idempotent per subscription/period_start).
    const { invoice, lines } = await issueInvoiceForPeriod(db, subscription, plan);

    expect(invoice.status).toBe("open");
    expect(invoice.total).toBe(1500n);
    expect(invoice.number).toMatch(/^INV-2026-\d{6}$/);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "charge", amount: 1500n });

    expect(await getBalance(db, "receivable:USD")).toBe(1500n);
    expect(await getBalance(db, "revenue:USD")).toBe(-1500n);
  });

  it("is idempotent per (subscription, period_start): calling twice issues one invoice", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 1200n, currency: "USD" });
    const customer = await seedCustomer(db, { email: "issue-2@example.com" });
    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      startTrial: false,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const first = await issueInvoiceForPeriod(db, subscription, plan);
    const second = await issueInvoiceForPeriod(db, subscription, plan);

    expect(first.invoice.id).toBe(second.invoice.id);
    expect(second.created).toBe(false);
    expect(await getBalance(db, "receivable:USD")).toBe(1200n);
  });

  it("applies pending customer credit against the invoice subtotal", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 1000n, currency: "USD" });
    const customer = await seedCustomer(db, { email: "issue-3@example.com" });
    await db.update(customers).set({ customerCredits: 400n }).where(eq(customers.id, customer.id));

    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      startTrial: false,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const { invoice, lines } = await issueInvoiceForPeriod(db, subscription, plan);

    expect(invoice.subtotal).toBe(1000n);
    expect(invoice.total).toBe(600n);
    const creditLine = lines.find((line) => line.kind === "credit");
    expect(creditLine?.amount).toBe(-400n);

    const [updatedCustomer] = await db.select().from(customers).where(eq(customers.id, customer.id));
    expect(updatedCustomer.customerCredits).toBe(0n);
    expect(await getBalance(db, "receivable:USD")).toBe(600n);
  });

  it("marks an invoice fully covered by credit as paid immediately, with no ledger entry", async () => {
    const plan = await seedPlan(db, fakeProvider, { amount: 500n, currency: "USD" });
    const customer = await seedCustomer(db, { email: "issue-4@example.com" });
    await db.update(customers).set({ customerCredits: 1000n }).where(eq(customers.id, customer.id));

    const { subscription } = await createSubscription(db, fakeProvider, {
      customerId: customer.id,
      planId: plan.id,
      startTrial: false,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const { invoice } = await issueInvoiceForPeriod(db, subscription, plan);
    expect(invoice.status).toBe("paid");
    expect(invoice.total).toBe(0n);
    expect(invoice.issuedEntryId).toBeNull();

    const remainingLines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id));
    expect(remainingLines.some((line) => line.kind === "credit" && line.amount === -500n)).toBe(true);

    const [updatedCustomer] = await db.select().from(customers).where(eq(customers.id, customer.id));
    expect(updatedCustomer.customerCredits).toBe(500n);
  });
});
