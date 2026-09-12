# billing-kit — design

Date: 2026-09-12. Status: approved in chat (scope agreed with the author); milestones in PLANS.md.

## Goal

An open-source, MIT-licensed billing starter for Next.js and Postgres that a SaaS team can deploy in an afternoon and trust with money: Stripe and Paystack behind one interface, a double-entry ledger, replay-safe webhooks, dunning, and the customer and admin surfaces that every product needs. It doubles as the reference implementation for the author's articles on ledger design, edge experiments, and event tracking.

## Non-goals (1.0)

- Tax or VAT calculation, invoicing PDFs, and accounting exports (CSV export only).
- Marketplace splits, connected accounts, or payouts to third parties.
- Storing card data (providers hold instruments; billing-kit stores provider references only).
- Monnify and Flutterwave adapters (stretch after 1.0; the provider interface must make them straightforward).
- Multi-tenancy beyond one `organisation` per deployment.

## Architecture

- **App**: Next.js 15 App Router, TypeScript strict, Tailwind CSS v4. Route groups: `(portal)` for customers, `(admin)` for operators, `api/webhooks/[provider]` for ingestion, `api/cron/*` for jobs (Vercel Cron).
- **Data**: Postgres (Neon in production, Docker locally) through Drizzle ORM and drizzle-kit migrations. Money is stored as `bigint` minor units with an ISO currency code; never floats.
- **Core** (`src/core`):
  - `ledger`: `accounts`, `entries`, `postings`. Append-only. Every posting belongs to an entry; an entry's postings sum to zero per currency, enforced by a deferred constraint trigger. Balances are `SUM(postings.amount)` per account, cached in `account_balances` maintained in the same transaction.
  - `billing`: `customers`, `products`, `plans`, `subscriptions`, `invoices`, `invoice_lines`, `payments`, `refunds`. Subscription and invoice lifecycles are explicit state machines with allowed transitions in code and tests.
  - `idempotency`: `idempotency_keys` for API mutations and `webhook_events (provider, event_id)` unique for ingestion; handlers are pure functions of (event, state) so replays are no-ops.
  - `dunning`: schedule (day 0, 3, 5, 7), grace period, `past_due` → `unpaid` → `cancelled` transitions, notification hooks.
- **Providers** (`src/providers`): a `PaymentProvider` interface (`createCustomer`, `createCheckoutSession`, `createSubscription`, `cancelSubscription`, `retryPayment`, `verifyWebhookSignature`, `parseEvent`, `listSettlements`) with `stripe` and `paystack` implementations and a `fake` provider for tests. Provider events are normalised into a small internal event vocabulary before touching the ledger.
- **Notifications**: a `Notifier` interface with `console` and `resend` implementations; templates for payment failed, retry scheduled, subscription cancelled.
- **Jobs**: `dunning` (hourly) and `reconcile` (daily) as idempotent cron routes protected by a secret.
- **UI**: portal (plan, invoices, payment method, cancel), admin (customers, subscriptions, ledger explorer with entries and postings, reconciliation status, webhook log).
- **Observability**: structured logs; every money mutation writes an audit row with actor and reason.

## Invariants (tested)

1. Postings of one entry sum to zero per currency; an entry cannot be committed otherwise.
2. Entries and postings are never updated or deleted; corrections are new entries.
3. The same webhook event id applied twice produces identical state.
4. An API mutation with the same idempotency key returns the stored response without side effects.
5. Account balance equals the sum of its postings at all times.
6. A subscription can only move along the documented state graph.
7. A reconciliation run never creates duplicate settlement entries.

## Testing

Vitest for core (ledger, state machines, idempotency, dunning schedule) against a real Postgres (Docker locally, service container in CI); provider adapters tested against recorded fixtures plus the `fake` provider; Playwright smoke for portal and admin; CI on GitHub Actions on every push.

## Deployment

Vercel (app and cron) plus Neon (Postgres). `.env.example` documents every variable. `pnpm db:migrate` runs migrations; `pnpm seed` creates demo products and a customer.

## Milestones

Detailed checklists in PLANS.md. M0 setup (this document), M1 foundations and ledger, M2 providers and webhooks, M3 subscriptions, invoices, and dunning, M4 portal and admin, M5 release.
