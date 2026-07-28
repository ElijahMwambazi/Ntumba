# Testing

## Layers

- Domain tests cover integer money, direction-aware fees, legal states and retention windows.
- Provider tests cover deterministic idempotency, provider-direct output, signed callback
  normalization/timestamp rejection and merchant-invoice pass-through.
- API tests use Fastify injection with an in-memory safe-state repository, including raw callback
  signature, intent matching, duplicate and privacy behavior. Failure injection proves a pending
  provider-intent outbox resumes with the same idempotency key after a provider timeout.
- Storage tests cover schema-version serialization, loading, deletion, v1 migration and
  session-memory fallback.
- Sharing tests cover native Web Share and unavailable fallback.
- Presentation tests cover payer-method capabilities, destination masking, expiry and explicit
  unverified direct-payment copy.
- Repository architecture tests parse TypeScript structure to reject personal/raw columns and
  custodial provider methods.
- PWA asset tests validate manifest metadata, icon dimensions, build output and the service-worker
  cache boundary. A production Playwright run installs that worker, checks its exact cache contents
  and proves offline navigation uses the reconnect-only shell.
- Observability tests cover default disablement, strong-token configuration, constant-scope bearer
  access, database failure redaction, exact aggregate store counts, bounded metric labels, raw-URL
  rejection, callback/purge counters and explicit fake/unavailable rail semantics.
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

`yarn db:generate` validates the Drizzle model and migration generation. Applying the migration
requires a known development PostgreSQL database.

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
- Duplicate idempotency key returns one logical provider intent.
- Provider failure leaves one staged intent and payload-free outbox row; retry completes that same
  intent without persisting the destination.
- Destination is absent from stored intent and response.
- Raw callback body is verified in memory and only a hash/normalized event can persist.
- Stale/tampered signatures, amount mismatches and conflicting event-ID replays cannot persist.
- Provider collection cannot skip provider settlement.
- Direct invoice is merchant-owned and is never substituted.
- Direct settlement remains unverified without evidence.
- Expired quotes cannot create intents; due data is purged.
- Unknown outcomes enter manual review.
- Provider failure/refund states remain explicit.
- IndexedDB unavailable and native-share unavailable both have user-visible fallback behavior.
- The merchant form never asks how the customer will pay.
- The guest checkout has no merchant navigation and exposes only supported payment methods.
- Request links use opaque public IDs and contain no URL-fragment destination payload.
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
- Metrics contain only aggregates and bounded labels, use registered route templates and render
  fake/not-configured states rather than invented health, capacity or liquidity.
- Compose keeps Prometheus and port 9091 private while binding Grafana only to `127.0.0.1`.

## Browser scenarios and artifacts

`tests/e2e/merchant.spec.ts` covers:

- Merchant creation, opaque sharing, copy feedback, guest payer choice and local Activity.
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
