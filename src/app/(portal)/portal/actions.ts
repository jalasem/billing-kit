"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { InvalidTransitionError } from "@/core/billing/subscriptions/state";
import { cancel, resume, resumeCancelAtPeriodEnd, pause } from "@/core/billing/subscriptions/lifecycle";
import { createSubscription } from "@/core/billing/subscriptions/create";
import { requireCustomerSession, UnauthorizedError, type CurrentSession } from "@/core/auth";
import { db } from "@/db/client";
import { subscriptions, type Subscription } from "@/db/schema";
import { createProvider, defaultProviderForNewSubscriptions } from "@/providers/registry";

/** Loads a subscription and throws `UnauthorizedError` unless it belongs to the current customer session. */
async function ownedSubscription(subscriptionId: string): Promise<{ subscription: Subscription; session: CurrentSession & { customerId: string } }> {
  const session = await requireCustomerSession();
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId));
  if (!subscription || subscription.customerId !== session.customerId) {
    throw new UnauthorizedError("This subscription does not belong to the current customer");
  }
  return { subscription, session };
}

function redirectWithOutcome(error: unknown): never {
  if (error instanceof UnauthorizedError) {
    redirect("/portal?error=unauthorized");
  }
  if (error instanceof InvalidTransitionError) {
    redirect("/portal?error=invalid_transition");
  }
  throw error;
}

export async function cancelAtPeriodEndAction(formData: FormData): Promise<void> {
  const subscriptionId = String(formData.get("subscriptionId") ?? "");
  try {
    const { subscription, session } = await ownedSubscription(subscriptionId);
    const provider = createProvider(subscription.provider);
    await cancel(db, provider, subscriptionId, { atPeriodEnd: true }, session.email);
  } catch (error) {
    redirectWithOutcome(error);
  }
  redirect("/portal?updated=1");
}

export async function resumeCancelAtPeriodEndAction(formData: FormData): Promise<void> {
  const subscriptionId = String(formData.get("subscriptionId") ?? "");
  try {
    const { session } = await ownedSubscription(subscriptionId);
    await resumeCancelAtPeriodEnd(db, subscriptionId, session.email);
  } catch (error) {
    redirectWithOutcome(error);
  }
  redirect("/portal?updated=1");
}

export async function pauseAction(formData: FormData): Promise<void> {
  const subscriptionId = String(formData.get("subscriptionId") ?? "");
  try {
    const { session } = await ownedSubscription(subscriptionId);
    await pause(db, subscriptionId, session.email);
  } catch (error) {
    redirectWithOutcome(error);
  }
  redirect("/portal?updated=1");
}

export async function resumeAction(formData: FormData): Promise<void> {
  const subscriptionId = String(formData.get("subscriptionId") ?? "");
  try {
    const { session } = await ownedSubscription(subscriptionId);
    await resume(db, subscriptionId, session.email);
  } catch (error) {
    redirectWithOutcome(error);
  }
  redirect("/portal?updated=1");
}

/**
 * Starts a subscription to `planId` for the current customer, through the
 * real `createSubscription` service — see
 * `defaultProviderForNewSubscriptions` for which provider bills it.
 */
export async function subscribeAction(formData: FormData): Promise<void> {
  const planId = String(formData.get("planId") ?? "");
  const session = await requireCustomerSession();

  const provider = defaultProviderForNewSubscriptions();
  await createSubscription(db, provider, { customerId: session.customerId, planId });

  redirect("/portal?updated=1");
}
