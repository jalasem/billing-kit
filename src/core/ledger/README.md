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
| `receivable:{CUR}` | asset | Amounts owed to us that have not yet been collected (reserved for invoicing in M3). |

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
