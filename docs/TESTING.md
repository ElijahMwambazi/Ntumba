# Testing

## Layers

- Domain tests cover integer money, direction-aware fees, legal two-leg states and retention.
- Treasury tests cover repository-backed reservation/release, insufficient liquidity, source-before-destination,
  distinct/reused leg idempotency, duplicate prevention, external uncertainty, asset-specific
  journal balance, refund-required handling and destination-vault expiry/deletion.
- Fund-safety tests cover durable source credit/destination debit, opening-balance immutability,
  concurrent reservation locking, late settlement/refund idempotency, rail capacity gates,
  targeted claims, exact provider-event isolation/dead letters under concurrent workers,
  conclusive source-failure obligations, numbered attempt history and
  replacement adapters sharing only simulated remote-provider state.
- Provider tests cover signed callback normalization/timestamp rejection and direct
  merchant-invoice pass-through.
- API tests use Fastify injection with an in-memory safe-state repository, including raw callback
  signature, intent matching, duplicate and privacy behavior. Failure injection proves a pending
  provider-intent outbox resumes with the same idempotency key after a provider timeout. Public
  request tests prove independent request/quote lifetimes, fresh/replacement quotes, creation
  conflicts, cross-request quote rejection, single concurrent claim, winner replay and fail-closed
  destination loss before claim/source setup.
- Storage tests cover schema-version serialization, loading, deletion, v1 migration and
  session-memory fallback.
- Sharing tests cover native Web Share and unavailable fallback.
- Presentation tests cover payer-method capabilities, destination masking, expiry and explicit
  unverified direct-payment copy.
- Repository architecture tests reject personal/raw treasury columns, live modes/call paths,
  operator actions on the direct rail, destructive migration operations, mutable/unbalanced
  journal behavior and public/operator boundary violations.
- PWA asset tests validate manifest metadata, icon dimensions, build output and the service-worker
  cache boundary. A production Playwright run installs that worker, checks its exact cache contents
  and proves offline navigation uses the reconnect-only shell.
- Observability tests cover default disablement, strong-token configuration, constant-scope bearer
  access, database failure redaction, aggregate fake treasury balances/capacities,
  reservations/liabilities/pipeline/reconciliation, bounded labels, raw-URL rejection and
  callback/purge counters.
- Repository observability checks reject operator routes/credentials in the web/public app,
  fund-moving status adapters, unpinned ops images, published private ports, hardcoded provisioning
  secrets and mutable/gradient dashboard configuration.
- Playwright runs a Pixel 7 profile at a 390×844 CSS viewport and desktop Chromium at 1440×900,
  with additional responsive checks at 768×1024 and 1024×768.

## Commands

```bash
yarn lint
yarn typecheck
yarn test
yarn build
yarn check
yarn test:pwa
yarn test:e2e
yarn audit:dependencies
```

`yarn db:generate` validates the Drizzle model. `yarn test:integration` applies all migrations to a
disposable PostgreSQL database and validates positive/nonnegative integer checks, inventory
locking/mutation, unresolved retention, terminal foreign-key purge order, exact poisoned-event
isolation under concurrent workers, conclusive source failures, durable public-request restart and
purge behavior, concurrent one-time claims, pre-dispatch recovery, post-provider-success response
recovery without a second source setup, targeted leases, append-only attempt/journal triggers and
deferred per-asset journal balance enforcement.

## Continuous integration

GitHub Actions reads Node 24.18.0 from `.nvmrc`, enables the repository-pinned Yarn through
Corepack, restores only Yarn's project-local package cache and installs with `--immutable`. The CI
job then runs `yarn check`, installs Chromium and its runner dependencies, verifies the production
service worker with `yarn test:pwa`, and runs the complete journey suite with `yarn test:e2e`.

The separate security workflow runs the full dependency audit and redacted Gitleaks history scan on
pushes, pull requests, manual dispatches and weekly. Run `yarn audit:dependencies` locally before
changing dependencies. Gitleaks uses `.gitleaks.toml`; allowlist changes require security review.

## Required scenarios

- Quote requests do not require or return merchant personal data.
- ZMW is ngwee and Bitcoin is satoshis; no floating-point money.
- Duplicate idempotency key returns one logical bridge intent.
- Conclusive source setup failure releases the reservation and deletes the destination; uncertain
  setup preserves the original collection action in manual review without blind retry. The
  conclusive path also fails the waiting destination obligation and terminalizes its source outbox.
- Destination is absent from stored intent and response.
- Raw callback body is verified in memory and only a hash/normalized event can persist.
- Stale/tampered signatures, amount mismatches and conflicting event-ID replays cannot persist.
- Destination liquidity is reserved before source acceptance and released on safe expiry or
  confirmed failure.
- Destination settlement cannot start before conclusive source settlement or run twice.
- Collection and settlement keys are distinct; confirmed retries reuse the settlement key.
- Unknown/timeout outcomes enter manual review and are not blindly retried.
- A missing destination after source settlement enters refund-required.
- Coordinator restarts preserve durable creation, normalized events, queued obligations and
  accounting; duplicate callbacks/workers and post-external-success crashes cannot double-apply.
- Replacement coordinator/repository/fake-adapter instances reuse only PostgreSQL and simulated
  remote-provider state for provider-idempotency replay; the destination vault is reconstructed or
  deliberately lost depending on the scenario.
- Expiry followed by source settlement credits once, creates one refund and never queues
  destination work; duplicate callbacks change nothing.
- Old unresolved manual-review, refund-required/pending, processing, reservation and reconciliation
  records survive purge; only terminal resolved records leave in foreign-key order and journals
  remain.
- PostgreSQL tests reject journal mutation, unbalanced commits, zero amounts and duplicate
  mappings, and prove failed event application rolls back journal and obligation changes.
- Journal transactions balance debit/credit independently for BTC and ZMW.
- Direct invoice is merchant-owned and is never substituted.
- Direct settlement remains unverified without evidence.
- Expired quotes cannot create intents; due data is purged.
- Unknown outcomes enter manual review.
- Source/destination failure, liquidity, rate, refund and manual-review states remain explicit.
- IndexedDB unavailable and native-share unavailable both have user-visible fallback behavior.
- The merchant form never asks how the customer will pay.
- The guest checkout has no merchant navigation and exposes only supported payment methods.
- Request links use opaque public IDs and contain no URL-fragment destination payload.
- Public request envelopes survive store/server replacement, contain no merchant identity or raw
  destination fields, purge when due and fail before claim or either fake source rail if the vault
  is lost.
- Public requests outlive individual quotes; selection creates a fresh bound quote and expiry
  offers a replacement while the request remains open.
- Exactly one concurrent selection claims a request. A winning retry returns the same intent and
  checkout; a different key conflicts, and provider unknown/failure never reopens the request.
- Clear local data requires confirmation and does not imply server-side deletion.
- Active navigation has a non-colour cue and tap targets are at least 48px.
- The first local Get paid visit expands the appropriate quick guide and stores only the local
  `quickGuideSeen` preference; later visits start collapsed and clear-data resets the behavior.
- Quick-guide buttons expose valid `aria-expanded` and `aria-controls` state, and the desktop form
  remains centred in both disclosure states.
- The install manifest has standard and maskable icons, the built public shell is complete, Cache
  Storage contains only its explicit public assets, and offline navigation cannot show stale
  payment state.
- Operational endpoints are absent from the public app and disabled by default; enabled production
  endpoints require the exact strong bearer token.
- Metrics contain only aggregates and bounded labels, use registered route templates and never
  expose IDs, references, phone numbers, invoices, destinations or merchant information.
- Compose keeps Prometheus and port 9091 private while binding Grafana only to `127.0.0.1`.

## Browser scenarios and artifacts

`tests/e2e/merchant.spec.ts` covers:

- Merchant creation, opaque sharing, copy feedback, guest payer choice, explicit fresh-quote
  confirmation and local Activity.
- Progressive disclosure of optional reference and destination controls.
- Settings persistence and cancel/confirm clear-data behavior.
- Expired quote handling and direct Bitcoin remaining unverified.
- IndexedDB-unavailable session fallback.
- First/subsequent quick-guide visits, manual disclosure, clear-data reset and storage failure.
- Symmetrical desktop task geometry, mobile guide fallback and intermediate-width overflow checks.

`tests/pwa/offline-shell.spec.ts` runs separately against a production Vite build so the
production-only service-worker registration is exercised without contaminating development-mode
journey tests.

Running `yarn test:e2e` refreshes the viewport screenshots in `artifacts/ui-review/`:

- `mobile-get-paid-390x844.png`
- `mobile-share-390x844.png`
- `mobile-checkout-390x844.png`
- `mobile-activity-390x844.png`
- `desktop-get-paid-1440x900.png`
- `desktop-get-paid-collapsed-1440x900.png`
- `mobile-get-paid-guide-expanded-390x844.png`
- `mobile-get-paid-guide-collapsed-390x844.png`
