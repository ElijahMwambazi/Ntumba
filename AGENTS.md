# Ntumba Agent Guide

Ntumba is an accountless, merchant-first payment-request and routing application for Zambia.
Payment safety, privacy, recoverability and operator clarity are product features.

## Non-negotiable architecture

- Ntumba never receives, controls, forwards or reuses payment funds.
- No merchant or payer accounts, authentication, profiles, balances, deposits or internal wallets.
- Bridge payments are collected and settled directly by an external settlement provider.
- Direct Bitcoin uses a merchant-owned Lightning invoice.
- Merchant destinations, preferences, requests and receipts remain in versioned IndexedDB.
- The server may process a destination transiently to create a provider intent, but must not persist
  or log it.
- Persist only opaque references, integer amounts, normalized states, idempotency keys and
  expiry/purge timestamps.
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
- Only fake providers are active. Live provider actions require explicit authorization, reviewed
  contracts and test credentials.

## Expected workflow

1. Read `docs/CURRENT_STATE.md` and `docs/ROADMAP.md`.
2. Work on the first relevant unchecked roadmap item unless the user specifies another.
3. Keep changes focused and update the corresponding documentation.
4. Run `yarn check`.
5. Report verification, remaining risks and the exact next roadmap item.
