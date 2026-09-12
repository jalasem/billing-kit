import { createHmac, timingSafeEqual } from "node:crypto";
import { toSafeNumber } from "@/core/money/arithmetic";
import type { Money, NormalisedEvent, PaymentProvider } from "../types";
import { PaystackClient } from "./client";
import { mapPaystackEvent } from "./mapping";

const SIGNATURE_HEADER = "x-paystack-signature";
const FALLBACK_CURRENCY = "NGN";

interface PaystackSettlementSummary {
  id: number;
  status: string;
  settlement_date: string;
  total_amount: number;
  total_fees: number;
  /** Not documented on every Paystack settlement response; see the report's guessed-shapes list. */
  currency?: string;
}

interface PaystackSettlementTransaction {
  reference: string;
}

export interface PaystackProviderOptions {
  secretKey: string;
  /** Injected in tests to avoid a live `fetch` call. */
  client?: PaystackClient;
}

export class PaystackProvider implements PaymentProvider {
  readonly id = "paystack" as const;

  private readonly client: PaystackClient;
  private readonly secretKey: string;

  constructor(options: PaystackProviderOptions) {
    this.secretKey = options.secretKey;
    this.client = options.client ?? new PaystackClient(options.secretKey);
  }

  async createCustomer(input: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<{ providerCustomerId: string }> {
    const [first_name, ...rest] = (input.name ?? "").split(" ");
    const response = await this.client.post<{ customer_code: string }>("/customer", {
      email: input.email,
      first_name: first_name || undefined,
      last_name: rest.join(" ") || undefined,
      metadata: input.metadata,
    });
    return { providerCustomerId: response.data.customer_code };
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
    const response = await this.client.post<{ authorization_url: string; reference: string }>(
      "/transaction/initialize",
      {
        email: input.email,
        amount: toSafeNumber(input.money.amount),
        currency: input.money.currency.toUpperCase(),
        reference: input.reference,
        callback_url: input.successUrl,
        metadata: { ...input.metadata, description: input.description, cancel_url: input.cancelUrl },
      },
    );
    return { url: response.data.authorization_url, providerRef: response.data.reference };
  }

  async createSubscription(input: {
    providerCustomerId: string;
    plan: { providerPlanId?: string; money: Money; interval: "month" | "year" };
    reference: string;
  }): Promise<{ providerSubscriptionId: string; status: string }> {
    if (!input.plan.providerPlanId) {
      throw new Error("Paystack subscriptions require a pre-created plan (providerPlanId)");
    }
    const response = await this.client.post<{ subscription_code: string; status: string }>("/subscription", {
      customer: input.providerCustomerId,
      plan: input.plan.providerPlanId,
    });
    return { providerSubscriptionId: response.data.subscription_code, status: response.data.status };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    await this.client.post("/subscription/disable", {
      code: providerSubscriptionId,
      token: providerSubscriptionId,
    });
  }

  async chargeSavedMethod(input: {
    providerCustomerId: string;
    authorization: string;
    money: Money;
    reference: string;
  }): Promise<{ providerRef: string; status: "succeeded" | "failed" | "pending" }> {
    const response = await this.client.post<{ reference: string; status: string }>("/transaction/charge_authorization", {
      authorization_code: input.authorization,
      email: input.providerCustomerId,
      amount: toSafeNumber(input.money.amount),
      currency: input.money.currency.toUpperCase(),
      reference: input.reference,
    });

    const status = response.data.status === "success" ? "succeeded" : response.data.status === "failed" ? "failed" : "pending";
    return { providerRef: response.data.reference, status };
  }

  verifyWebhookSignature(rawBody: string, headers: Headers): boolean {
    const signature = headers.get(SIGNATURE_HEADER);
    if (!signature) {
      return false;
    }

    const expected = createHmac("sha512", this.secretKey).update(rawBody).digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const actualBuffer = Buffer.from(signature, "hex");

    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
  }

  parseEvents(rawBody: string): NormalisedEvent[] {
    const envelope = JSON.parse(rawBody) as { event: string; data: unknown };
    const mapped = mapPaystackEvent(envelope);
    return mapped ? [mapped] : [];
  }

  async listSettlements(range: {
    from: Date;
    to: Date;
  }): Promise<Array<{ settlementId: string; money: Money; fee: Money; settledAt: Date; paymentRefs: string[] }>> {
    const from = range.from.toISOString().slice(0, 10);
    const to = range.to.toISOString().slice(0, 10);

    const response = await this.client.get<PaystackSettlementSummary[]>(`/settlement?from=${from}&to=${to}`);

    const settlements = [];
    for (const settlement of response.data) {
      const transactions = await this.client.get<PaystackSettlementTransaction[]>(
        `/settlement/${settlement.id}/transactions`,
      );
      const currency = this.settlementCurrency(settlement);

      settlements.push({
        settlementId: String(settlement.id),
        // Net of the per-transaction fees already posted at charge.success time.
        money: { amount: BigInt(settlement.total_amount), currency },
        fee: { amount: BigInt(settlement.total_fees), currency },
        settledAt: new Date(settlement.settlement_date),
        paymentRefs: transactions.data.map((transaction) => transaction.reference),
      });
    }

    return settlements;
  }

  /**
   * Reads the settlement's own currency when the response includes one,
   * falling back to NGN only when it's absent (Paystack's `/settlement`
   * response shape isn't officially documented field-by-field — see the
   * report's guessed-shapes list) — and logging when that fallback fires,
   * since a silent wrong-currency default would be a real bug in any
   * non-NGN deployment.
   */
  private settlementCurrency(settlement: PaystackSettlementSummary): string {
    if (settlement.currency) {
      return settlement.currency.toUpperCase();
    }
    console.warn(`[paystack] settlement ${settlement.id} has no currency field; defaulting to ${FALLBACK_CURRENCY}`);
    return FALLBACK_CURRENCY;
  }
}
