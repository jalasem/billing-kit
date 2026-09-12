import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Refuses to run against anything but a local database. `db:reset` drops
 * the whole `public` schema — the only thing standing between a stray
 * `pnpm db:reset` and a wiped Neon production database is this check.
 */
function assertLocalDatabase(connectionString: string): void {
  const hostname = new URL(connectionString).hostname;
  if (!LOCAL_HOSTNAMES.has(hostname)) {
    console.error(
      `db:reset refuses to run against host "${hostname}". It only runs against localhost/127.0.0.1/::1, ` +
        "so it can never accidentally drop a deployed database. Point DATABASE_URL at your local Docker " +
        "Postgres (see docker-compose.yml) to run this.",
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  assertLocalDatabase(connectionString);

  const client = postgres(connectionString, { max: 1 });
  try {
    console.log("Dropping and recreating the public schema...");
    await client.unsafe("DROP SCHEMA public CASCADE");
    await client.unsafe("CREATE SCHEMA public");
    // drizzle-kit's own migration bookkeeping (`drizzle.__drizzle_migrations`)
    // lives outside `public`, so it survives the drop above and would tell
    // the migrator every migration is already applied, leaving `public`
    // empty. Drop it too so `migrate()` below recreates it and reapplies
    // every migration from scratch.
    await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");

    console.log("Running migrations...");
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "drizzle" });

    console.log("Done. Run `pnpm seed` to add demo data.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
