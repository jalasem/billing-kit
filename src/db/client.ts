import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const client = postgres(connectionString);

export const db = drizzle(client, { schema });

/** Either the top-level database handle or a transaction created from it. */
export type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
