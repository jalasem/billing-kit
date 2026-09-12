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
