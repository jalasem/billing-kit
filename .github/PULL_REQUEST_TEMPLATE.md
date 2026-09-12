## What and why

<!-- What does this change, and why? Link an issue if there is one. -->

## How it was tested

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass locally
- [ ] `pnpm test:e2e` passes locally (if the change touches `src/app/(portal)`, `src/app/(admin)`, or auth)
- [ ] New behaviour has a Vitest (and, for UI, Playwright) test covering it — see [`CONTRIBUTING.md`](../CONTRIBUTING.md)

## Checklist

- [ ] No new runtime dependency was added without discussion (devDependencies are fine)
- [ ] Money is handled as signed `bigint` minor units, never `number`/float
- [ ] Any new provider payload field read is validated (zod) rather than trusted
- [ ] Docs updated if this changes setup, env vars, or the ledger/chart of accounts (`README.md`, `src/core/ledger/README.md`)
- [ ] Any payload shape guessed rather than confirmed against a real webhook is called out in this PR description
