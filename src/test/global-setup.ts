import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Runs once before the whole Vitest run (locally and in CI) so the test
 * database has the same schema and triggers as production, applied through
 * the same migration files `pnpm db:migrate` uses.
 */
export default async function setup(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set; is .env.test loaded?");
  }

  const migrationClient = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(migrationClient), { migrationsFolder: "drizzle" });
  } finally {
    await migrationClient.end();
  }
}
