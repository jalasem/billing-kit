# Changelog

All notable changes to this project are documented in this file. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-09-12

Initial public release. billing-kit is a Next.js + Postgres billing
starter: Stripe and Paystack behind one provider interface, a double-entry
ledger, replay-safe webhooks, reconciliation, subscriptions with proration
and dunning, and a customer portal plus operator admin.

### Added

- **Ledger** (`src/core/ledger`): append-only `accounts`/`entries`/`postings`,
  a Postgres trigger enforcing every entry's postings sum to zero per
  currency, `account_balances` maintained transactionally,
  `withIdempotency`/idempotency keys, `bigint` minor-unit money helpers, and
  a currency registry (NGN, USD, GBP, EUR).
- **Providers** (`src/providers`): a `PaymentProvider` interface with
  `fake`, `stripe`, and `paystack` implementations — customers, checkout
  sessions, plans, subscriptions, signature verification, event parsing,
  and settlement listing, normalised into a shared event vocabulary.
- **Webhooks** (`src/core/webhooks`, `api/webhooks/[provider]`): retry-safe
  ingestion with `webhook_events` uniqueness, per-event handler
  transactions with savepoint rollback on failure, and a `retry-webhooks`
  cron job for events that failed transiently.
- **Reconciliation** (`src/jobs/reconcile.ts`): matches provider
  settlements to ledger entries, flags gaps (`reconciliation_flags`),
  never double-posts.
- **Subscriptions and invoices** (`src/core/billing`): products, plans,
  a subscription state machine (`trialing`/`active`/`past_due`/`unpaid`/
  `cancelled`/`paused`), invoices with numbering and draft → open → paid/void
  transitions, daily calendar-day plan-change proration with credit notes.
- **Dunning** (`src/core/billing/dunning`): a day 0/3/5/7 retry schedule,
  grace period, `past_due` → `unpaid` → `cancelled` progression, and a
  `Notifier` interface with `console` and `resend` implementations across
  four templates.
- **Auth, portal, and admin** (`src/core/auth`, `src/app/(portal)`,
  `src/app/(admin)`): magic-link customer/operator auth (hashed,
  single-use, rate-limited), a customer portal (plan, invoices, cancel/
  resume/pause), and an operator admin (customers, subscriptions,
  invoices, a ledger explorer down to individual postings, webhook replay,
  reconciliation).
- **Tests**: a Vitest suite (255 tests) against a real Postgres instance
  covering the ledger invariants, provider contract, webhook replay
  safety, subscription/invoice lifecycle, dunning, and auth/authorization;
  a Playwright suite covering portal and admin flows, keyboard navigation,
  and WCAG contrast.
- **Release furniture**: `pnpm seed` demo data, `pnpm db:reset` (localhost
  guard), `vercel.json` cron configuration, deploy and provider setup
  documentation, `CONTRIBUTING.md`, `SECURITY.md`, issue/PR templates.
