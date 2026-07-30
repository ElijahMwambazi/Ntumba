# Roadmap

Work from the first relevant unchecked item. Do not combine unrelated payment milestones.

## Phase 0 — Repository foundation

- [x] Pin Node and Yarn with one lockfile.
- [x] Create the modular monolith workspace.
- [x] Add reproducible build, type-check, lint and test commands.
- [x] Add product, architecture, privacy, security and operations documents.
- [x] Run the entire build and test suite under pinned Node 24.18.0 in CI.
  - [x] Configure GitHub Actions to run `yarn check` and Playwright under the pinned toolchain.
  - [x] Confirm the first successful GitHub Actions run after the workflow is pushed.
- [x] Add automated dependency and secret scanning.

## Phase 1 — Accountless payment core

- [x] Make quote creation destination-free and integer-only.
- [x] Model provider collection, provider settlement and direct merchant settlement separately.
- [x] Define minimal PostgreSQL quote, intent and normalized event tables.
- [x] Replace development migrations with a clean privacy-minimizing baseline.
- [x] Persist safe quote/payment-intent state with idempotency.
- [x] Add configurable expiry and automatic purge behavior.
- [x] Add the original provider-direct and merchant-owned Lightning boundaries with safe fakes.
- [x] Add a signed callback route and append-only normalized provider-event ingestion.
- [x] Add a transactional outbox for retry-safe provider intent creation.

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
- [x] Add installable PWA manifest, icons and offline shell.

## Phase 2.5 — Private operator observability

- [x] Add a disabled-by-default, bearer-protected internal health and metrics listener.
- [x] Export aggregate process, HTTP, payment, callback, outbox, retention and truthful rail-state
      metrics with bounded privacy-safe labels.
- [x] Provision version-pinned Prometheus, conservative alerts and a loopback-only Grafana service
      through the opt-in Compose `ops` profile.
- [x] Provision the read-only **Ntumba Operator** dashboard and first-response runbooks.

## Phase 3 — Operator-liquidity architecture and fake treasury foundation

- [x] Record the hybrid custody decision and retain non-custodial BTC → BTC settlement.
- [x] Split Bitcoin liquidity, mobile-money liquidity, rates, inventory, coordination, destination
      recovery, journal and reconciliation into explicit boundaries.
- [x] Add disabled-by-default deterministic fake Voltage/LND and fake Lipila treasury adapters.
- [x] Enforce source-before-destination, liquidity reservation, leg-specific idempotency,
      unknown-outcome review, safe retry and refund-required invariants in domain tests.
- [x] Add the forward-only two-leg, liquidity, obligation, attempt, immutable-journal,
      reconciliation and refund schema foundation.
- [x] Extend private aggregate metrics and the read-only dashboard with fake treasury state.
- [x] Preserve merchant-owned direct Bitcoin invoices without an operator treasury hop.

## Phase 3.1 — Durable fake settlement saga

- [x] Replace authoritative coordinator memory with focused in-memory and PostgreSQL saga
      repositories for bridges, legs, reservations, obligations, attempts, journals,
      reconciliation, refunds, provider events and destination outbox work.
- [x] Persist payment intent, bridge, both legs, destination reservation, waiting obligation and
      payload-free source outbox atomically before fake source setup.
- [x] Process normalized source events and destination obligations transactionally with row locks,
      leases, immutable balanced journal entries and stable external idempotency keys.
- [x] Recover safely across coordinator restarts, including duplicate callbacks/workers,
      post-external-success crashes and missing in-memory destinations producing one refund
      obligation.
- [x] Separate quote, source-payment, destination-vault and operational retention deadlines.
- [x] Correct fake Voltage/LND and Lipila balance, capacity, duplicate and uncertain-outcome
      behavior while keeping fake mode disabled in production.
- [x] Persist reconciliation mismatches as settled payments with a separate operator-review flag.
- [x] Apply the forward-only durability migration in disposable PostgreSQL and verify constraints,
      journal immutability/balance, rollback and restart scenarios in CI.

## Phase 3.2 — Fund-safety and lifecycle hardening

- [x] Persist opening/current BTC and ZMW inventory, mutate it transactionally with journal
      movements and prevent concurrent over-reservation.
- [x] Account for late conclusive source settlements exactly once and create or resume the correct
      destination/refund obligation without broad terminal-state transitions.
- [x] Make operational retention preserve every unresolved financial state through a bounded
      provider-finality grace while leaving the treasury journal untouched.
- [x] Add bridge-targeted destination claims and isolate poisoned provider events with bounded
      privacy-safe retry/dead-letter metadata.
- [x] Preserve a stable external settlement action with append-only numbered transport-attempt
      events and no automatic retry after timeout/unknown.
- [x] Separate fake adapter instances from simulated remote-provider state and verify restart
      replay, vault loss, rail/capacity gates and operator balance-mismatch visibility.
- [x] Apply and verify the forward-only fund-safety migration and PostgreSQL concurrency,
      late-event, retention, claim, dead-letter, attempt-history and restart scenarios.

## Phase 3.3 — Pre-integration reliability gate

- [x] Isolate retry/dead-letter metadata to the exact failed provider event under concurrent
      workers, with row-locked recheck and bounded non-recursive event skipping.
- [x] Terminalize conclusive source failures across the source leg, destination obligation and
      reservation while preserving late-source, finality-grace and immutable-journal behavior.
- [x] Persist a privacy-minimizing public checkout envelope in PostgreSQL, defer source setup until
      payer confirmation and fail closed when the separate non-durable destination vault is lost.
- [x] Apply and verify the forward-only reliability migration, full PostgreSQL concurrency and
      retention suite, API privacy cases and mobile/desktop payer journeys.

## Phase 4 — Controlled rail integrations

- [ ] Add a disabled-by-default Voltage MutinyNet adapter using least-privilege LND credentials
      limited to invoice creation/read and invoice payment; prohibit admin and wallet-unlock
      credentials.
- [ ] Resolve Lightning addresses safely into merchant-owned direct-payment invoices and validate
      invoice amount, network and expiry.
- [ ] Add merchant-wallet settlement verification or independent proof for direct Bitcoin and
      issue independently verifiable receipts.
- [ ] Add a disabled-by-default Lipila sandbox adapter for mobile-money collection, disbursement
      and read-only balance/availability.
- [ ] Add a live, freshness-checked integer BTC/ZMW rate adapter behind a fail-closed gate.

## Phase 5 — Cross-rail settlement saga and refunds

- [ ] Adapt the durable saga to verified Voltage and Lipila state, finality and idempotency
      semantics.
- [ ] Add provider-side status polling for callbacks, unknown outcomes and worker recovery.
- [ ] Replace the development vault with provider-issued opaque beneficiary tokens or a reviewed,
      short-lived envelope-encrypted store with automatic deletion and production recovery.
- [ ] Implement reviewed, idempotent real refund execution against verified source-rail semantics.
- [ ] Implement real provider reconciliation and recovery from provider-specific unknown outcomes.

## Phase 6 — Automated reconciliation and treasury dashboard

- [ ] Reconcile operator LND and Lipila movements to the immutable asset-specific journal.
- [ ] Add liquidity and rate circuit breakers with reviewed service-pause controls outside Grafana.
- [ ] Add real rail freshness, capacity, liability and mismatch alerts backed by evidence.
- [ ] Perform backup restoration, journal verification, data-purge and incident drills.
- [ ] Measure liquidity shortfalls, second-leg failures and manual interventions per 100 payments.

## Phase 7 — Security, compliance and capped real-money pilot

- [ ] Complete custody, safeguarding, AML/KYC, consumer, privacy, tax and record-retention review
      with qualified Zambian counsel.
- [ ] Complete provider-contract, credential, callback, penetration and incident-response reviews.
- [ ] Establish capital, channel, mobile-money, refund and loss limits.
- [ ] Run a capped test-money pilot before requesting separate authorization for real funds.
- [ ] Add a public status page separated from private operator metrics.

## Deferred

- Public API and SDK.
- Native mobile apps.
- USSD.
- Multiple countries and providers.
- Merchant balances, deposit wallets or stored-value accounts.
