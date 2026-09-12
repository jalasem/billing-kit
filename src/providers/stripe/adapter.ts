import Stripe from "stripe";
import { toSafeNumber } from "@/core/money/arithmetic";
import type { Money, NormalisedEvent, PaymentProvider } from "../types";
import { createStripeClient } from "./client";
import { mapStripeEvent } from "./mapping";

/**
 * The subset of the Stripe SDK `listSettlements` needs, so tests can inject
 * a plain `{ data: [...] }` stub instead of a live client. A real `Stripe`
 * instance satisfies this structurally: `Stripe.Response<Stripe.ApiList<T>>`
 * is `{ data: T[]; ... }` plus extra fields this interface ignores.
 */
export interface StripeSettlementsClient {
  payouts: {
    list(params: Stripe.PayoutListParams): Promise<{ data: Stripe.Payout[] }>;
  };
  balanceTransactions: {
    list(params: Stripe.BalanceTransactionListParams): Promise<{ data: Stripe.BalanceTransaction[] }>;
  };
}

export interface StripeProviderOptions {
  secretKey: string;
  webhookSecret: string;
  /** Injected in tests to avoid a live Stripe client; defaults to a real `Stripe` instance. */
  client?: Stripe;
}

export class StripeProvider implements PaymentProvider {
  readonly id = "stripe" as const;

  private readonly client: Stripe;
  private readonly settlementsClient: StripeSettlementsClient;
  private readonly webhookSecret: string;

  constructor(options: StripeProviderOptions, settlementsClient?: StripeSettlementsClient) {
    this.client = options.client ?? createStripeClient(options.secretKey);
    this.settlementsClient = settlementsClient ?? this.client;
    this.webhookSecret = options.webhookSecret;
  }

  async createCustomer(input: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<{ providerCustomerId: string }> {
    const customer = await this.client.customers.create({
      email: input.email,
      name: input.name,
      metadata: input.metadata,
    });
    return { providerCustomerId: customer.id };
  }

  async createCheckoutSession(input: {
    providerCustomerId?: string;
    email: string;
    money: Money;
    description: string;
    reference: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string; providerRef: string }> {
    const session = await this.client.checkout.sessions.create({
      mode: "payment",
      customer: input.providerCustomerId,
      customer_email: input.providerCustomerId ? undefined : input.email,
      client_reference_id: input.reference,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: input.metadata,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.money.currency.toLowerCase(),
            unit_amount: toSafeNumber(input.money.amount),
            product_data: { name: input.description },
          },
        },
      ],
    });

    if (!session.url) {
      throw new Error("Stripe did not return a checkout session URL");
    }
    return { url: session.url, providerRef: session.id };
  }

  async createSubscription(input: {
    providerCustomerId: string;
    plan: { providerPlanId?: string; money: Money; interval: "month" | "year" };
    reference: string;
  }): Promise<{ providerSubscriptionId: string; status: string }> {
    const price = input.plan.providerPlanId
      ? input.plan.providerPlanId
      : (
          await this.client.prices.create({
            currency: input.plan.money.currency.toLowerCase(),
            unit_amount: toSafeNumber(input.plan.money.amount),
            recurring: { interval: input.plan.interval },
            product_data: { name: input.reference },
          })
        ).id;

    const subscription = await this.client.subscriptions.create({
      customer: input.providerCustomerId,
      items: [{ price }],
      metadata: { reference: input.reference },
    });

    return { providerSubscriptionId: subscription.id, status: subscription.status };
  }

  async cancelSubscription(providerSubscriptionId: string, options?: { atPeriodEnd?: boolean }): Promise<void> {
    if (options?.atPeriodEnd) {
      await this.client.subscriptions.update(providerSubscriptionId, { cancel_at_period_end: true });
      return;
    }
    await this.client.subscriptions.cancel(providerSubscriptionId);
  }

  async chargeSavedMethod(input: {
    providerCustomerId: string;
    authorization: string;
    money: Money;
    reference: string;
  }): Promise<{ providerRef: string; status: "succeeded" | "failed" | "pending" }> {
    const intent = await this.client.paymentIntents.create({
      customer: input.providerCustomerId,
      payment_method: input.authorization,
      amount: toSafeNumber(input.money.amount),
      currency: input.money.currency.toLowerCase(),
      confirm: true,
      off_session: true,
      metadata: { reference: input.reference },
    });

    const status = intent.status === "succeeded" ? "succeeded" : intent.status === "requires_action" ? "pending" : "failed";
    return { providerRef: intent.id, status };
  }

  verifyWebhookSignature(rawBody: string, headers: Headers): boolean {
    const signature = headers.get("stripe-signature");
    if (!signature) {
      return false;
    }
    try {
      Stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
      return true;
    } catch {
      return false;
    }
  }

  parseEvents(rawBody: string): NormalisedEvent[] {
    const event = JSON.parse(rawBody) as Stripe.Event;
    const mapped = mapStripeEvent(event);
    return mapped ? [mapped] : [];
  }

  async listSettlements(range: {
    from: Date;
    to: Date;
  }): Promise<Array<{ settlementId: string; money: Money; fee: Money; settledAt: Date; paymentRefs: string[] }>> {
    const payouts = await this.settlementsClient.payouts.list({
      arrival_date: {
        gte: Math.floor(range.from.getTime() / 1000),
        lte: Math.floor(range.to.getTime() / 1000),
      },
      status: "paid",
    });

    const settlements = [];
    for (const payout of payouts.data) {
      const transactions = await this.settlementsClient.balanceTransactions.list({ payout: payout.id });
      const paymentRefs = transactions.data
        .filter((transaction) => transaction.type === "charge" || transaction.type === "payment")
        .map((transaction) =>
          typeof transaction.source === "string" ? transaction.source : (transaction.source?.id ?? undefined),
        )
        .filter((source): source is string => Boolean(source));

      settlements.push({
        settlementId: payout.id,
        money: { amount: BigInt(payout.amount), currency: payout.currency.toUpperCase() },
        // Stripe does not charge a separate payout fee; any processing fees
        // were already posted per-transaction when each payment succeeded.
        fee: { amount: 0n, currency: payout.currency.toUpperCase() },
        settledAt: new Date(payout.arrival_date * 1000),
        paymentRefs,
      });
    }

    return settlements;
  }
}
