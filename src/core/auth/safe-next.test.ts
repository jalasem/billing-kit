import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("accepts a plain same-origin path", () => {
    expect(safeNext("/portal")).toBe("/portal");
  });

  it("accepts a same-origin path with a query string", () => {
    expect(safeNext("/admin/customers?q=jane")).toBe("/admin/customers?q=jane");
  });

  it("rejects a protocol-relative URL (//evil.com)", () => {
    expect(safeNext("//evil.com")).toBeUndefined();
  });

  it("rejects a backslash-disguised protocol-relative URL (/\\evil.com)", () => {
    expect(safeNext("/\\evil.com")).toBeUndefined();
  });

  it("rejects an absolute URL (https://evil.com)", () => {
    expect(safeNext("https://evil.com")).toBeUndefined();
  });

  it("rejects a javascript: URL", () => {
    expect(safeNext("javascript:alert(1)")).toBeUndefined();
  });

  it("rejects an empty or missing value", () => {
    expect(safeNext("")).toBeUndefined();
    expect(safeNext(undefined)).toBeUndefined();
    expect(safeNext(null)).toBeUndefined();
  });

  it("rejects a value not starting with a slash", () => {
    expect(safeNext("portal")).toBeUndefined();
  });
});
