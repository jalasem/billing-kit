import "dotenv/config";
import { eq } from "drizzle-orm";
import { createPlan } from "@/core/billing/plans";
import { createProduct } from "@/core/billing/products";
import { createSubscription } from "@/core/billing/subscriptions/create";
import { db } from "@/db/client";
import { customers, plans, products, subscriptions } from "@/db/schema";
import { FakeProvider } from "@/providers/fake";

const PRODUCT_NAME = "Demo Product";
const CUSTOMER_EMAIL = "demo@example.com";

/**
 * Local/demo seed data (`pnpm seed`). Safe to run more than once: every
 * step checks for the row it would create first, so a second run finds
 * everything already in place and creates nothing new. This is distinct
 * from `src/test/seed.ts`, which the e2e suite uses and which truncates
 * tables on every run — this script is meant to be run against a database
 * you're about to look at in a browser.
 */
async function findOrCreateProduct(): Promise<{ id: string }> {
  const [existing] = await db.select().from(products).where(eq(products.name, PRODUCT_NAME));
  if (existing) {
    return existing;
  }
  const created = await createProduct(db, { name: PRODUCT_NAME });
  console.log(`Created product "${PRODUCT_NAME}" (${created.id})`);
  return created;
}

async function findOrCreatePlan(
  provider: FakeProvider,
  productId: string,
  input: { name: string; amount: bigint; currency: string },
): Promise<{ id: string }> {
  const currency = input.currency.toUpperCase();
  const existingPlans = await db.select().from(plans).where(eq(plans.productId, productId));
  const existing = existingPlans.find((plan) => plan.currency === currency);
  if (existing) {
    return existing;
  }
  const created = await createPlan(db, provider, {
    productId,
    name: input.name,
    interval: "month",
    amount: input.amount,
    currency,
  });
  console.log(`Created plan "${input.name}" (${created.id}) — ${input.amount} ${currency}/month`);
  return created;
}

async function findOrCreateCustomer(): Promise<{ id: string }> {
  const [existing] = await db.select().from(customers).where(eq(customers.email, CUSTOMER_EMAIL));
  if (existing) {
    return existing;
  }
  // `defaultAuthorization` is set so `createSubscription` charges immediately
  // through `chargeSavedMethod`, landing the demo subscription `active` with
  // a paid invoice rather than waiting on a provider webhook.
  const [created] = await db
    .insert(customers)
    .values({ email: CUSTOMER_EMAIL, defaultAuthorization: "auth_seed_demo" })
    .returning();
  console.log(`Created customer ${CUSTOMER_EMAIL} (${created.id})`);
  return created;
}

async function ensureActiveSubscription(provider: FakeProvider, customerId: string, planId: string): Promise<void> {
  const existing = await db.select().from(subscriptions).where(eq(subscriptions.customerId, customerId));
  if (existing.length > 0) {
    console.log(`Customer already has ${existing.length} subscription(s); skipping.`);
    return;
  }
  const { subscription, invoice } = await createSubscription(db, provider, {
    customerId,
    planId,
    startTrial: false,
    now: new Date(),
  });
  console.log(`Created subscription ${subscription.id} (status: ${subscription.status})`);
  if (invoice) {
    console.log(`Created invoice ${invoice.id} (status: ${invoice.status})`);
  }
}

async function main(): Promise<void> {
  const provider = new FakeProvider();

  const product = await findOrCreateProduct();
  const usdPlan = await findOrCreatePlan(provider, product.id, { name: "Pro monthly (USD)", amount: 2500n, currency: "USD" });
  await findOrCreatePlan(provider, product.id, { name: "Pro monthly (NGN)", amount: 1000000n, currency: "NGN" });

  const customer = await findOrCreateCustomer();
  await ensureActiveSubscription(provider, customer.id, usdPlan.id);

  const operatorEmails = (process.env.OPERATOR_EMAILS ?? "operator@example.com")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
  const operatorEmail = operatorEmails[0] ?? "operator@example.com";

  console.log("\nSeed complete.");
  console.log(`  Customer login (portal): ${CUSTOMER_EMAIL}`);
  console.log(`  Operator login (admin):  ${operatorEmail}`);
  console.log("  Open /login, enter one of the emails above, and open the printed magic link (console notifier).");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
