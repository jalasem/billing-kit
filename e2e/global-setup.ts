import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { seed } from "@/test/seed";

config({ path: ".env.test" });

/**
 * Runs once before the whole Playwright run: migrates the test database to
 * the current schema and seeds the fixture data the specs log in against
 * (see `src/test/seed.ts`). Uses its own short-lived connection rather than
 * the app's `@/db/client` singleton, since this file runs in the Playwright
 * runner's process, not the `next start` process the tests exercise.
 */
export default async function globalSetup(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set; is .env.test loaded?");
  }

  const client = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    await seed(db);
  } finally {
    await client.end();
  }
}
