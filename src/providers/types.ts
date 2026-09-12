export type ProviderId = "stripe" | "paystack" | "fake";

/** Minor units, e.g. kobo or cents. */
export type Money = { amount: bigint; currency: string };

export type NormalisedEvent =
  | {
      type: "payment.succeeded";
      providerEventId: string;
      providerRef: string;
      customerRef?: string;
      money: Money;
      fee?: Money;
      occurredAt: Date;
      raw: unknown;
    }
  | {
      type: "payment.failed";
      providerEventId: string;
      providerRef: string;
      customerRef?: string;
      money: Money;
      reason?: string;
      occurredAt: Date;
      raw: unknown;
    }
  | {
      type: "refund.succeeded";
      providerEventId: string;
      providerRef: string;
      paymentRef: string;
      money: Money;
      occurredAt: Date;
      raw: unknown;
    }
  | {
      type: "subscription.updated";
      providerEventId: string;
      providerSubscriptionId: string;
      customerRef?: string;
      status: "active" | "past_due" | "cancelled" | "trialing" | "unpaid" | "paused";
      occurredAt: Date;
      raw: unknown;
    }
  | {
      type: "settlement.posted";
      providerEventId: string;
      settlementId: string;
      money: Money;
      fee: Money;
      occurredAt: Date;
      raw: unknown;
    };

export type NormalisedEventType = NormalisedEvent["type"];

export interface PaymentProvider {
  readonly id: ProviderId;

  createCustomer(input: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<{ providerCustomerId: string }>;

  createCheckoutSession(input: {
    providerCustomerId?: string;
    email: string;
    money: Money;
    description: string;
    reference: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string; providerRef: string }>;

  createSubscription(input: {
    providerCustomerId: string;
    plan: { providerPlanId?: string; money: Money; interval: "month" | "year" };
    reference: string;
  }): Promise<{ providerSubscriptionId: string; status: string }>;

  cancelSubscription(providerSubscriptionId: string, options?: { atPeriodEnd?: boolean }): Promise<void>;

  chargeSavedMethod(input: {
    providerCustomerId: string;
    authorization: string;
    money: Money;
    reference: string;
  }): Promise<{ providerRef: string; status: "succeeded" | "failed" | "pending" }>;

  verifyWebhookSignature(rawBody: string, headers: Headers): boolean;

  parseEvents(rawBody: string): NormalisedEvent[];

  listSettlements(range: {
    from: Date;
    to: Date;
  }): Promise<Array<{ settlementId: string; money: Money; fee: Money; settledAt: Date; paymentRefs: string[] }>>;
}
