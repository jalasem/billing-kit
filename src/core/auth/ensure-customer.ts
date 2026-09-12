import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { customers, type Customer } from "@/db/schema";

/**
 * Finds the customer for `email`, creating one if none exists — "portal
 * sign-up is implicit": requesting a magic link is enough to become a
 * customer. `onConflictDoNothing` plus a re-select handles the race where
 * two requests for the same brand-new email land at once.
 */
export async function ensureCustomerByEmail(db: DbOrTx, email: string): Promise<Customer> {
  const normalized = email.trim().toLowerCase();

  const [existing] = await db.select().from(customers).where(eq(customers.email, normalized));
  if (existing) {
    return existing;
  }

  const [inserted] = await db
    .insert(customers)
    .values({ email: normalized })
    .onConflictDoNothing({ target: customers.email })
    .returning();
  if (inserted) {
    return inserted;
  }

  const [raced] = await db.select().from(customers).where(eq(customers.email, normalized));
  if (!raced) {
    throw new Error(`Failed to create or find customer: ${normalized}`);
  }
  return raced;
}
