import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { FakeProvider } from "@/providers/fake";
import { resetM3Tables } from "@/test/reset-db";

vi.mock("@/providers/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/registry")>();
  return { ...actual, createProvider: () => new FakeProvider() };
});

const { POST } = await import("./route");

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(async () => {
  await resetM3Tables(db);
});

afterEach(() => {
  if (ORIGINAL_CRON_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  }
});

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/renew", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

describe("POST /api/cron/renew", () => {
  it("returns 401 for a missing or wrong secret", async () => {
    process.env.CRON_SECRET = "correct-secret";
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request("Bearer wrong"))).status).toBe(401);
  });

  it("returns 200 with a summary for the correct secret, never touching a live provider", async () => {
    process.env.CRON_SECRET = "correct-secret";
    const response = await POST(request("Bearer correct-secret"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.summary).toMatchObject({ renewed: 0, trialsActivated: 0, cancelled: 0, paymentsFailed: 0 });
  });
});
