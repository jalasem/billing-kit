import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { resetM4Tables } from "@/test/reset-db";
import { createSessionRow, deleteSessionRow, getSessionRow, SESSION_TTL_MS } from "./session";
import { isOperatorEmail } from "./operator";

beforeEach(async () => {
  await resetM4Tables(db);
});

describe("session helper", () => {
  it("creates a session with a 30-day expiry and an operator flag", () => {
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("round-trips a customer session", async () => {
    const session = await createSessionRow(db, { email: "customer@example.com", customerId: null, isOperator: false });
    const fetched = await getSessionRow(db, session.id);
    expect(fetched?.email).toBe("customer@example.com");
    expect(fetched?.isOperator).toBe(false);
  });

  it("sets is_operator from OPERATOR_EMAILS at session-creation time", async () => {
    process.env.OPERATOR_EMAILS = "ops@example.com";
    const isOperator = isOperatorEmail("ops@example.com");
    const session = await createSessionRow(db, { email: "ops@example.com", customerId: null, isOperator });
    const fetched = await getSessionRow(db, session.id);
    expect(fetched?.isOperator).toBe(true);
    delete process.env.OPERATOR_EMAILS;
  });

  it("returns undefined for an expired session", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const session = await createSessionRow(db, { email: "expiring@example.com", customerId: null, isOperator: false, now });
    const afterExpiry = new Date(now.getTime() + SESSION_TTL_MS + 1000);
    const fetched = await getSessionRow(db, session.id, afterExpiry);
    expect(fetched).toBeUndefined();
  });

  it("returns undefined for an unknown session id", async () => {
    const fetched = await getSessionRow(db, "00000000-0000-0000-0000-000000000000");
    expect(fetched).toBeUndefined();
  });

  it("deleteSessionRow removes the session so it can no longer be fetched", async () => {
    const session = await createSessionRow(db, { email: "logout@example.com", customerId: null, isOperator: false });
    await deleteSessionRow(db, session.id);
    const fetched = await getSessionRow(db, session.id);
    expect(fetched).toBeUndefined();
  });
});
