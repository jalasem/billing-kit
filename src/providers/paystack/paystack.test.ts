import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PaystackProvider } from "./adapter";
import { PaystackClient } from "./client";

function fixture(name: string): string {
  return readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
}

function provider(client?: PaystackClient): PaystackProvider {
  return new PaystackProvider({ secretKey: "sk_test_stub", client });
}

describe("PaystackProvider.parseEvents mapping", () => {
  it("maps charge.success to payment.succeeded, amount and fee in kobo", () => {
    const [event] = provider().parseEvents(fixture("charge-success.json"));
    expect(event).toMatchObject({
      type: "payment.succeeded",
      providerRef: "qTPrJoy9Bx",
      customerRef: "CUS_xnxdt6s1zg1f4nx",
      money: { amount: 1000000n, currency: "NGN" },
      fee: { amount: 15000n, currency: "NGN" },
    });
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it("maps invoice.payment_failed to payment.failed", () => {
    const [event] = provider().parseEvents(fixture("invoice-payment-failed.json"));
    expect(event).toMatchObject({
      type: "payment.failed",
      providerRef: "inv_qTPrJoy9By",
      money: { amount: 500000n, currency: "NGN" },
      reason: "Your card was declined.",
    });
  });

  it("maps refund.processed to refund.succeeded", () => {
    const [event] = provider().parseEvents(fixture("refund-processed.json"));
    expect(event).toMatchObject({
      type: "refund.succeeded",
      providerRef: "9911",
      paymentRef: "qTPrJoy9Bx",
      money: { amount: 1000000n, currency: "NGN" },
    });
  });

  it("maps subscription.create and subscription.disable to subscription.updated", () => {
    const [created] = provider().parseEvents(fixture("subscription-create.json"));
    expect(created).toMatchObject({
      type: "subscription.updated",
      providerSubscriptionId: "SUB_vsyqdmlzble3uii",
      status: "active",
    });

    const [disabled] = provider().parseEvents(fixture("subscription-disable.json"));
    expect(disabled).toMatchObject({
      type: "subscription.updated",
      providerSubscriptionId: "SUB_vsyqdmlzble3uii",
      status: "cancelled",
    });
  });

  it("maps transfer.success to settlement.posted with no additional fee", () => {
    const [event] = provider().parseEvents(fixture("transfer-success.json"));
    expect(event).toMatchObject({
      type: "settlement.posted",
      settlementId: "TRF_1ptvuv321ahaa7q",
      money: { amount: 985000n, currency: "NGN" },
      fee: { amount: 0n, currency: "NGN" },
    });
  });

  it("returns no events for a type it does not map", () => {
    expect(provider().parseEvents(fixture("customer-identification-unhandled.json"))).toEqual([]);
  });

  it("gives two different raw deliveries of the same event the same synthetic providerEventId", () => {
    const [first] = provider().parseEvents(fixture("charge-success.json"));
    const [second] = provider().parseEvents(fixture("charge-success.json"));
    expect(first.providerEventId).toBe(second.providerEventId);
  });
});

describe("PaystackProvider.listSettlements", () => {
  it("pairs each settlement with its transactions via an injected fetch stub", async () => {
    const settlementList = fixture("settlement-list.json");
    const settlementTransactions = fixture("settlement-transactions.json");

    const fetchImpl = vi.fn(async (url: string) => {
      const body = url.includes("/transactions") ? settlementTransactions : settlementList;
      return new Response(JSON.stringify({ status: true, message: "ok", data: JSON.parse(body) }));
    });

    const client = new PaystackClient("sk_test_stub", { fetchImpl });
    const settlements = await provider(client).listSettlements({
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-01-10T00:00:00Z"),
    });

    expect(settlements).toEqual([
      {
        settlementId: "555001",
        money: { amount: 985000n, currency: "NGN" },
        fee: { amount: 15000n, currency: "NGN" },
        settledAt: new Date("2026-01-06"),
        paymentRefs: ["qTPrJoy9Bx"],
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("PaystackProvider.verifyWebhookSignature", () => {
  it("rejects a signature computed with the wrong secret", async () => {
    const { createHmac } = await import("node:crypto");
    const rawBody = fixture("charge-success.json");
    const wrongSignature = createHmac("sha512", "not-the-secret").update(rawBody).digest("hex");

    expect(provider().verifyWebhookSignature(rawBody, new Headers({ "x-paystack-signature": wrongSignature }))).toBe(
      false,
    );
  });
});
