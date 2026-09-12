# billing-kit

Production-grade billing for Next.js and Postgres: Stripe and Paystack behind one interface, a double-entry ledger, webhooks that are safe to replay, dunning that does not lose customers, and the customer and admin screens every SaaS ends up building.

**Status:** milestone 0 (design and roadmap). Nothing to install yet.

## Why

Every SaaS rebuilds the same four things badly: a provider integration, a ledger that is really a `balance` column, webhook handlers that double-charge on retry, and a dunning flow made of cron jobs and hope. billing-kit is one opinionated starter that gets those right once, in a stack most product teams already run, and charges in naira through Paystack or in dollars through Stripe from the same codebase.

## What is in the box (at 1.0)

- Customers, products, plans, subscriptions, one-off charges, invoices.
- Provider adapters: Stripe and Paystack (Monnify as a stretch), with hosted checkout for both.
- A double-entry ledger: append-only entries and postings, zero-sum enforced in Postgres, balances derived, fees and settlements as their own postings.
- Webhook ingestion with idempotency keys and replay safety; reconciliation against provider settlements.
- Dunning: retry schedule, grace period, notification hooks, cancellation states.
- Customer portal and admin ledger explorer.
- Vitest and Playwright suites; one-command deploy on Vercel and Neon.

## Stack

Next.js 15 (App Router, TypeScript strict), Postgres with Drizzle ORM, Tailwind CSS v4, Vitest, Playwright. MIT licence.

## Roadmap

The full design is in [`docs/superpowers/specs/2026-09-12-billing-kit-design.md`](docs/superpowers/specs/2026-09-12-billing-kit-design.md). The milestones and their live checklists are in [`PLANS.md`](PLANS.md).

## Author

Abdulsamii Ajala · [abdulsamii.com](https://www.abdulsamii.com) · jalasem@abdulsamii.com
