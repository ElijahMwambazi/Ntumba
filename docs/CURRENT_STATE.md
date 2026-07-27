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
- Opaque public request URL with no destination or URL-fragment payload.
- QR, copy-link and Web Share UI with success/error feedback and fallback.
- Accessible light-first UI tokens, semantic controls, visible focus, 48px mobile targets,
  reduced-motion support, safe-area bottom navigation and desktop task layout.
- Symmetrical desktop Get paid layout with a centred 480px payment task and a separate collapsible
  quick guide, plus a single-column mobile disclosure. First-visit state is stored as a local-only
  boolean and resets with all other local Ntumba data.
- Destination-free quote contracts and integer-only quote arithmetic.
- Provider-direct settlement contract with safe deterministic fake.
- Separate direct-Lightning contract that preserves merchant-owned invoices.
- PostgreSQL quote/payment-intent adapter containing only safe operational fields.
- Normalized provider-event schema with no raw callback body.
- Expiry/purge timestamps, opportunistic purge and hourly pg-boss purge job.
- Clean development migration baseline replacing the obsolete recipient/payout schema.
- Focused non-custodial architecture checks and unit/API/web tests.
- Playwright coverage for creation, sharing, payer choice, expiry, direct-payment wording,
  local settings/clear-data behavior, storage fallback and mobile/desktop layouts.
- Review screenshots under `artifacts/ui-review/` at 390×844 CSS pixels (Pixel 7 device scale)
  and 1440×900 desktop pixels.

## Not implemented

- Live, freshness-checked BTC/ZMW rates.
- Any live settlement provider.
- Signed callback HTTP route and durable normalized event ingestion.
- Provider status polling/reconciliation that advances persisted states.
- Live Lightning-address resolution or merchant-wallet settlement verification.
- Independently verifiable direct-payment receipts.
- Durable, multi-instance public request storage. The current opaque public request store is
  process memory only, marked development-only, and disappears on restart.
- Capability discovery from live providers. Fake-provider request options are prepared when the
  merchant creates the request and refreshed when the customer selects one.
- Production retention decision, legal/provider review or deployment.

No real funds should be used. The fake provider's checkout URL uses the reserved `.invalid` domain.
