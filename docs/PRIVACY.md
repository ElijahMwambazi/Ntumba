# Privacy and Data Lifecycle

## Merchant device

Versioned IndexedDB may hold an optional display name, preferred asset, remembered mobile-money
destination, Lightning address/invoice, masked locally created request summaries and receipts. It
is not synchronized.

The merchant can select **Clear local data**. Browser clearing, origin changes or device loss also
remove this information and make local history unrecoverable.

If IndexedDB is unavailable, the app reports that clearly and falls back to session-memory
behavior.

The production service worker uses Cache Storage only for an explicit set of public manifest,
icon and generic offline-page assets. It does not cache application routes, public checkout
responses, API responses or IndexedDB records. Offline navigation cannot display a stale payment
status; it asks the user to reconnect for fresh provider confirmation.

## Transient server processing

During public-request and intent creation the API can see the merchant mobile number, Lightning
address or invoice in memory. The fake coordinator places it in a development-only in-memory
`SettlementDestinationVault` with strict expiry and uses only an opaque lookup token elsewhere.
The vault deletes the value after terminal settlement, confirmed source failure or expiry. It does
not write or log the destination.

Production automatic settlement requires either provider-issued opaque beneficiary tokenization
or a reviewed short-lived envelope-encrypted destination store with automatic deletion. The
current vault is non-durable: if it disappears after source settlement, the saga releases unmoved
destination liquidity, creates one durable refund obligation and enters `refund_required`, never
`settled`.

Raw merchant destinations are not placed in route parameters, query strings or URL fragments.

## Persisted server data

- Opaque payment-intent and quote IDs.
- Opaque public request ID, destination lookup token, integer amount, receive asset, safe payer
  option references and creation/expiry/purge timestamps.
- Opaque source/destination references, destination-vault token, leases and idempotency keys.
- Direction, asset identifiers and integer ngwee/satoshi amounts.
- Separate collection/settlement idempotency keys and normalized status.
- Created, updated, expiry and purge timestamps.
- Minimal failure code.
- Provider event ID, payload hash and normalized status.
- Bridge-leg, liquidity-reservation, settlement/refund obligation and reconciliation safe state.
- Per-asset opening/current book balance; provider-event processing count/time, bounded failure
  code and dead-letter time; numbered append-only settlement-attempt outcomes.
- Append-only asset-specific treasury journal transactions with integer debit/credit entries and
  opaque references.

There are no merchant profiles, raw destinations, invoices, payer phone numbers, raw callbacks,
wallet credentials, macaroons or API keys.

## Private operational metrics

The optional internal listener exposes aggregate counts, fake treasury balances/capacities,
reservations/liabilities and safe process state only. Metrics never
contain merchant names/references, phone numbers, Lightning addresses/invoices, public/local IDs,
payment-intent IDs, provider references, destination tokens, idempotency keys or callback bodies.
HTTP labels use registered Fastify route templates rather than raw URLs. Failure and callback
reason labels come from fixed bounded categories. Prometheus stays on the private Compose network;
Grafana binds to host loopback and has no third-party analytics enabled.

## Durable development public requests

Guest checkout uses a short-lived PostgreSQL envelope under an opaque random UUID and marks every
response `developmentOnly`. It contains only an integer amount, receive asset, safe quote options,
an opaque destination lookup token and lifecycle timestamps. It contains no merchant
label/reference, phone, Lightning address/invoice, customer identity or raw provider payload.
Multiple server instances can read it after restart.

This does not make the development destination vault durable. If the envelope survives but the
vault token cannot be resolved, the request becomes unavailable before a payment intent, source
invoice or mobile-money collection is created. Production recovery still requires a reviewed
provider token or encrypted vault.

## Deletion

Development defaults:

- Quotes expire after 60 seconds and purge one hour later.
- Payment intents purge one day after expiry.
- Provider events carry explicit purge timestamps aligned to the associated intent.
- Public request envelopes purge after their explicit retention timestamp.
- Provider-finality grace is one day and is bounded from one minute to seven days.

API access and an hourly job remove only due, terminal, fully resolved operational data. Old
timestamps never override unresolved manual review, refund, reconciliation, reservation, event,
dead-letter or worker-lease state. Immutable treasury journal retention is not governed by the
short-lived intent purge and requires accounting, tax and regulatory review.
Production values cannot be chosen solely for
privacy minimization; they require documented reconciliation with provider, dispute, tax,
accounting and regulatory obligations.

## Public links

Public links contain only `/pay/:publicId`. Anyone possessing a retained, available link can load
its safe checkout envelope, so links remain bearer capabilities. Do not add third-party analytics
to guest checkout.
