import { sql } from "drizzle-orm";
import { describe, expect, test } from "vitest";

describe("db client", () => {
  test.skipIf(!process.env.DATABASE_URL)("runs SELECT 1", async () => {
    const { db } = await import("./client");
    const result = await db.execute(sql`SELECT 1`);
    expect(result).toBeDefined();
  });
});
