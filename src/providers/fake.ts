import { createHmac, timingSafeEqual } from "node:crypto";
import type { Money, NormalisedEvent, PaymentProvider } from "./types";

const SIGNATURE_HEADER = "x-fake-signature";

/** JSON can't carry bigint or Date; this round-trips both through the fake's wire format. */
function serialiseEvents(events: NormalisedEvent[]): string {
  return JSON.stringify(events, (_key, value) => {
    if (typeof value === "bigint") {
      return { __type: "bigint", value: value.toString() };
    }
    return value;
  });
}

function deserialiseEvents(rawBody: string): NormalisedEvent[] {
  const parsed = JSON.parse(rawBody, (_key, value) => {
    if (value && typeof value === "object" && value.__type === "bigint") {
      return BigInt(value.value);
    }
    return value;
  }) as unknown[];

  return parsed.map((event) => reviveDates(event as Record<string, unknown>)) as NormalisedEvent[];
}

function reviveDates(event: Record<string, unknown>): Record<string, unknown> {
  return { ...event, occurredAt: new Date(event.occurredAt as string) };
}

/**
 * In-memory provider used by contract tests and route/job tests that need a
 * provider without touching Stripe or Paystack. `signedWebhook` emits a raw
 * body and a signature header the same way `verifyWebhookSignature` expects
 * to check them, so it exercises the same shape of round trip as the real
 * adapters without needing a real secret or a live call.
 */
export class FakeProvider implements PaymentProvider {
  readonly id = "fake" as const;

  private readonly webhookSecret: string;
  private customerSeq = 0;
  private checkoutSeq = 0;
  private subscriptionSeq = 0;
  private chargeSeq = 0;
  private readonly subscriptions = new Map<string, { status: string }>();
  private settlements: Array<{
    settlementId: string;
    money: Money;
    fee: Money;
    settledAt: Date;
    paymentRefs: string[];
  }> = [];

  constructor(webhookSecret = "fake_test_secret") {
    this.webhookSecret = webhookSecret;
  }

  async createCustomer(input: { email: string }): Promise<{ providerCustomerId: string }> {
    void input;
    this.customerSeq += 1;
    return { providerCustomerId: `cus_fake_${this.customerSeq}` };
  }

  async createCheckoutSession(input: {
    reference: string;
    successUrl: string;
  }): Promise<{ url: string; providerRef: string }> {
    this.checkoutSeq += 1;
    const providerRef = `co_fake_${this.checkoutSeq}`;
    return { url: `${input.successUrl}?session=${providerRef}`, providerRef };
  }

  async createSubscription(input: {
    reference: string;
  }): Promise<{ providerSubscriptionId: string; status: string }> {
    void input;
    this.subscriptionSeq += 1;
    const providerSubscriptionId = `sub_fake_${this.subscriptionSeq}`;
    this.subscriptions.set(providerSubscriptionId, { status: "active" });
    return { providerSubscriptionId, status: "active" };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    this.subscriptions.set(providerSubscriptionId, { status: "cancelled" });
  }

  async chargeSavedMethod(input: {
    money: Money;
    reference: string;
  }): Promise<{ providerRef: string; status: "succeeded" | "failed" | "pending" }> {
    void input;
    this.chargeSeq += 1;
    return { providerRef: `ch_fake_${this.chargeSeq}`, status: "succeeded" };
  }

  verifyWebhookSignature(rawBody: string, headers: Headers): boolean {
    const signature = headers.get(SIGNATURE_HEADER);
    if (!signature) {
      return false;
    }

    const expected = this.sign(rawBody);
    const expectedBuffer = Buffer.from(expected, "hex");
    const actualBuffer = Buffer.from(signature, "hex");

    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
  }

  parseEvents(rawBody: string): NormalisedEvent[] {
    return deserialiseEvents(rawBody);
  }

  async listSettlements(range: {
    from: Date;
    to: Date;
  }): Promise<Array<{ settlementId: string; money: Money; fee: Money; settledAt: Date; paymentRefs: string[] }>> {
    return this.settlements.filter((settlement) => settlement.settledAt >= range.from && settlement.settledAt <= range.to);
  }

  /** Test-only helper: makes a settlement show up in `listSettlements`. */
  seedSettlement(settlement: {
    settlementId: string;
    money: Money;
    fee: Money;
    settledAt: Date;
    paymentRefs: string[];
  }): void {
    this.settlements.push(settlement);
  }

  /** Builds a raw body + signature header pair for one or more events, as if a provider sent them. */
  signedWebhook(events: NormalisedEvent | NormalisedEvent[]): { rawBody: string; headers: Headers } {
    const rawBody = serialiseEvents(Array.isArray(events) ? events : [events]);
    const headers = new Headers({ [SIGNATURE_HEADER]: this.sign(rawBody) });
    return { rawBody, headers };
  }

  private sign(rawBody: string): string {
    return createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
  }
}
