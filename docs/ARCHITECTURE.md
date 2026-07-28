# Architecture

## Shape

Ntumba remains a TypeScript modular monolith:

```text
Merchant PWA (IndexedDB) ── quote/options ──> Fastify API
        │                         │
        │                         └── short-lived opaque public request (process memory)
        │
Anonymous payer <── /pay/:publicId link ──── Merchant device
        │                                      │
        ├── merchant-owned Lightning invoice ─> Merchant wallet
        │
        └── fake source collection ───────────> Settlement coordinator
                                                  │ conclusive source settlement
                                                  ├── inventory reservation
                                                  ├── asset-specific journal
                                                  └── fake destination rail ──> Merchant

Fake BTC treasury <──> coordinator <──> Fake Lipila treasury

Fastify API ── opaque operational and treasury state ──> PostgreSQL + pg-boss purge job

Private Prometheus ── bearer token ──> Internal Fastify listener ── aggregate reads only
       │                                      (disabled by default; separate port)
       └──> loopback-only Grafana
```

## Module boundaries

- `contracts`: destination-free quote schemas, transient intent input, safe output schemas and
  opaque public-request capability schemas.
- `domain`: integer monetary calculation, state transitions and retention windows.
- `database`: operational schema, two-leg treasury foundation, asset-specific journal and purge
  transaction.
- `providers`: verified normalized callback/event boundary and direct merchant Lightning contract.
- `treasury`: Bitcoin and mobile-money rails, integer rate source, liquidity inventory, settlement
  coordinator, expiring destination vault, immutable journal and reconciliation boundaries.
- `observability`: bounded metric names/labels, aggregate snapshots and future read-only status
  interfaces with no fund-moving methods.
- `server`: API routes, persistence adapter, development-only public request store and scheduled
  jobs, plus a separately bound private health/metrics listener.
- `web`: merchant creation, sharing, guest checkout and local IndexedDB history.

## Operator-liquidity conversion bridge

Conversion no longer assumes one provider owns both legs. `BitcoinLiquidityRail` represents
operator Lightning invoice creation/read, outgoing invoice payment and BTC balance/capacity.
`MobileMoneyLiquidityRail` represents mobile-money collection/disbursement and ZMW
balance/availability. `LiquidityInventoryService` reserves destination assets before collection.
`BridgeEngine` sequences both legs, `SettlementDestinationVault` recovers a destination only for a
short time, `TreasuryJournal` records linked balanced transactions per asset, and
`ReconciliationService` compares privacy-safe external state.

The milestone implementations are deterministic fakes with no network-call path. The bridge gate
defaults to `disabled`; development may explicitly choose `fake`, and production rejects fake
execution. No Voltage, Lipila, sandbox, mainnet or live mode exists.

BTC → ZMW creates an invoice owned by the simulated operator Lightning treasury. Only after source
settlement is conclusive may the coordinator disburse from simulated operator ZMW inventory.
ZMW → BTC collects into simulated operator mobile-money inventory first, then pays the merchant
invoice from simulated operator BTC inventory. These conversion paths are custodial during
settlement even though merchants have no Ntumba balance.

The fake treasury callback enters through `POST /api/v1/provider-callbacks/fake`. Its HMAC covers
the timestamp and exact raw bytes. Verification and normalization happen before the event is
matched against the retained opaque reference, direction, assets and integer amounts.

Intent creation retains the existing transactional outbox safety. It atomically stores a
`created` intent and payload-free outbox row, then reserves destination liquidity, places the
destination in the development-only vault and creates source collection using a distinct
collection idempotency key. Completion stores only opaque references/tokens and moves the intent
to `awaiting_source_payment`.

If source setup fails, the outbox remains with a safe code. Repeating the same request supplies
the destination transiently and reuses the original key. Durable bridge-leg tables now exist but
are not yet wired to the in-memory coordinator; transactional saga persistence is a later
milestone.

## Direct Lightning

`DirectLightningProvider` prepares an invoice owned by the merchant wallet. A supplied invoice is
passed through exactly. The direct rail has no operator invoice-creation or outgoing-payment
method.
Until merchant-wallet evidence or an independent proof exists, direct payments remain explicitly
unverified. This is the only non-custodial direction.

## Server state

PostgreSQL stores integer amounts, assets, direction, normalized status, separate collection and
settlement idempotency keys, opaque references/tokens, safe failure code, event ID/hash and
lifecycle timestamps. It has no merchant profile, destination, invoice or raw callback column.

The forward-only treasury migration adds bridge settlements and source/destination legs, liquidity
reservations, settlement obligations/attempts, reconciliation results and refund obligations.
Journal transactions are grouped by exchange but balanced independently for BTC and ZMW with
positive integer debit/credit entries. Deferred triggers reject unbalanced commits, and
UPDATE/DELETE triggers make journal history append-only.

The provider-intent outbox contains only its intent reference, provider name, attempt count, safe
failure code and lifecycle timestamps. It has no serialized payload or destination field.

Verified provider events are appended under the unique provider/event-ID key. Identical retries
are acknowledged without a second row; reuse of an event ID with different bytes is rejected.
Ingestion does not yet advance intent state. A later processor must apply legal domain transitions
and record `processed_at` transactionally.

Normal server startup uses the PostgreSQL store for quotes and payment intents. Unit/API tests
inject an in-memory implementation of the same safe record shape.

The same store boundary exposes aggregate operational snapshots. PostgreSQL performs grouped/count
queries and returns no row identifiers or sensitive fields. Prometheus process counters observe
registered public route templates, normalized callback outcomes and purge results. The internal
listener is constructed only when `OPS_ENABLED=true`, requires a strong bearer token and never
registers on the public Fastify instance.

The public checkout projection is currently a separate, short-lived in-memory store. It is keyed
by an opaque UUID, contains only the safe payer options required by guest checkout and is purged
after intent retention. It is explicitly marked development-only: it is not durable, shared
between processes or suitable for deployment. Destinations remain absent from both this
projection and PostgreSQL.

## Browser state and routes

IndexedDB schema v2 keeps preferences, masked request summaries and receipts on the merchant
device. Guest checkout fetches `/api/v1/public-requests/:publicId`; raw merchant destinations are
never put in route parameters, query strings or fragments.

Production builds register a service worker for installability and a reconnect-only offline shell.
Cache Storage is restricted to an explicit list of public offline-page, manifest and icon assets.
Navigations remain network-first and fall back to the generic offline page; `/api` requests and
route responses are not intercepted or cached. IndexedDB remains the only persistent browser store
for merchant data.

- `/` — merchant Get paid
- `/requests/:localId` — device-local share/status view
- `/pay/:publicId` — anonymous guest checkout
- `/activity` — device-local requests and receipts
- `/settings` — device-local preferences and clear-data control

## Lifecycle

Quotes, intents and outbox rows have explicit lifecycle timestamps. API access opportunistically
purges due rows; pg-boss also schedules an hourly purge. Outbox rows and provider events are removed
before intents, then unreferenced quotes. Development defaults retain an expired intent for one day
and an expired quote for one hour.

Production retention must be reconciled with provider contracts, disputes, accounting and Zambian
regulatory obligations before launch.
