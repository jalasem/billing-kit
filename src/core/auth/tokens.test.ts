import { describe, expect, it } from "vitest";
import { generateToken, hashToken } from "./tokens";

describe("magic-link tokens", () => {
  it("generates a distinct raw token and its SHA-256 hash each call", () => {
    const first = generateToken();
    const second = generateToken();

    expect(first.token).not.toBe(second.token);
    expect(first.hash).not.toBe(second.hash);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashToken is deterministic and matches the hash generateToken returns", () => {
    const { token, hash } = generateToken();
    expect(hashToken(token)).toBe(hash);
  });

  it("never stores the raw token anywhere but the returned value", () => {
    const { token, hash } = generateToken();
    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token);
  });
});
