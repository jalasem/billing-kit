# Security policy

billing-kit moves money and stores customer emails and provider
references. If you find a vulnerability, please report it privately —
not as a public GitHub issue.

## Reporting a vulnerability

Email **jalasem@abdulsamii.com** with:

- A description of the issue and its potential impact.
- Steps to reproduce (a minimal repro against the `fake` provider is
  ideal, since it needs no real credentials).
- The affected version or commit.

You will get an acknowledgement within **5 business days**. We aim to
confirm the issue, agree a fix timeline, and keep you updated at least
every two weeks until resolved.

## Disclosure window

Please give us **90 days** from your report before any public disclosure,
so a fix can be released and users can update. We will credit you in the
release notes (unless you prefer to stay anonymous) once the fix ships.

## Scope

In scope: the code in this repository — the ledger, provider adapters,
webhook ingestion, auth, portal, and admin surfaces. Out of scope: the
third-party services it integrates with (Stripe, Paystack, Resend,
Vercel, Neon) — report issues in those directly to their own security
teams.

## Supported versions

Only the latest `1.x` release is supported with security fixes.
