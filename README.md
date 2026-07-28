# Ntumba

Ntumba is an accountless, merchant-first payment-request and routing application for Zambia.
Merchants create one-time requests without registering. Payers open the link as anonymous guests.

Three safe payment directions are modeled:

- BTC → BTC: the payer pays a merchant-owned Lightning invoice directly.
- BTC → ZMW: the payer pays an external provider over Lightning; that provider settles the
  merchant's mobile-money destination.
- ZMW → BTC: the payer pays an external provider through mobile money; that provider settles the
  merchant's external Lightning wallet.

Ntumba coordinates intents and status. It does not receive, control, forward or reuse funds.

## Implemented

- Installable mobile-first React 19/Vite merchant PWA with Get paid (`/`), request sharing
  (`/requests/:localId`), Activity (`/activity`), Settings (`/settings`) and a privacy-safe offline
  shell.
- Anonymous guest checkout at `/pay/:publicId`; the customer—not the merchant—chooses an
  available payment method.
- Versioned IndexedDB preferences, requests and receipts with a confirmed clear-data action.
- Opaque public request links with QR, copy-link and native Web Share support.
- Fastify quote and fake payment-intent APIs.
- Integer-only quotes and explicit provider/direct payment states.
- Provider-direct settlement and merchant-owned Lightning boundaries.
- Signed fake-provider callbacks with append-only normalized event ingestion.
- Payload-free transactional provider-intent outbox with idempotent client-assisted recovery.
- Minimal PostgreSQL state with normalized events and scheduled expiry/purge support.
- Safe fake providers only.

No real funds or live providers are supported.

## Requirements

- Node.js 24.18.0
- Corepack and Yarn 4.17.1
- Docker with Compose

## Start locally

```bash
corepack enable
cp .env.example .env
yarn install --immutable
docker compose up -d database
yarn db:migrate
yarn dev
```

Open the web app at <http://localhost:5173> and API documentation at
<http://localhost:3000/documentation>.

## Validate

```bash
yarn check
yarn test:pwa
yarn test:e2e
```

See [Product](docs/PRODUCT.md), [UI/UX](docs/UI_UX.md),
[Architecture](docs/ARCHITECTURE.md), [Payment flows](docs/PAYMENT_FLOWS.md),
[Privacy](docs/PRIVACY.md) and [Development](DEVELOPMENT.md).

Ntumba is private software. No open-source license is granted.
