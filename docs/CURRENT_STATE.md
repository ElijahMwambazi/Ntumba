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
- Installable production PWA metadata with Ntumba icons and a generic offline shell. Its explicit
  Cache Storage allowlist contains only public shell assets; API and route responses are never
  cached.
- Accessible light-first UI tokens, semantic controls, visible focus, 48px mobile targets,
  reduced-motion support, safe-area bottom navigation and desktop task layout.
- Symmetrical desktop Get paid layout with a centred 480px payment task and a separate collapsible
  quick guide, plus a single-column mobile disclosure. First-visit state is stored as a local-only
  boolean and resets with all other local Ntumba data.
- Destination-free quote contracts and integer-only quote arithmetic.
- Provider-direct settlement contract with safe deterministic fake.
- HMAC-signed fake-provider callback endpoint with five-minute timestamp tolerance, raw-body
  verification, intent/amount/asset matching and replay-safe append-only normalized event storage.
- Payload-free provider-intent outbox staged atomically with each bridge intent, with safe attempt
  metadata, idempotent client-assisted retry and transactional completion of opaque provider data.
- Separate direct-Lightning contract that preserves merchant-owned invoices.
- PostgreSQL quote/payment-intent adapter containing only safe operational fields.
- Normalized provider-event schema with no raw callback body.
- Expiry/purge timestamps, opportunistic purge and hourly pg-boss purge job.
- Clean development migration baseline replacing the obsolete recipient/payout schema.
- GitHub Actions workflow pinned through `.nvmrc` to Node 24.18.0, with immutable Yarn installation,
  the complete repository check and Chromium Playwright coverage.
- Automated weekly/push/pull-request security workflow with a high-severity full dependency audit
  and redacted full-history secret scanning under read-only repository permissions.
- Focused non-custodial architecture checks and unit/API/web tests.
- Playwright coverage for creation, sharing, payer choice, expiry, direct-payment wording,
  local settings/clear-data behavior, storage fallback and mobile/desktop layouts.
- Review screenshots under `artifacts/ui-review/` at 390×844 CSS pixels (Pixel 7 device scale)
  and 1440×900 desktop pixels.

## Not implemented

- Live, freshness-checked BTC/ZMW rates.
- Any live settlement provider.
- Provider-event processing, status polling and reconciliation that advance persisted states.
- Autonomous provider-intent outbox dispatch. It requires a provider-issued opaque destination
  token; raw or encrypted merchant destinations remain forbidden in server persistence.
- Live Lightning-address resolution or merchant-wallet settlement verification.
- Independently verifiable direct-payment receipts.
- Durable, multi-instance public request storage. The current opaque public request store is
  process memory only, marked development-only, and disappears on restart.
- Capability discovery from live providers. Fake-provider request options are prepared when the
  merchant creates the request and refreshed when the customer selects one.
- Production retention decision, legal/provider review or deployment.

No real funds should be used. The fake provider's checkout URL uses the reserved `.invalid` domain.
