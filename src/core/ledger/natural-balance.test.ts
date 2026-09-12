import { describe, expect, it } from "vitest";
import { naturalBalance } from "./natural-balance";

describe("naturalBalance", () => {
  it("leaves a debit-normal account's balance as-is (asset)", () => {
    expect(naturalBalance({ type: "asset" }, 500n)).toBe(500n);
  });

  it("leaves a debit-normal account's balance as-is (expense)", () => {
    expect(naturalBalance({ type: "expense" }, 500n)).toBe(500n);
  });

  it("flips the sign for a credit-normal account (liability)", () => {
    expect(naturalBalance({ type: "liability" }, -500n)).toBe(500n);
  });

  it("flips the sign for a credit-normal account (equity)", () => {
    expect(naturalBalance({ type: "equity" }, -500n)).toBe(500n);
  });

  it("flips the sign for a credit-normal account (revenue)", () => {
    expect(naturalBalance({ type: "revenue" }, -500n)).toBe(500n);
  });

  it("a zero balance stays zero regardless of account type", () => {
    expect(naturalBalance({ type: "revenue" }, 0n)).toBe(0n);
    expect(naturalBalance({ type: "asset" }, 0n)).toBe(0n);
  });
});
