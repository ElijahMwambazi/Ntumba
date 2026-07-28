# Development

## Toolchain

Use Node 24.18.0 and Yarn 4.17.1. `yarn.lock` is the only lockfile.

```bash
corepack enable
yarn install --immutable
```

## Local services

PostgreSQL is the only infrastructure dependency:

```bash
docker compose up -d database
yarn db:migrate
```

All payment adapters are safe fakes. There are no live wallet or payment-gateway actions.
Set a random `FAKE_PROVIDER_CALLBACK_SECRET` of at least 32 characters to exercise the signed fake
callback route. Without it, callback verification fails closed while other development flows run.

## Database changes

Edit `packages/database/src/schema.ts`, run `yarn db:generate`, and review the generated SQL.
Never retain a personal-data column for development compatibility. Do not apply destructive
migrations to a database unless its development status is known.

## Checks

```bash
yarn lint
yarn typecheck
yarn test
yarn build
yarn check
```

Playwright requires a browser installation:

```bash
yarn playwright install chromium
yarn test:e2e
```

## Payment changes

Test idempotency, quote expiry, purge eligibility, duplicate callbacks, unknown provider outcomes,
failed settlement, refunds and manual review. Prove that merchant destinations and raw callbacks
cannot enter persistence.

Provider-direct intent creation is staged transactionally with a payload-free outbox row before
the provider call. Failure-injection tests must prove that resubmitting the same request and
idempotency key resumes the staged intent without persisting the destination.

Destinations may be passed transiently to a provider adapter. Fastify must not log request bodies,
and provider errors must map to non-identifying failures.
