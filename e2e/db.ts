import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

const connectionString = process.env.DATABASE_URL ?? "postgres://billing:billing@localhost:5433/billing_kit";
const client = postgres(connectionString);

/** A long-lived connection the spec files use to read fixtures directly — the magic-link token, webhook rows, ledger entries — since there is no mailbox to read from. */
export const db = drizzle(client, { schema });
