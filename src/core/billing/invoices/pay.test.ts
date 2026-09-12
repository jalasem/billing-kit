import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getBalance } from "@/core/ledger";
import { db } from "@/db/client";
import { entries, reconciliationFlags } from "@/db/schema";
import { FakeProvider } from "@/providers/fake";
import { seedCustomer, seedPlan } from "@/test/billing-fixtures";
import { resetM3Tables } from "@/test/reset-db";
import { createSubscription } from "../subscriptions/create";
import { InvalidInvoiceStateError } from "./errors";
import { markInvoicePaid } from "./pay";
import { voidInvoice } from "./void";

const fakeProvider = new FakeProvider();

beforeEach(async () => {
  await resetM3Tables(db);
});

async function issueOpenInvoice(amount: bigint, currency = "USD") {
  const plan = await seedPlan(db, fakeProvider, { amount, currency });
  const customer = await seedCustomer(db, { email: `pay-${Date.now()}-${Math.random()}@example.com` });
  const { invoice } = await createSubscription(db, fakeProvider, {
    customerId: customer.id,
    planId: plan.id,
    startTrial: false,
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  return invoice!;
}

describe("markInvoicePaid: state enforcement", () => {
  it("is a no-op replay when the invoice is already paid", async () => {
    const invoice = await issueOpenInvoice(1000n);
    const first = await markInvoicePaid(db, invoice, {
      provider: "fake",
      providerRef: "ch_1",
      amount: 1000n,
      currency: "USD",
      occurredAt: new Date(),
    });
    expect(first.outcome).toBe("paid");

    const second = await markInvoicePaid(db, first.invoice, {
      provider: "fake",
      providerRef: "ch_1",
      amount: 1000n,
      currency: "USD",
      occurredAt: new Date(),
    });
    expect(second.outcome).toBe("paid");
    expect(second.invoice.id).toBe(first.invoice.id);
  });

  it("throws InvalidInvoiceStateError and posts no entry when called on a voided invoice", async () => {
    const invoice = await issueOpenInvoice(750n);
    const voided = await voidInvoice(db, invoice, "void");
    expect(voided.status).toBe("void");

    const entriesBefore = await db.select().from(entries);

    await expect(
      markInvoicePaid(db, voided, {
        provider: "fake",
        providerRef: "ch_late",
        amount: 750n,
        currency: "USD",
        occurredAt: new Date(),
      }),
    ).rejects.toThrow(InvalidInvoiceStateError);

    const entriesAfter = await db.select().from(entries);
    expect(entriesAfter).toHaveLength(entriesBefore.length);
  });

  it("throws InvalidInvoiceStateError on an uncollectible invoice", async () => {
    const invoice = await issueOpenInvoice(400n);
    const writtenOff = await voidInvoice(db, invoice, "uncollectible");
    await expect(
      markInvoicePaid(db, writtenOff, {
        provider: "fake",
        providerRef: "ch_x",
        amount: 400n,
        currency: "USD",
        occurredAt: new Date(),
      }),
    ).rejects.toThrow(InvalidInvoiceStateError);
  });
});

describe("markInvoicePaid: amount/currency mismatch", () => {
  it("marks the invoice paid when the amount and currency match exactly", async () => {
    const invoice = await issueOpenInvoice(1500n);
    const result = await markInvoicePaid(db, invoice, {
      provider: "fake",
      providerRef: "ch_exact",
      amount: 1500n,
      currency: "USD",
      occurredAt: new Date(),
    });

    expect(result.outcome).toBe("paid");
    expect(result.invoice.status).toBe("paid");
    expect(await getBalance(db, "receivable:USD")).toBe(0n);
    expect(await getBalance(db, "cash:fake:USD")).toBe(1500n);
  });

  it("leaves the invoice open, posts an unapplied receipt, and flags a mismatch when the amount is short", async () => {
    const invoice = await issueOpenInvoice(2000n);
    const result = await markInvoicePaid(db, invoice, {
      provider: "fake",
      providerRef: "ch_short",
      amount: 1200n,
      currency: "USD",
      occurredAt: new Date(),
    });

    expect(result.outcome).toBe("unapplied");
    expect(result.invoice.status).toBe("open");

    expect(await getBalance(db, "receivable:USD")).toBe(2000n);
    expect(await getBalance(db, "cash:fake:USD")).toBe(1200n);
    expect(await getBalance(db, "unapplied:fake:USD")).toBe(-1200n);

    const [flag] = await db.select().from(reconciliationFlags).where(eq(reconciliationFlags.kind, "invoice_amount_mismatch"));
    expect(flag).toMatchObject({ provider: "fake", ref: invoice.id });
    expect(flag.details).toMatchObject({ expectedAmount: "2000", actualAmount: "1200" });
  });

  it("leaves the invoice open, posts an unapplied receipt, and flags a mismatch when the amount is over", async () => {
    const invoice = await issueOpenInvoice(1000n);
    const result = await markInvoicePaid(db, invoice, {
      provider: "fake",
      providerRef: "ch_over",
      amount: 1300n,
      currency: "USD",
      occurredAt: new Date(),
    });

    expect(result.outcome).toBe("unapplied");
    expect(result.invoice.status).toBe("open");
    expect(await getBalance(db, "receivable:USD")).toBe(1000n);
    expect(await getBalance(db, "cash:fake:USD")).toBe(1300n);
    expect(await getBalance(db, "unapplied:fake:USD")).toBe(-1300n);

    const [flag] = await db.select().from(reconciliationFlags).where(eq(reconciliationFlags.kind, "invoice_amount_mismatch"));
    expect(flag.details).toMatchObject({ expectedAmount: "1000", actualAmount: "1300" });
  });

  it("does not double-post a redelivered mismatched event", async () => {
    const invoice = await issueOpenInvoice(900n);
    const input = { provider: "fake" as const, providerRef: "ch_dup", amount: 500n, currency: "USD", occurredAt: new Date() };

    await markInvoicePaid(db, invoice, input);
    await markInvoicePaid(db, invoice, input);

    expect(await getBalance(db, "cash:fake:USD")).toBe(500n);
    expect(await getBalance(db, "unapplied:fake:USD")).toBe(-500n);

    const flags = await db.select().from(reconciliationFlags).where(eq(reconciliationFlags.kind, "invoice_amount_mismatch"));
    expect(flags).toHaveLength(1);
  });
});
