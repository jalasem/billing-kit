---
name: Bug report
about: Something in billing-kit is broken or behaves unexpectedly
title: ""
labels: bug
assignees: ""
---

**Describe the bug**
A clear description of what's wrong.

**To reproduce**
Steps to reproduce, ideally against the `fake` provider and
`docker compose up -d` Postgres so it needs no real credentials:

1. ...
2. ...

**Expected behaviour**
What you expected to happen instead.

**Environment**
- billing-kit version / commit:
- Node version (`node --version`):
- Provider(s) involved: fake / Stripe / Paystack
- Deployment: local / Vercel + Neon / other

**Logs**
Relevant console/server output. Redact secrets (`CRON_SECRET`, provider
keys, webhook signatures) before pasting.

**Security-sensitive?**
If this is a vulnerability (money movement, auth bypass, data exposure),
please do **not** file it here — see
[`SECURITY.md`](../../SECURITY.md) instead.
