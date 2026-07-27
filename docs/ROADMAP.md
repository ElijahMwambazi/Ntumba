# Roadmap

Work from the first relevant unchecked item. Do not combine unrelated payment milestones.

## Phase 0 — Repository foundation

- [x] Pin Node and Yarn with one lockfile.
- [x] Create the modular monolith workspace.
- [x] Add reproducible build, type-check, lint and test commands.
- [x] Add product, architecture, privacy, security and operations documents.
- [ ] Run the entire build and test suite under pinned Node 24.18.0 in CI.
  - [x] Configure GitHub Actions to run `yarn check` and Playwright under the pinned toolchain.
  - [ ] Confirm the first successful GitHub Actions run after the workflow is pushed.
- [x] Add automated dependency and secret scanning.

## Phase 1 — Accountless non-custodial core

- [x] Make quote creation destination-free and integer-only.
- [x] Model provider collection, provider settlement and direct merchant settlement separately.
- [x] Define minimal PostgreSQL quote, intent and normalized event tables.
- [x] Replace development migrations with a clean non-custodial baseline.
- [x] Persist safe quote/payment-intent state with idempotency.
- [x] Add configurable expiry and automatic purge behavior.
- [x] Add provider-direct and merchant-owned Lightning boundaries with safe fakes.
- [ ] Add a signed callback route and append-only normalized provider-event ingestion.
- [ ] Add a transactional outbox for retry-safe provider intent creation.

## Phase 2 — Merchant-first local PWA

- [x] Add merchant get-paid creation at `/`.
- [x] Store destinations, preferences, requests and receipts only in versioned IndexedDB.
- [x] Add QR, copy-link, native-share and fallback behavior.
- [x] Refactor creation to amount, receive asset and destination only.
- [x] Add opaque `/requests/:localId` sharing and `/pay/:publicId` guest checkout.
- [x] Let the guest choose among request-supported payment methods.
- [x] Add local Activity, Settings and confirmed clear-data behavior.
- [x] Add the light-first responsive design system and accessibility baseline.
- [x] Expand Playwright coverage across creation, sharing, checkout and clear-data flows.
- [x] Capture and visually review 390×844 and 1440×900 UI screenshots.
- [ ] Add installable PWA manifest, icons and offline shell.

## Phase 3 — Direct Bitcoin rail

- [ ] Resolve Lightning addresses safely into merchant-owned invoices.
- [ ] Validate invoice amount, network and expiry before sharing.
- [ ] Add merchant-wallet settlement verification or independent payment proof.
- [ ] Issue independently verifiable direct-payment receipts.
- [ ] Decide between free direct payments, merchant subscription or separate service billing.

## Phase 4 — Provider-direct BTC → ZMW pilot

- [ ] Add a live, freshness-checked BTC/ZMW rate adapter.
- [ ] Select a provider contractually capable of collecting Lightning and settling merchant mobile
      money directly.
- [ ] Implement provider quote and intent creation with opaque destination tokens where available.
- [ ] Implement callback verification, status polling, reconciliation and provider-led refunds.
- [ ] Pilot with capped fake-money transactions.
- [ ] Complete security, privacy, legal, regulatory and provider-contract review before real funds.

## Phase 5 — Provider-direct ZMW → BTC pilot

- [ ] Confirm the provider collects payer mobile money and settles the merchant wallet directly.
- [ ] Implement provider-owned checkout and normalized state handling.
- [ ] Test failed settlement, unknown outcomes and provider-led refund paths.
- [ ] Add direction-aware provider limits without Ntumba-controlled liquidity.

## Phase 6 — Solo-operator hardening

- [ ] Add provider and rate circuit breakers.
- [ ] Add automated reconciliation.
- [ ] Add service pause controls and status page.
- [ ] Perform backup restoration, data-purge and incident drills.
- [ ] Measure manual interventions per 100 payments.

## Deferred

- Public API and SDK.
- Native mobile apps.
- USSD.
- Multiple countries and providers.
- Custodial balances.
