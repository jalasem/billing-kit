import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { resetBillingTables } from "@/test/reset-db";
import { POST } from "./route";

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(async () => {
  await resetBillingTables(db);
});

afterEach(() => {
  if (ORIGINAL_CRON_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  }
});

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/retry-webhooks", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

describe("POST /api/cron/retry-webhooks", () => {
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

  it("returns 200 with a summary for the correct secret", async () => {
    process.env.CRON_SECRET = "correct-secret";
    const response = await POST(request("Bearer correct-secret"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, summary: { attempted: 0, succeeded: 0, stillFailing: 0 } });
  });
});
