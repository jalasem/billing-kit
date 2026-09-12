# billing-kit — milestones

Statuses: `[ ]` not started · `[in-progress]` active · `[x]` done. Keep this file in sync with real progress.

Design: `docs/superpowers/specs/2026-09-12-billing-kit-design.md`.

## M0 — Setup and design (done when: repo public, docs merged, CI runs on push)

- [x] Repository, MIT licence, README, design spec, this roadmap
- [ ] Next.js 15 + TypeScript strict + Tailwind v4 scaffold with pnpm, ESLint, Vitest, Playwright
- [ ] Docker Compose Postgres for local development; `.env.example`
- [ ] GitHub Actions: typecheck, lint, unit tests against a Postgres service container

## M1 — Foundations and the ledger (done when: invariants 1 to 5 pass in CI)

- [ ] Drizzle schema and migrations: `accounts`, `entries`, `postings`, `account_balances`, `idempotency_keys`, `audit_log`
- [ ] Zero-sum-per-currency constraint trigger on entries; append-only rules (no UPDATE or DELETE on entries and postings)
- [ ] `ledger.post(entry)` API: validates, writes postings and balances in one transaction, returns the entry
- [ ] Idempotent mutation helper: `withIdempotency(key, fn)` storing the response
- [ ] Money helpers: minor-unit `bigint` arithmetic, currency registry (NGN, USD, GBP, EUR to start), formatting
- [ ] Vitest suite for invariants 1 to 5 against Postgres
- [ ] Article tie-in: link "Ledger design for money you can't get wrong" from the ledger module README

## M2 — Providers and webhooks (done when: a Stripe and a Paystack test payment each land as ledger entries via webhook, and replaying the webhook changes nothing)

- [ ] `PaymentProvider` interface and the `fake` provider
- [ ] Stripe adapter: customers, checkout sessions, subscriptions, signature verification, event parsing
- [ ] Paystack adapter: customers, transaction initialisation, plans and subscriptions, HMAC-SHA512 signature verification, event parsing
- [ ] Normalised event vocabulary (`payment.succeeded`, `payment.failed`, `subscription.updated`, `refund.succeeded`, `settlement.posted`)
- [ ] `api/webhooks/[provider]` ingestion with `webhook_events` uniqueness and replay tests
- [ ] Fees and settlements posted as their own ledger entries
- [ ] `reconcile` job: match provider settlements to entries, flag gaps, never duplicate
- [ ] Recorded fixtures for both providers; contract tests for the interface

## M3 — Subscriptions, invoices, and dunning (done when: a subscription can be created, renewed, fail payment, recover, and cancel with the ledger and invoices correct at every step)

- [ ] Products and plans (recurring intervals, trial days, currency per plan)
- [ ] Subscription state machine: `trialing`, `active`, `past_due`, `unpaid`, `cancelled`, `paused`; allowed transitions in code and tests
- [ ] Invoices and invoice lines; invoice numbering; open → paid → void transitions
- [ ] Plan change with a documented proration policy (credit note as a ledger entry)
- [ ] Dunning schedule (day 0, 3, 5, 7), grace period, retries through the provider, notification hooks
- [ ] `Notifier` interface with console and Resend implementations and three templates
- [ ] `dunning` cron job, idempotent, protected by a secret
- [ ] Invariant 6 tests plus end-to-end lifecycle tests with the `fake` provider

## M4 — Portal and admin (done when: a customer can manage their plan and an operator can trace any kobo from a screen)

- [ ] Auth boundary: session-based customer auth (email magic link) and an operator role
- [ ] Portal: current plan, invoices with status, update payment method (provider-hosted), cancel and resume
- [ ] Admin: customers, subscriptions, invoices; ledger explorer (accounts → entries → postings, balances); webhook log with replay button; reconciliation status
- [ ] Playwright smoke suite for portal and admin
- [ ] Accessibility pass (keyboard, labels, contrast) on both surfaces

## M5 — Release 1.0 (done when: a stranger can deploy it in under an hour from the README)

- [ ] `.env.example`, deploy guide for Vercel and Neon, cron configuration, provider webhook setup guides
- [ ] `pnpm seed` demo data; screenshots and a short GIF in the README
- [ ] Contribution guide, issue templates, semantic versioning, changelog
- [ ] Security notes: webhook secrets, cron secret rotation, PII handling
- [ ] Launch: publish the ledger article, post the repo, add billing-kit to abdulsamii.com as a case study
