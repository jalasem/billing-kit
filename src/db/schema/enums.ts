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
