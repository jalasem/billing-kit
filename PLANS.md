# billing-kit — milestones

Statuses: `[ ]` not started · `[in-progress]` active · `[x]` done. Keep this file in sync with real progress.

Design: `docs/superpowers/specs/2026-09-12-billing-kit-design.md`.

## M0 — Setup and design (done when: repo public, docs merged, CI runs on push)

- [x] Repository, MIT licence, README, design spec, this roadmap
- [x] Next.js 15 + TypeScript strict + Tailwind v4 scaffold with pnpm, ESLint, Vitest, Playwright
- [x] Docker Compose Postgres for local development; `.env.example`
- [x] GitHub Actions: typecheck, lint, unit tests against a Postgres service container

## M1 — Foundations and the ledger (done when: invariants 1 to 5 pass in CI)

- [x] Drizzle schema and migrations: `accounts`, `entries`, `postings`, `account_balances`, `idempotency_keys`, `audit_log`
- [x] Zero-sum-per-currency constraint trigger on entries; append-only rules (no UPDATE or DELETE on entries and postings)
- [x] `ledger.post(entry)` API: validates, writes postings and balances in one transaction, returns the entry
- [x] Idempotent mutation helper: `withIdempotency(key, fn)` storing the response
- [x] Money helpers: minor-unit `bigint` arithmetic, currency registry (NGN, USD, GBP, EUR to start), formatting
- [x] Vitest suite for invariants 1 to 5 against Postgres
- [x] Article tie-in: link "Ledger design for money you can't get wrong" from the ledger module README

## M2 — Providers and webhooks (done when: a Stripe and a Paystack test payment each land as ledger entries via webhook, and replaying the webhook changes nothing)

- [x] `PaymentProvider` interface and the `fake` provider
- [x] Stripe adapter: customers, checkout sessions, subscriptions, signature verification, event parsing
- [x] Paystack adapter: customers, transaction initialisation, plans and subscriptions, HMAC-SHA512 signature verification, event parsing
- [x] Normalised event vocabulary (`payment.succeeded`, `payment.failed`, `subscription.updated`, `refund.succeeded`, `settlement.posted`)
- [x] `api/webhooks/[provider]` ingestion with `webhook_events` uniqueness and replay tests
- [x] Fees and settlements posted as their own ledger entries
- [x] `reconcile` job: match provider settlements to entries, flag gaps, never duplicate
- [x] Recorded fixtures for both providers; contract tests for the interface

## M3 — Subscriptions, invoices, and dunning (done when: a subscription can be created, renewed, fail payment, recover, and cancel with the ledger and invoices correct at every step)

- [x] Products and plans (recurring intervals, trial days, currency per plan)
- [x] Subscription state machine: `trialing`, `active`, `past_due`, `unpaid`, `cancelled`, `paused`; allowed transitions in code and tests
- [x] Invoices and invoice lines; invoice numbering; open → paid → void transitions
- [x] Plan change with a documented proration policy (credit note as a ledger entry)
- [x] Dunning schedule (day 0, 3, 5, 7), grace period, retries through the provider, notification hooks
- [x] `Notifier` interface with console and Resend implementations and three templates
- [x] `dunning` cron job, idempotent, protected by a secret
- [x] Invariant 6 tests plus end-to-end lifecycle tests with the `fake` provider

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
