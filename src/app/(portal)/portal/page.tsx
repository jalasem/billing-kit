import { desc, eq } from "drizzle-orm";
import { Badge, Button, Card, DateTime, Money, SubscriptionStatusBadge } from "@/components/ui";
import { requireCustomerSession } from "@/core/auth";
import { db } from "@/db/client";
import { plans, subscriptions, type Plan, type Subscription } from "@/db/schema";
import { cancelAtPeriodEndAction, pauseAction, resumeAction, resumeCancelAtPeriodEndAction, subscribeAction } from "./actions";

async function currentSubscription(customerId: string): Promise<{ subscription: Subscription; plan: Plan } | undefined> {
  const rows = await db
    .select({ subscription: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.customerId, customerId))
    .orderBy(desc(subscriptions.createdAt));

  return rows.find((row) => row.subscription.status !== "cancelled") ?? rows[0];
}

export default async function PortalPage({ searchParams }: { searchParams: Promise<{ error?: string; updated?: string }> }) {
  const session = await requireCustomerSession();
  const params = await searchParams;
  const current = await currentSubscription(session.customerId);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Your plan</h1>

      {params.error === "invalid_transition" && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          That change isn&apos;t available for your subscription right now.
        </p>
      )}
      {params.error === "plan_inactive" && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          That plan is no longer available. Please choose a different plan.
        </p>
      )}
      {params.updated === "1" && (
        <p className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800" role="status">
          Your subscription was updated.
        </p>
      )}

      {!current ? (
        <EmptyPlanState />
      ) : (
        <SubscriptionCard subscription={current.subscription} plan={current.plan} />
      )}
    </div>
  );
}

function SubscriptionCard({ subscription, plan }: { subscription: Subscription; plan: Plan }) {
  const cancellable = subscription.status === "active" || subscription.status === "trialing" || subscription.status === "past_due";

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{plan.name}</h2>
          <p className="text-sm text-slate-600">
            <Money amount={plan.amount} currency={plan.currency} /> / {plan.interval}
          </p>
        </div>
        <SubscriptionStatusBadge status={subscription.status} />
      </div>

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Current period ends</dt>
          <dd className="text-slate-900">
            <DateTime date={subscription.currentPeriodEnd} />
          </dd>
        </div>
        {subscription.trialEnd && (
          <div>
            <dt className="text-slate-500">Trial ends</dt>
            <dd className="text-slate-900">
              <DateTime date={subscription.trialEnd} />
            </dd>
          </div>
        )}
        <div>
          <dt className="text-slate-500">Next invoice estimate</dt>
          <dd className="text-slate-900">
            <Money amount={plan.amount} currency={plan.currency} /> on <DateTime date={subscription.currentPeriodEnd} />
          </dd>
        </div>
      </dl>

      {subscription.cancelAtPeriodEnd && (
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Badge tone="warning">Cancelling</Badge> Your plan will end on <DateTime date={subscription.currentPeriodEnd} /> and will not
          renew.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {subscription.cancelAtPeriodEnd ? (
          <form action={resumeCancelAtPeriodEndAction}>
            <input type="hidden" name="subscriptionId" value={subscription.id} />
            <Button type="submit" variant="secondary">
              Keep my subscription
            </Button>
          </form>
        ) : (
          cancellable && (
            <form action={cancelAtPeriodEndAction}>
              <input type="hidden" name="subscriptionId" value={subscription.id} />
              <Button type="submit" variant="secondary">
                Cancel at period end
              </Button>
            </form>
          )
        )}

        {subscription.status === "active" && (
          <form action={pauseAction}>
            <input type="hidden" name="subscriptionId" value={subscription.id} />
            <Button type="submit" variant="secondary">
              Pause subscription
            </Button>
          </form>
        )}

        {subscription.status === "paused" && (
          <form action={resumeAction}>
            <input type="hidden" name="subscriptionId" value={subscription.id} />
            <Button type="submit">Resume subscription</Button>
          </form>
        )}
      </div>
    </Card>
  );
}

async function EmptyPlanState() {
  const activePlans = await db.select().from(plans).where(eq(plans.active, true));

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Choose a plan</h2>
        <p className="text-sm text-slate-600">You don&apos;t have an active subscription yet.</p>
      </div>
      <ul className="flex flex-col gap-3">
        {activePlans.map((plan) => (
          <li key={plan.id} className="flex items-center justify-between rounded-md border border-slate-200 px-4 py-3">
            <div>
              <p className="font-medium text-slate-900">{plan.name}</p>
              <p className="text-sm text-slate-600">
                <Money amount={plan.amount} currency={plan.currency} /> / {plan.interval}
                {plan.trialDays > 0 ? ` · ${plan.trialDays}-day trial` : ""}
              </p>
            </div>
            <form action={subscribeAction}>
              <input type="hidden" name="planId" value={plan.id} />
              <Button type="submit">Subscribe</Button>
            </form>
          </li>
        ))}
      </ul>
    </Card>
  );
}
