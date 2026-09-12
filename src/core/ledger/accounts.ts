import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { accounts, type Account } from "@/db/schema";

export interface CreateAccountInput {
  code: string;
  name: string;
  type: Account["type"];
  currency: string;
}

export async function createAccount(db: DbOrTx, input: CreateAccountInput): Promise<Account> {
  const [account] = await db
    .insert(accounts)
    .values({
      code: input.code,
      name: input.name,
      type: input.type,
      currency: input.currency.toUpperCase(),
    })
    .returning();

  return account;
}

export async function getAccountByCode(db: DbOrTx, code: string): Promise<Account | undefined> {
  const [account] = await db.select().from(accounts).where(eq(accounts.code, code));
  return account;
}

export async function requireAccountByCode(db: DbOrTx, code: string): Promise<Account> {
  const account = await getAccountByCode(db, code);
  if (!account) {
    throw new Error(`Unknown account code: ${code}`);
  }
  return account;
}
