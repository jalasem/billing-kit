# Contributing to billing-kit

## Setup

```bash
source ~/.nvm/nvm.sh && nvm use   # Node 22+, see .nvmrc
pnpm install
docker compose up -d              # Postgres on localhost:5433
cp .env.example .env
pnpm db:migrate
pnpm seed                         # optional: demo data for the portal/admin UI
pnpm dev
```

Run the checks CI runs before opening a PR:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm test:e2e   # optional locally; runs in CI
```

`pnpm test` and `pnpm test:e2e` both need the Docker Postgres above running.

## Branch naming

`<type>/<short-description>`, e.g. `fix/paystack-settlement-currency`,
`feat/monnify-adapter`. `type` is one of `feat`, `fix`, `refactor`, `docs`,
`test`, `chore`.

## Tests are required

Every change to `src/core`, `src/providers`, `src/jobs`, or `src/app/api`
needs a Vitest test covering it (see the existing `*.test.ts` next to the
file it tests). UI changes under `src/app/(portal)` or `src/app/(admin)`
should get a Playwright spec under `e2e/` when they change a user-facing
flow, not just styling. A PR that only adds behaviour without a test
covering it will be asked to add one.

## Commit style

Short, imperative subject line (`Fix Paystack settlement currency
fallback`, not `Fixed` or `Fixes`). Reference the milestone or issue in the
body when useful. No fixed prefix is required outside milestone work done
by the project's own agents (`M<N>: ...`).

## Adding a provider adapter

billing-kit's provider surface is one interface
(`src/providers/types.ts#PaymentProvider`) with three implementations today
(`fake`, `stripe`, `paystack`) behind `createProvider` in
`src/providers/registry.ts`. To add a new one (e.g. Monnify, Flutterwave):

1. **Read an existing adapter first.** `src/providers/paystack/adapter.ts`
   is the shortest real-money example (a typed `fetch` client, no SDK);
   `src/providers/stripe/adapter.ts` shows the "wrap an official SDK"
   shape.
2. **Implement `PaymentProvider`** in `src/providers/<name>/adapter.ts`:
   `createCustomer`, `createCheckoutSession`, `createPlan`,
   `createSubscription`, `cancelSubscription`, `chargeSavedMethod`,
   `verifyWebhookSignature`, `parseEvents`, `listSettlements`. Verify
   signatures with `node:crypto`'s `timingSafeEqual` (see
   `src/providers/paystack/adapter.ts`), never a plain `===`.
3. **Write a mapping module** (`src/providers/<name>/mapping.ts`) that
   turns the provider's raw webhook payloads into `NormalisedEvent`
   (`src/providers/types.ts`) — the five-event vocabulary
   (`payment.succeeded`, `payment.failed`, `refund.succeeded`,
   `subscription.updated`, `settlement.posted`) every other module (ledger,
   dunning, reconciliation) is written against. Validate every field you
   read with `zod` (see `src/providers/paystack/mapping.ts`) and never let a
   malformed payload throw past the mapper — wrap the whole function so any
   failure becomes a `ProviderPayloadError` (`src/providers/errors.ts`).
4. **Add fixtures.** Drop 3-5 real (test-mode, redacted) webhook payloads
   in `src/providers/<name>/fixtures/*.json` covering at least a
   successful payment, a failed payment, and a refund.
5. **Add it to `ProviderId`** (`src/providers/types.ts`), `PROVIDERS` in
   `src/core/ledger/chart-of-accounts.ts` (so it gets its own clearing/fee
   accounts), and `createProvider`/`isProviderConfigured` in
   `src/providers/registry.ts`.
6. **Write `src/providers/<name>/<name>.test.ts`** covering signature
   verification (valid, tampered, missing header) and event parsing for
   each fixture. `src/providers/contract.test.ts` is table-driven across
   every registered provider — your adapter needs no changes there, but
   run it to confirm you satisfy the same contract `stripe`/`paystack` do.
7. **Document guessed payload shapes.** If any field's shape isn't
   confirmed against a real webhook delivery, say so in the PR description
   and in a code comment — see the "Known unverified assumptions" section
   of the README for the standard billing-kit already carries this to.

## Reporting a security issue

See [`SECURITY.md`](SECURITY.md) — please do not open a public issue for a
vulnerability.
