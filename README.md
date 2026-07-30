# Ntumba

Ntumba is an accountless, merchant-first payment-request and routing application for Zambia.
Merchants create one-time requests without registering. Payers open the link as anonymous guests.

Ntumba is **an accountless payment bridge with direct settlement and no merchant balances**.
Three payment directions are modeled:

- BTC → BTC: the payer pays a merchant-owned Lightning invoice directly. This rail is
  non-custodial; Ntumba never receives or forwards the Bitcoin.
- BTC → ZMW: the intended production design collects Bitcoin to an operator-controlled
  Voltage-hosted LND node, then disburses ZMW from the operator's Lipila balance.
- ZMW → BTC: the intended production design collects ZMW into the operator's Lipila balance, then
  pays the merchant invoice from the operator-controlled LND node.

The conversion directions are custodial during settlement because Ntumba controls both liquidity
legs. Merchants still have no Ntumba account, balance, deposit wallet or synchronized profile.

## Implemented

- Installable mobile-first React 19/Vite merchant PWA with Get paid (`/`), request sharing
  (`/requests/:localId`), Activity (`/activity`), Settings (`/settings`) and a privacy-safe offline
  shell.
- Anonymous guest checkout at `/pay/:publicId`; the customer—not the merchant—chooses an
  available payment method.
- Versioned IndexedDB preferences, requests and receipts with a confirmed clear-data action.
- Durable PostgreSQL one-time public-request envelopes with opaque links, QR, copy-link and native
  Web Share support; raw destinations remain only in the separate development memory vault.
- Independent 15-minute development request lifetime, payer-created 60-second quotes, explicit
  quote confirmation and one row-locked claim with a stable payment-intent identity.
- Fastify quote and fake payment-intent APIs.
- Integer-only quotes and explicit source, destination and direct-payment states.
- Disabled-by-default fake operator treasury with separate Lightning, mobile-money, rate,
  repository-backed coordinator, destination-vault, journal and reconciliation boundaries.
- Merchant-owned direct Lightning boundary that is never substituted with operator liquidity.
- Signed fake-treasury callbacks with append-only normalized event ingestion.
- Payload-free transactional source and leased destination outboxes.
- Durable PostgreSQL fake settlement saga for bridge legs, reservations, obligations, attempts,
  append-only balanced journal entries, reconciliation review and refund obligations.
- Durable per-asset book inventory initialized once, transactionally credited/debited with
  journal movements and protected against concurrent over-reservation.
- Late-source refund handling, obligation-aware retention, isolated/dead-lettered provider events,
  bridge-targeted destination claims and append-only numbered delivery-attempt history.
- Disabled-by-default private operator listener with aggregate Prometheus metrics and a provisioned
  loopback-only Grafana dashboard under the opt-in Compose `ops` profile.
- Deterministic fake Voltage/LND and fake Lipila adapters only.

No Voltage connection, Lipila connection, live rate, mainnet payment or real funds are supported.
The public checkout envelope, quote bindings, one-time claim, accounting and obligations survive a
restart, but the fake destination vault remains process memory only. An open request whose
destination is gone becomes unavailable before claim/source collection; it is not fully
multi-instance payable. A completed conversion source setup can recover its durable checkout
without redispatch. A destination lost after source settlement, or a late settlement after
expiry/conclusive failure, creates one refund obligation. Fake provider state can be shared across
replacement adapters to test provider-side idempotency, but real provider semantics remain
unverified. This is not production-safe.

## Requirements

- Node.js 24.18.0
- Corepack and Yarn 4.17.1
- Docker with Compose

## Start locally

```bash
corepack enable
cp .env.example .env
# Optional local conversion simulation only:
# set BRIDGE_ENGINE_MODE=fake in .env
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
[Privacy](docs/PRIVACY.md), [Operator dashboard](docs/OPERATOR_DASHBOARD.md) and
[Development](DEVELOPMENT.md).

Ntumba is private software. No open-source license is granted.
