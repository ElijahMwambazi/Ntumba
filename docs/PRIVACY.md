# Privacy and Data Lifecycle

## Merchant device

Versioned IndexedDB may hold an optional display name, preferred asset, remembered mobile-money
destination, Lightning address/invoice, masked locally created request summaries and receipts. It
is not synchronized.

The merchant can select **Clear local data**. Browser clearing, origin changes or device loss also
remove this information and make local history unrecoverable.

If IndexedDB is unavailable, the app reports that clearly and falls back to session-memory
behavior.

## Transient server processing

During intent creation the API can see the merchant mobile number, Lightning address or invoice in
memory and sends it to the selected provider adapter. It does not write those values to PostgreSQL
or application logs. For ZMW → BTC, the provider—not Ntumba—collects payer mobile details.

Raw merchant destinations are not placed in route parameters, query strings or URL fragments.

## Persisted server data

- Opaque payment-intent and quote IDs.
- Opaque provider reference and destination token.
- Direction, asset identifiers and integer ngwee/satoshi amounts.
- Idempotency key and normalized status.
- Created, updated, expiry and purge timestamps.
- Minimal failure code.
- Provider event ID, payload hash and normalized status.

There are no merchant profiles, raw destinations, invoices, payer phone numbers or raw callbacks.

## Development public requests

Guest checkout needs a short-lived presentation projection. The current implementation keeps it
only in server process memory under an opaque UUID and marks every response `developmentOnly`.
It contains amount, receive asset, optional merchant label/reference and safe payment-option
outputs. It does not contain the raw destination. It disappears on restart, cannot span multiple
instances and must be replaced with a reviewed durable design before deployment.

## Deletion

Development defaults:

- Quotes expire after 60 seconds and purge one hour later.
- Payment intents purge one day after expiry.
- Provider events carry explicit purge timestamps aligned to the associated intent.

API access and an hourly job remove due data. Production values cannot be chosen solely for
privacy minimization; they require documented reconciliation with provider, dispute, tax,
accounting and regulatory obligations.

## Public links

Public links contain only `/pay/:publicId`. Anyone possessing a retained link can load its public
checkout projection, including optional merchant label/reference, so do not put secrets or
unnecessary personal data in references. Do not add third-party analytics to guest checkout.
