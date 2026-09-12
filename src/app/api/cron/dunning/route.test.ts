import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { FakeProvider } from "@/providers/fake";
import { resetM3Tables } from "@/test/reset-db";

// Same rationale as api/cron/reconcile's route test: `route.ts` builds its
// providers via `createProvider`, which needs real Stripe/Paystack env vars.
// Mocked here so the "200 on the correct secret" path never touches either
// provider — only the auth check and the dunning job itself (against
// Postgres, with no due attempts) are under test.
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
  return new Request("http://localhost/api/cron/dunning", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

describe("POST /api/cron/dunning", () => {
  it("returns 401 when CRON_SECRET is not configured at all", async () => {
    delete process.env.CRON_SECRET;
    const response = await POST(request("Bearer anything"));
    expect(response.status).toBe(401);
  });

  it("returns 401 when the Authorization header is missing", async () => {
    process.env.CRON_SECRET = "correct-secret";
    const response = await POST(request());
    expect(response.status).toBe(401);
  });

  it("returns 401 for the wrong secret", async () => {
    process.env.CRON_SECRET = "correct-secret";
    const response = await POST(request("Bearer wrong-secret"));
    expect(response.status).toBe(401);
  });

  it("returns 200 with a summary for the correct secret, never touching a live provider", async () => {
    process.env.CRON_SECRET = "correct-secret";
    const response = await POST(request("Bearer correct-secret"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.summary).toMatchObject({ attempted: 0, recovered: 0, failed: 0, movedToUnpaid: 0, cancelled: 0 });
  });
});
