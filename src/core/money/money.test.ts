import { describe, expect, it } from "vitest";
import { add, assertSameCurrency, negate, subtract, sum } from "./arithmetic";
import { getCurrency, isKnownCurrency } from "./currencies";
import { format } from "./format";
import { moneySchema } from "./schema";

describe("currencies", () => {
  it("knows NGN, USD, GBP, EUR with a 2-digit exponent", () => {
    for (const code of ["NGN", "USD", "GBP", "EUR"]) {
      expect(isKnownCurrency(code)).toBe(true);
      expect(getCurrency(code).exponent).toBe(2);
    }
  });

  it("rejects unknown currencies", () => {
    expect(isKnownCurrency("XYZ")).toBe(false);
    expect(() => getCurrency("XYZ")).toThrow(/unknown currency/i);
  });
});

describe("bigint arithmetic", () => {
  it("adds, subtracts, and negates", () => {
    expect(add(100n, 50n)).toBe(150n);
    expect(subtract(100n, 50n)).toBe(50n);
    expect(negate(100n)).toBe(-100n);
  });

  it("sums a list of amounts, defaulting to zero", () => {
    expect(sum([100n, -40n, 5n])).toBe(65n);
    expect(sum([])).toBe(0n);
  });

  it("asserts every currency in a list matches", () => {
    expect(() => assertSameCurrency(["NGN", "NGN", "NGN"])).not.toThrow();
    expect(() => assertSameCurrency(["NGN", "USD"])).toThrow(/currency mismatch/i);
  });
});

describe("format", () => {
  it("formats minor units as a localized currency string", () => {
    expect(format(150000n, "NGN", "en-NG")).toContain("1,500");
    expect(format(150000n, "USD", "en-US")).toBe("$1,500.00");
    expect(format(-500n, "USD", "en-US")).toBe("-$5.00");
  });
});

describe("moneySchema", () => {
  it("coerces bigint, number, and numeric-string amounts", () => {
    expect(moneySchema.parse({ amount: 100n, currency: "usd" })).toEqual({
      amount: 100n,
      currency: "USD",
    });
    expect(moneySchema.parse({ amount: 100, currency: "USD" }).amount).toBe(100n);
    expect(moneySchema.parse({ amount: "100", currency: "USD" }).amount).toBe(100n);
    expect(moneySchema.parse({ amount: "-100", currency: "USD" }).amount).toBe(-100n);
  });

  it("rejects non-integer amounts and unknown currencies", () => {
    expect(() => moneySchema.parse({ amount: 1.5, currency: "USD" })).toThrow();
    expect(() => moneySchema.parse({ amount: "abc", currency: "USD" })).toThrow();
    expect(() => moneySchema.parse({ amount: 100, currency: "ZZZ" })).toThrow();
  });

  it("rejects a number amount beyond Number.MAX_SAFE_INTEGER but accepts the same value as a string", () => {
    // 2**53 + 1 cannot even be represented exactly as a JS number (it rounds
    // to 2**53), which is itself already unsafe: MAX_SAFE_INTEGER is 2**53-1.
    const unsafeAsNumber = 2 ** 53 + 1;
    const unsafeAsString = "9007199254740993"; // exact, only representable as a string or bigint

    expect(() => moneySchema.parse({ amount: unsafeAsNumber, currency: "USD" })).toThrow(/safe integer/i);
    expect(moneySchema.parse({ amount: unsafeAsString, currency: "USD" }).amount).toBe(9007199254740993n);
    expect(moneySchema.parse({ amount: 9007199254740993n, currency: "USD" }).amount).toBe(9007199254740993n);
  });
});
