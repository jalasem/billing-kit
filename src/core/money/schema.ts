import { z } from "zod";
import { isKnownCurrency } from "./currencies";

const INTEGER_STRING = /^-?\d+$/;

const amountSchema = z.union([z.bigint(), z.number(), z.string()]).transform((value, ctx) => {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Amount must be a safe integer number of minor units (±2^53-1); pass a string or bigint for larger amounts",
      });
      return z.NEVER;
    }
    return BigInt(value);
  }

  const trimmed = value.trim();
  if (!INTEGER_STRING.test(trimmed)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Amount must be an integer string of minor units",
    });
    return z.NEVER;
  }
  return BigInt(trimmed);
});

const currencySchema = z
  .string()
  .transform((value) => value.toUpperCase())
  .refine(isKnownCurrency, (value) => ({ message: `Unknown currency: ${value}` }));

export const moneySchema = z.object({
  amount: amountSchema,
  currency: currencySchema,
});

export type MoneyInput = z.input<typeof moneySchema>;
export type Money = z.output<typeof moneySchema>;
