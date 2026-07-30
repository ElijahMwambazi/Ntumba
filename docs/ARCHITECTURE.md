# Architecture

## Shape

Ntumba remains a TypeScript modular monolith:

```text
Merchant PWA (IndexedDB) ── safe envelope + transient destination ──> Fastify API
        │                                                        │
        │                                                        ├── public envelope ──> PostgreSQL
        │                                                        └── raw destination ──> memory vault
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
- `database`: operational schema, durable public checkout envelope, two-leg treasury foundation,
  asset-specific journal and purge transaction.
- `providers`: verified normalized callback/event boundary and direct merchant Lightning contract.
- `treasury`: Bitcoin and mobile-money rails, integer rate source, liquidity inventory, settlement
  coordinator, expiring destination vault, immutable journal and reconciliation boundaries.
- `observability`: bounded metric names/labels, aggregate snapshots and future read-only status
  interfaces with no fund-moving methods.
- `server`: API routes, PostgreSQL payment/public-request adapters and scheduled jobs, plus a
  separately bound private health/metrics listener.
- `web`: merchant creation, sharing, guest checkout and local IndexedDB history.

## Operator-liquidity conversion bridge

Conversion no longer assumes one provider owns both legs. `BitcoinLiquidityRail` represents
operator Lightning invoice creation/read, outgoing invoice payment and BTC balance/capacity.
`MobileMoneyLiquidityRail` represents mobile-money collection/disbursement and ZMW
balance/availability. `SettlementSagaRepository` durably reserves destination assets before
collection. `BridgeEngine` sequences both legs, `SettlementDestinationVault` recovers a destination only for a
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

Merchant request creation stores only the durable public envelope and supported method/direction
pairs, while its raw destination receives an opaque token in the separate development memory
vault. No quote or source rail is created at this point. Method selection creates a fresh
short-lived quote and a durable request/method/direction binding. Confirmation resolves the
destination before a row-locked `open -> claimed` transition records the winning selection key,
quote and stable payment-intent UUID. A missing token returns unavailable before the claim or any
rail call; a different claimant receives a conflict. After the claim, bridge creation atomically
stores the payment intent, legs, reservation, waiting obligation and payload-free source outbox
before calling the fake source rail outside the transaction with a stable collection key.

Provider-event processing row-locks one normalized event and retains its exact UUID outside the
transaction. If application rolls back, isolation locks and rechecks only that UUID; a row already
processed by another worker is a no-op. A bounded iterative scan lets later eligible events
proceed without recursive skipping. Successful application atomically advances the source leg,
journal, obligation, destination outbox and processed marker. Destination work uses an expiring
database lease and creates one durable logical attempt before the fake rail call.

`treasury_inventory_positions` persists one opening and one current integer balance per asset.
Initialization is insert-only: later environment changes cannot rewrite the book. Creation locks
the destination inventory row and computes spendable value as current balance minus active
reservations. A newly inserted source journal transaction credits current inventory; a newly
inserted destination journal transaction debits it. The journal movement, inventory mutation,
reservation and lifecycle update share one transaction, so duplicates cannot move the book twice.
Fake-provider balances remain separate external reports; bounded mismatch metrics expose
differences without rewriting either side.

Conclusive source failure marks the source leg and waiting destination obligation failed, releases
the active reservation exactly once, terminalizes the bridge/intent and creates no destination or
refund work. Timeout/unknown preserves the reservation and enters manual review. Conclusive source
settlement after expiry or conclusive source failure uses a narrow late-event
transition: source value is journaled/credited once and one refund obligation is created without
destination execution. Source-unknown manual review may resume destination work only while its
opaque destination token, active reservation and destination deadline remain valid; otherwise it
also creates one refund obligation.

Provider events carry only bounded processing count/time, safe failure code and dead-letter time.
A failed application rolls back, schedules bounded exponential retry and lets later eligible
events proceed. The final retry isolates the event and moves a legally transitionable bridge to
manual review. Destination targeting adds the bridge ID to the same row-lock/lease query used by
the global worker.

`settlement_attempts` remains the one logical external action and stable idempotency key.
`settlement_attempt_events` is append-only history: each lease/external call adds a numbered
`started` event followed by at most one `succeeded`, `failed`, `timeout` or `unknown` event.
Conclusive failure may create the next number; timeout/unknown does not automatically retry.

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

The forward-only migrations add bridge settlements and source/destination legs, liquidity
reservations, settlement obligations/attempts, reconciliation results, refund obligations,
durable inventory, provider-event isolation metadata, append-only transport-attempt events and
the minimal public request/option, payer-quote binding and one-time claim tables.
Journal transactions are grouped by exchange but balanced independently for BTC and ZMW with
positive integer debit/credit entries. Deferred triggers reject unbalanced commits, and
UPDATE/DELETE triggers make journal history append-only.

The provider-intent outbox contains only its intent reference, provider name, attempt count, safe
failure code and lifecycle timestamps. It has no serialized payload or destination field.

Verified provider events are appended under the unique provider/event-ID key. Identical retries
are acknowledged without a second row; reuse of an event ID with different bytes is rejected.
The PostgreSQL processor applies legal domain transitions and records `processed_at` in the same
transaction, so duplicate callbacks cannot double-credit or duplicate obligations.

Normal server startup uses the PostgreSQL store for quotes and payment intents. Unit/API tests
inject an in-memory implementation of the same safe record shape.

The same store boundary exposes aggregate operational snapshots. PostgreSQL performs grouped/count
queries and returns no row identifiers or sensitive fields. Prometheus process counters observe
registered public route templates, normalized callback outcomes and purge results. The internal
listener is constructed only when `OPS_ENABLED=true`, requires a strong bearer token and never
registers on the public Fastify instance.

The public checkout envelope is keyed by a random UUID and shared across server instances through
PostgreSQL. It contains one positive integer amount, receive asset, supported method/direction
pairs, `open/claimed/expired` state, an opaque destination lookup token and explicit
creation/expiry/purge timestamps. Separate safe rows bind payer-created quotes and retain exactly
one claim with its stable payment-intent UUID. They contain no merchant label/reference, phone,
Lightning address/invoice or customer identity. The development destination vault remains
separate and non-durable; envelope durability does not make a request payable on another instance
that cannot resolve its token. A completed conversion source setup can reconstruct its already
durable checkout without redispatching the source call.

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

Public-request expiry is configured independently from quote expiry. Requests, quote bindings,
claims, intents and outbox rows have explicit lifecycle timestamps. API access
opportunistically purges due public requests; pg-boss also removes them in the hourly operational
purge. A due bridge is eligible only when its
status is terminal, provider-finality grace has passed and no active reservation, unresolved
obligation/refund, dead letter, event, outbox work, lease or reconciliation-review flag remains.
Eligible children are deleted in foreign-key order before the bridge, intent and quote. The
immutable treasury journal is outside ordinary operational purge.

Production retention must be reconciled with provider contracts, disputes, accounting and Zambian
regulatory obligations before launch.
