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
        └── provider checkout ────────────────> Settlement provider
                                                  │
                                                  └── Merchant destination

Fastify API ── opaque operational state only ──> PostgreSQL + pg-boss purge job

Private Prometheus ── bearer token ──> Internal Fastify listener ── aggregate reads only
       │                                      (disabled by default; separate port)
       └──> loopback-only Grafana
```

## Module boundaries

- `contracts`: destination-free quote schemas, transient intent input, safe output schemas and
  opaque public-request capability schemas.
- `domain`: integer monetary calculation, state transitions and retention windows.
- `database`: minimal operational schema and purge transaction.
- `providers`: provider-direct settlement contract and direct merchant Lightning contract.
- `observability`: bounded metric names/labels, aggregate snapshots and future read-only status
  interfaces with no fund-moving methods.
- `server`: API routes, persistence adapter, development-only public request store and scheduled
  jobs, plus a separately bound private health/metrics listener.
- `web`: merchant creation, sharing, guest checkout and local IndexedDB history.

## Provider-direct bridge

`SettlementProvider` can quote, create a provider-owned intent, return opaque references and payer
instructions, read normalized status and verify callbacks. Destination data exists only as an
argument to intent creation. The provider collects and settles; Ntumba does neither.

The fake provider callback enters through `POST /api/v1/provider-callbacks/fake`. Its HMAC covers
the timestamp and exact raw bytes. Verification and normalization happen before the event is
matched against the retained provider reference, direction, assets and integer amounts.

Provider intent creation uses two database transactions around the external side effect. The first
atomically stores a `created` intent and a payload-free `provider_intent_outbox` row. The request
then sends the merchant destination transiently to the provider with the durable idempotency key.
The second transaction stores only the opaque provider reference/token, moves the intent to
`provider_collecting` and marks the outbox row processed.

If the provider call or process fails, the pending row remains with a safe failure code. Repeating
the same API request supplies the destination transiently again and reuses the same provider
idempotency key. This closes the crash window without persisting personal data. Autonomous worker
dispatch is deliberately deferred until a reviewed provider can supply an opaque destination token
before intent creation.

## Direct Lightning

`DirectLightningProvider` prepares an invoice owned by the merchant wallet. A supplied invoice is
passed through exactly. Ntumba has no invoice-creation wallet and no outgoing payment method.
Until merchant-wallet evidence or an independent proof exists, direct payments remain explicitly
unverified.

## Server state

PostgreSQL stores integer amounts, assets, direction, normalized status, idempotency key, opaque
provider references/tokens, safe failure code, event ID/hash and lifecycle timestamps. It has no
merchant profile, destination, invoice or raw callback column.

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
