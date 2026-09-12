import { afterEach, describe, expect, it } from "vitest";
import { isOperatorEmail } from "./operator";

const ORIGINAL = process.env.OPERATOR_EMAILS;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.OPERATOR_EMAILS;
  } else {
    process.env.OPERATOR_EMAILS = ORIGINAL;
  }
});

describe("isOperatorEmail", () => {
  it("matches an email listed in OPERATOR_EMAILS", () => {
    process.env.OPERATOR_EMAILS = "ops@example.com,admin@example.com";
    expect(isOperatorEmail("ops@example.com")).toBe(true);
    expect(isOperatorEmail("admin@example.com")).toBe(true);
  });

  it("is case-insensitive and trims whitespace around entries", () => {
    process.env.OPERATOR_EMAILS = " Ops@Example.com , admin@example.com ";
    expect(isOperatorEmail("ops@example.com")).toBe(true);
    expect(isOperatorEmail("OPS@EXAMPLE.COM")).toBe(true);
  });

  it("returns false for an email not listed", () => {
    process.env.OPERATOR_EMAILS = "ops@example.com";
    expect(isOperatorEmail("customer@example.com")).toBe(false);
  });

  it("returns false for everyone when OPERATOR_EMAILS is unset", () => {
    delete process.env.OPERATOR_EMAILS;
    expect(isOperatorEmail("ops@example.com")).toBe(false);
  });
});
