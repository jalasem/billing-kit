# Ledger

Double-entry bookkeeping on Postgres. An **entry** is one business event (a
charge, a fee, a reversal). A **posting** is one line of that event: an
amount against one account. Every posting belongs to exactly one entry.
Entries and postings are append-only — corrections are new, reversing
entries, never edits. Postgres enforces, via triggers, that every entry's
postings sum to zero per currency and that a posting's currency matches its
account's currency; the database also rejects any `UPDATE` or `DELETE` on
`entries` or `postings`. `account_balances` is a transactionally-maintained
cache of `SUM(postings.amount)`; `recomputeBalance` proves it never drifts.

## Sign convention

Amounts are signed `bigint` minor units (kobo, cents): **debit is positive,
credit is negative**. A payment received into a cash (asset) account is a
positive posting on `cash` and a negative posting of the same size on
whatever account it came from (e.g. revenue or receivable).

## Example: a Paystack payment with its fee

A ₦10,000 charge that Paystack takes a ₦150 fee from before settling:

```ts
import { postEntry } from "@/core/ledger";

await postEntry(db, {
  occurredAt: new Date(),
  description: "Paystack charge ref_abc123",
  idempotencyKey: "ref_abc123", // the provider's own reference
  postings: [
    { accountCode: "cash", amount: 985000n, currency: "NGN" }, // 9,850.00 settled
    { accountCode: "payment_fees", amount: 15000n, currency: "NGN" }, // 150.00 fee, its own posting
    { accountCode: "revenue", amount: -1000000n, currency: "NGN" }, // 10,000.00 earned
  ],
});
```

The three postings sum to zero (`985000 + 15000 - 1000000 = 0`); the fee is
never silently netted out of the revenue figure.

## Chart of accounts (providers and webhooks)

`ensureChartOfAccounts(db, currency)` creates the following accounts for a
currency, idempotently (an existing account is left untouched), one set of
provider-scoped accounts per supported `ProviderId` (`stripe`, `paystack`,
`fake`):

| Code | Type | Purpose |
| --- | --- | --- |
| `cash:{provider}:{CUR}` | asset | Provider clearing: money a provider is holding for us before it settles to the bank. |
| `fees:{provider}:{CUR}` | expense | Fees a provider took, whether per-transaction or on settlement. |
| `bank:{CUR}` | asset | Our actual bank account, debited when a settlement lands. |
| `revenue:{CUR}` | revenue | Earned revenue. |
| `refunds:{CUR}` | expense | Contra-revenue: money returned to customers, kept as its own account rather than reversing `revenue`. |
| `receivable:{CUR}` | asset | Amounts owed to us that have not yet been collected (invoicing, from M3). |
| `unapplied:{provider}:{CUR}` | liability | Money received against an invoice-linked payment whose amount/currency didn't match the invoice (from the M3 fix round) — held pending manual resolution, not revenue. |

### Webhook ingestion postings

- `payment.succeeded`: debit `cash:{provider}:{CUR}` for the gross amount,
  credit `revenue:{CUR}`. If the event carries a fee, a second pair of
  postings debits `fees:{provider}:{CUR}` and credits
  `cash:{provider}:{CUR}` for the fee, so the provider's clearing account
  nets to gross minus fee — what actually settles.
- `refund.succeeded`: debit `refunds:{CUR}`, credit `cash:{provider}:{CUR}`.
- `settlement.posted` / reconciliation: debit `bank:{CUR}` for the net
  amount that hit the bank, debit `fees:{provider}:{CUR}` for a settlement
  fee that was not already posted per-transaction, credit
  `cash:{provider}:{CUR}` for the gross. Whether the settlement fee was
  already posted per-payment is provider-specific — see
  `src/jobs/reconcile.ts` for the documented rule per provider.

Every posting above goes through `postEntry` with an idempotency key derived
from the provider event id or settlement id, so replaying the same webhook
or reconciliation run is a no-op.

## Invoicing postings (M3)

- **Issuing an invoice** (`draft → open`), entry key `invoice:{id}:issued`:
  debit `receivable:{CUR}` for the invoice total, credit `revenue:{CUR}`.
  Credit and proration lines on the invoice are negative amounts, so they
  reduce the total the entry posts — the entry itself always has exactly
  these two postings; it is the *total* that already nets out any credits,
  not a third posting. An invoice whose total is exactly zero (fully
  covered by applied `customer_credits`) skips this entry entirely and is
  created already `paid` — there is no cash or revenue movement to record.
- **Paying an invoice**, entry key `invoice:{id}:paid`: debit
  `cash:{provider}:{CUR}` for the invoice total, credit `receivable:{CUR}`.
  A reported fee is posted the same way M2 posts a payment fee (debit
  `fees:{provider}:{CUR}`, credit `cash:{provider}:{CUR}`).
- **Voiding an open invoice**, entry key `invoice:{id}:void`: the exact
  reverse of the issued entry (credit `receivable:{CUR}`, debit
  `revenue:{CUR}`, both for the invoice total). An **uncollectible**
  write-off (dunning exhausted past the cancel-after threshold) uses this
  same reversal — an uncollectible invoice is voided against revenue, not
  left as a permanent receivable.
- **M2/M3 resolution — `payment.succeeded` and `payment.failed` against an
  invoice**: if the event's `provider_ref` matches an invoice's own
  `provider_ref` (set the moment billing-kit initiates a charge for that
  invoice, win or lose — see `attemptInvoicePayment` — or resolved from a
  `providerSubscriptionId` + period match for a provider-mode subscription,
  see `linkInvoiceBySubscription`), it is an invoice payment:
  `payment.succeeded` posts the "paid" entry above (against `receivable`,
  not `revenue` — revenue was already recognised when the invoice was
  issued) and marks the invoice paid; `payment.failed` starts dunning
  instead of posting anything (a failed payment never moved money). An
  event matching no invoice falls through to the plain one-off
  `cash`/`revenue` posting from M2, unchanged.
- **Amount/currency mismatch on an invoice-linked payment** (M3 fix round):
  `markInvoicePaid` never assumes the provider's reported amount/currency
  equals the invoice's own total/currency. When they don't match, the
  invoice is **not** marked paid — it stays `open` — and instead: (1) a
  `reconciliation_flags` row of kind `invoice_amount_mismatch` is raised,
  recording both the expected (invoice) and actual (event) amount and
  currency, and (2) the money is still posted, as a one-off receipt against
  `unapplied:{provider}:{CUR}` (debit `cash:{provider}:{CUR}`, credit
  `unapplied:{provider}:{CUR}`) so it is never lost from the ledger even
  though it wasn't applied to anything. An operator resolves the flag by
  investigating and posting a correcting entry by hand (out of scope for
  M3 — no automated resolution flow exists yet). Idempotent per
  `(provider, provider_ref)`, so a redelivered mismatched event doesn't
  double-post the receipt or raise a second flag.
- **Paying an invoice that isn't `open`**: `markInvoicePaid` enforces state
  at the source of truth. An invoice already `paid` is a no-op replay
  (returns unchanged, posts nothing). Any other non-`open` status
  (`draft`, `void`, `uncollectible`) throws `InvalidInvoiceStateError`
  rather than silently posting a paid entry against, say, a written-off
  invoice.
- **Proration** (plan change mid-period): daily, calendar-day policy —
  **`period_start` is inclusive, `period_end` is exclusive**. Both the old
  and new plan's full-period amount is amortised over the same
  `totalDays` (the current period's length): `amount / totalDays`,
  floored to the minor unit, with the integer remainder added to the
  period's *last* day, so a plan's per-day amounts always sum back to
  exactly its full amount. The credit for the old plan's unused days and
  the charge for the new plan's remaining days are computed from that same
  daily split; their difference (`delta`) becomes an `open` invoice
  (`credit` line for the old plan, `proration` line for the new one) when
  positive, or is banked as `customer_credits` on the customer when
  negative, applied automatically the next time an invoice is issued. See
  `src/core/billing/subscriptions/proration.ts` for the implementation and
  its test for the worked example.

## Operational note: the app's database role

Every invariant above (zero-sum, currency match, append-only, minimum two
postings) is enforced by triggers, not by application code. That guarantee
only holds if the Postgres role the app connects as cannot route around
them: it must **not** have `TRUNCATE` on `entries` or `postings` (`TRUNCATE`
does not fire row-level `DELETE` triggers, so it would silently erase ledger
history) and must not have privileges to disable or drop the triggers
themselves (`ALTER TABLE ... DISABLE TRIGGER`, or superuser). Grant a
narrower role `SELECT, INSERT` on `entries`/`postings` in production; reserve
`TRUNCATE` and trigger management for migrations, run under a separate,
more trusted role.

Further reading: ["Ledger design for money you can't get wrong"](https://www.abdulsamii.com/#writing).
