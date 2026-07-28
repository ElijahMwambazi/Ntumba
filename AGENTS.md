# Ntumba Agent Guide

Ntumba is an accountless, merchant-first payment-request and routing application for Zambia.
Payment safety, privacy, recoverability and operator clarity are product features.

## Non-negotiable architecture

- Ntumba is an accountless payment bridge with direct settlement and no merchant balances.
- No merchant or payer accounts, authentication, profiles, balances, deposits or internal wallets.
- Direct BTC → BTC uses a merchant-owned Lightning invoice. Ntumba never receives or forwards
  funds on that rail; only this rail is non-custodial.
- Conversion bridges use operator-controlled source and destination liquidity. BTC → ZMW collects
  to the operator Lightning treasury before mobile-money disbursement; ZMW → BTC collects to the
  operator mobile-money treasury before an outgoing Lightning payment.
- Source collection and destination settlement are separate legs. Reserve destination liquidity
  before accepting source payment and never start destination settlement until source settlement
  is conclusive.
- Unknown outcomes enter manual review and are never blindly retried. Confirmed retries reuse the
  original leg idempotency key; collection and settlement keys must be distinct.
- Merchant destinations, preferences, requests and receipts remain in versioned IndexedDB.
- The server may recover a destination transiently through the `SettlementDestinationVault`, but
  must not persist or log it. The current vault is development-only, in-memory and expiring.
- Persist only opaque references, integer amounts, normalized states, idempotency keys and
  expiry/purge timestamps.
- Treasury journals are append-only, debit/credit balanced independently per asset and link the
  BTC and ZMW sides of an exchange without treating them as one balanced transaction.
- Store ZMW as integer ngwee and Bitcoin as integer satoshis or millisatoshis. Never use
  floating-point money arithmetic.
- Never store raw provider callback bodies. Verify and normalize them in memory.
- Keep explicit expired, failed, refund-pending, refunded and manual-review states.
- Sharing uses QR, copy-link and the device Web Share API. Do not add WhatsApp integrations.

## Working rules

- Use Yarn only. Never create `package-lock.json` or `pnpm-lock.yaml`.
- Keep the modular monolith unless a measured production constraint requires more.
- All provider calls require idempotency keys, opaque references and safe retry behavior.
- Provider-intent outbox rows must remain payload-free. Retry with the same provider idempotency
  key and a transient client-supplied destination unless a reviewed provider supplies an opaque
  destination token that is safe to persist.
- Do not expose destinations, invoices, provider credentials or callback bodies in logs or errors.
- The bridge engine defaults to disabled. Only deterministic fake treasury adapters are available.
  Live rail work requires an explicit roadmap milestone, reviewed contracts and test credentials.
- Never introduce selectable `voltage`, `lipila`, `sandbox`, `mainnet` or `live` modes while the
  fake-only gate is in force.
- Keep operator health/metrics on the disabled-by-default internal listener. Never add operator
  routes or credentials to the merchant PWA or public API listener.
- Metrics use aggregate counts, bounded labels and registered route templates only. Never label or
  log merchant/payer data, payment/public/local IDs, opaque provider references or callback bodies.

## Expected workflow

1. Read `docs/CURRENT_STATE.md` and `docs/ROADMAP.md`.
2. Work on the first relevant unchecked roadmap item unless the user specifies another.
3. Keep changes focused and update the corresponding documentation.
4. Run `yarn check`.
5. Report verification, remaining risks and the exact next roadmap item.
