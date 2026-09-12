import { readFileSync } from "node:fs";
import path from "node:path";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import type { StripeSettlementsClient } from "./adapter";
import { StripeProvider } from "./adapter";

function fixture(name: string): string {
  return readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

function provider(settlementsClient?: StripeSettlementsClient): StripeProvider {
  return new StripeProvider(
    { secretKey: "sk_test_stub", webhookSecret: "whsec_test_stub" },
    settlementsClient,
  );
}

describe("StripeProvider.parseEvents mapping", () => {
  it("maps checkout.session.completed to payment.succeeded with the expanded balance transaction fee", () => {
    const [event] = provider().parseEvents(fixture("checkout-session-completed.json"));
    expect(event).toMatchObject({
      type: "payment.succeeded",
      providerRef: "pi_3PQRstAbCdEf",
      customerRef: "cus_NffrFeUfNV2Hib",
      money: { amount: 500000n, currency: "USD" },
      fee: { amount: 14800n, currency: "USD" },
    });
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it("maps invoice.paid to payment.succeeded", () => {
    const [event] = provider().parseEvents(fixture("invoice-paid.json"));
    expect(event).toMatchObject({
      type: "payment.succeeded",
      providerRef: "pi_3PQRstInvoice001",
      money: { amount: 200000n, currency: "USD" },
      fee: { amount: 6100n, currency: "USD" },
    });
  });

  it("maps invoice.payment_failed to payment.failed, falling back to the invoice id with no successful payment intent", () => {
    const [event] = provider().parseEvents(fixture("invoice-payment-failed.json"));
    expect(event).toMatchObject({
      type: "payment.failed",
      providerRef: "in_1PQRstInv002",
      money: { amount: 200000n, currency: "USD" },
      reason: "Your card was declined.",
    });
  });

  it("maps charge.refunded to refund.succeeded", () => {
    const [event] = provider().parseEvents(fixture("charge-refunded.json"));
    expect(event).toMatchObject({
      type: "refund.succeeded",
      providerRef: "re_3PQRstRefund001",
      paymentRef: "pi_3PQRstAbCdEf",
      money: { amount: 500000n, currency: "USD" },
    });
  });

  it("maps customer.subscription.updated and .deleted to subscription.updated", () => {
    const [updated] = provider().parseEvents(fixture("subscription-updated.json"));
    expect(updated).toMatchObject({
      type: "subscription.updated",
      providerSubscriptionId: "sub_1PQRstSub001",
      status: "past_due",
    });

    const [deleted] = provider().parseEvents(fixture("subscription-deleted.json"));
    expect(deleted).toMatchObject({
      type: "subscription.updated",
      providerSubscriptionId: "sub_1PQRstSub001",
      status: "cancelled",
    });
  });

  it("maps payout.paid to settlement.posted with zero fee", () => {
    const [event] = provider().parseEvents(fixture("payout-paid.json"));
    expect(event).toMatchObject({
      type: "settlement.posted",
      settlementId: "po_3PQRstPayout001",
      money: { amount: 485200n, currency: "USD" },
      fee: { amount: 0n, currency: "USD" },
    });
  });

  it("returns no events for a type it does not map", () => {
    expect(provider().parseEvents(fixture("customer-created-unhandled.json"))).toEqual([]);
  });
});

describe("StripeProvider.listSettlements", () => {
  it("pairs each payout with its balance transactions via an injected client stub", async () => {
    const payouts = [
      { id: "po_3PQRstPayout001", amount: 685200, currency: "usd", arrival_date: 1736208000 },
    ] as unknown as Stripe.Payout[];
    const balanceTransactions = JSON.parse(
      fixture("payout-balance-transactions.json"),
    ) as Stripe.BalanceTransaction[];

    const stubClient: StripeSettlementsClient = {
      payouts: { list: async () => ({ data: payouts }) },
      balanceTransactions: { list: async () => ({ data: balanceTransactions }) },
    };

    const settlements = await provider(stubClient).listSettlements({
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-01-10T00:00:00Z"),
    });

    expect(settlements).toEqual([
      {
        settlementId: "po_3PQRstPayout001",
        money: { amount: 685200n, currency: "USD" },
        fee: { amount: 0n, currency: "USD" },
        settledAt: new Date(1736208000 * 1000),
        paymentRefs: ["pi_3PQRstAbCdEf", "pi_3PQRstInvoice001"],
      },
    ]);
  });
});
