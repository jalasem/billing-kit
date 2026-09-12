import { pgEnum } from "drizzle-orm/pg-core";

export const accountTypeEnum = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
]);

export const providerEnum = pgEnum("provider", ["stripe", "paystack", "fake"]);

export const paymentStatusEnum = pgEnum("payment_status", ["succeeded", "failed", "refunded"]);

export const reconciliationFlagKindEnum = pgEnum("reconciliation_flag_kind", [
  "unsettled_payment",
  "unknown_settlement_ref",
]);

export const planIntervalEnum = pgEnum("plan_interval", ["month", "year"]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "cancelled",
  "paused",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "open",
  "paid",
  "void",
  "uncollectible",
]);

export const invoiceLineKindEnum = pgEnum("invoice_line_kind", ["charge", "credit", "proration"]);

export const dunningOutcomeEnum = pgEnum("dunning_outcome", [
  "pending",
  "succeeded",
  "failed",
  "skipped",
]);

/** `provider`: the provider retries and emits events; `kit`: billing-kit retries via `chargeSavedMethod`. */
export const dunningModeEnum = pgEnum("dunning_mode", ["provider", "kit"]);
