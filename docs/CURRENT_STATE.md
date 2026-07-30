# Current State

## Implemented

- Pinned Yarn workspace, React/Vite frontend, Fastify API, PostgreSQL/Drizzle and pg-boss.
- Mobile-first merchant flow: Get paid → Create request → Share request → View status.
- Merchant chooses only amount, receive asset and destination; reference is optional and the payer
  method is deliberately absent from request creation.
- Exact merchant routes: `/`, `/requests/:localId`, `/activity` and `/settings`.
- Anonymous `/pay/:publicId` checkout derives available payer methods from request capabilities
  and keeps provider/direct states explicit.
- IndexedDB schema v2 for local preferences, masked request summaries and receipts, including v1
  migration, clear-data confirmation and a visible session-memory fallback.
- Opaque, high-entropy public request URL backed by a minimal PostgreSQL checkout envelope with no
  destination, merchant identity or URL-fragment payload.
- QR, copy-link and Web Share UI with success/error feedback and fallback.
- Installable production PWA metadata with Ntumba icons and a generic offline shell. Its explicit
  Cache Storage allowlist contains only public shell assets; API and route responses are never
  cached.
- Accessible light-first UI tokens, semantic controls, visible focus, 48px mobile targets,
  reduced-motion support, safe-area bottom navigation and desktop task layout.
- Symmetrical desktop Get paid layout with a centred 480px payment task and a separate collapsible
  quick guide, plus a single-column mobile disclosure. First-visit state is stored as a local-only
  boolean and resets with all other local Ntumba data.
- Destination-free quote contracts and integer-only quote arithmetic.
- Hybrid operator-liquidity boundaries for Bitcoin/mobile-money rails, integer rates, inventory,
  coordination, destination recovery, journal and reconciliation.
- Disabled-by-default deterministic fake Voltage/LND and fake Lipila treasuries with balance,
  capacity, availability and success/failure/timeout/unknown simulation.
- Explicit source/destination state machine with reservation-before-collection,
  source-before-destination, distinct leg idempotency, no duplicate settlement, manual review and
  refund-required invariants.
- Development-only in-memory expiring destination vault that returns opaque tokens and deletes
  terminal/expired values.
- HMAC-signed fake-treasury callback endpoint with five-minute timestamp tolerance, raw-body
  verification, intent/amount/asset matching and replay-safe append-only normalized event storage.
- Payment intent, bridge, both legs, reservation, waiting obligation and payload-free source
  outbox staged in one transaction before the fake source call.
- Separate direct-Lightning contract that preserves merchant-owned invoices.
- PostgreSQL quote/payment-intent adapter containing only safe operational fields.
- Repository-backed PostgreSQL saga for bridge legs, reservations, obligations/attempts,
  row-locked provider events, leased destination work, append-only balanced journal entries,
  reconciliation review and exactly-once refund obligations.
- Durable BTC/ZMW inventory positions whose opening balances are inserted once and whose current
  balances survive restarts. Source journal insertion credits inventory once; destination journal
  insertion debits it once; the inventory row serializes reservations.
- Explicit late-source handling after expiry, conclusive failure or source-unknown manual review,
  with exactly-once credit and either safe destination queuing or one refund obligation.
- Financial-state-aware retention that preserves unresolved work, leases, reservations, review
  flags, dead letters and refund liabilities through a bounded provider-finality grace period.
- Privacy-safe provider-event retry metadata/dead letters, bridge-targeted destination claims and
  append-only numbered transport-attempt history under a stable external idempotency key.
- Exact provider-event failure isolation by selected event UUID, with row-locked recheck,
  bounded non-recursive skipping and safe no-op behavior after another worker processes the row.
- Conclusive source setup/provider failure terminalizes both legs' obligation, releases the
  reservation once and leaves no destination/refund work; uncertain outcomes remain in review.
- Durable multi-instance public request reads with integer amount, payer options, expiry/purge
  timestamps and one opaque destination lookup token. Payment intent/source setup is deferred
  until payer confirmation and fails closed if the separate memory vault cannot resolve the token.
- Replacement fake rail adapters can share simulated remote-provider state for stronger
  provider-side idempotency restart tests.
- Normalized provider-event schema with no raw callback body.
- Expiry/purge timestamps, opportunistic purge and hourly pg-boss purge job.
- Disabled-by-default separate internal Fastify listener with bearer-protected aggregate health,
  fake treasury balance/capacity/reservation/liability/pipeline/reconciliation Prometheus metrics,
  registered-route labels and explicit fake/unavailable rail states.
- Opt-in Compose `ops` profile with version-pinned private Prometheus, conservative alert rules and
  a provisioned read-only **Ntumba Operator** Grafana dashboard bound to host loopback only.
- Clean development migration baseline replacing the obsolete recipient/payout schema.
- GitHub Actions workflow pinned through `.nvmrc` to Node 24.18.0, with immutable Yarn installation,
  the complete repository check and Chromium Playwright coverage.
- Automated weekly/push/pull-request security workflow with a high-severity full dependency audit
  and redacted full-history secret scanning under read-only repository permissions.
- Focused hybrid-custody, privacy, migration, treasury and observability checks.
- Playwright coverage for creation, sharing, payer choice, expiry, direct-payment wording,
  local settings/clear-data behavior, storage fallback and mobile/desktop layouts.
- Review screenshots under `artifacts/ui-review/` at 390×844 CSS pixels (Pixel 7 device scale)
  and 1440×900 desktop pixels.

## Not implemented

- Live, freshness-checked BTC/ZMW rates.
- Voltage or Lipila integration, credentials or network calls.
- Any live liquidity rail, mainnet transaction or real fund movement.
- Live provider status polling and real reconciliation.
- Production destination recovery using provider tokenization or a reviewed short-lived
  envelope-encrypted store.
- Live Lightning-address resolution or merchant-wallet settlement verification.
- Independently verifiable direct-payment receipts.
- Capability discovery from live providers. Durable request options still use deterministic fake
  quotes and are revalidated when the customer confirms one.
- Production retention decision, legal/provider review or deployment.
- Durable destination storage, real reconciliation, automated refunds, live treasury/rate circuit
  breakers, real-money alerts, operator write controls
  or a public status page.

No real funds should be used. Fake treasury checkout URLs use reserved `.invalid` domains.
