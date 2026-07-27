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

Destinations may be passed transiently to a provider adapter. Fastify must not log request bodies,
and provider errors must map to non-identifying failures.
