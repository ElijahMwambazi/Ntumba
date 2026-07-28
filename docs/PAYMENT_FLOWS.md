# Payment Flows

## Merchant request creation

1. Merchant enters an amount, chooses Mobile Money or Bitcoin to receive and supplies that
   destination. Reference is optional.
2. Ntumba creates the fake-provider options compatible with the receive asset. The merchant does
   not choose the payer method.
3. For bridge directions, the server atomically stages a `created` intent and payload-free outbox
   row, then passes the destination transiently to the fake settlement provider.
4. The provider call uses the durable idempotency key. Ntumba transactionally stores only its
   opaque reference/token and closes the outbox row; a failed request can resume the same staged
   intent when the client resubmits the destination and idempotency key.
5. For direct Bitcoin, the server obtains or passes through a merchant-owned invoice.
6. The server publishes a short-lived checkout projection behind an opaque `publicId`; the
   browser stores a masked local summary behind an unrelated `localId`.
7. The merchant shares `/pay/:publicId`. There is no destination, invoice or checkout payload in
   the URL.

Anyone with the link can open the request while it is retained. The opaque ID is access by
possession, not payment proof. References are presentation data and should not contain secrets.

## Guest method choice

1. Guest opens `/pay/:publicId`.
2. Checkout shows only payer methods supported by the request options.
3. Selecting a method refreshes the public request and presents its amount, rate, fee and
   countdown.
4. One primary action opens provider checkout or reveals the merchant-owned Lightning invoice.
5. Expired options cannot continue. Direct payment stays labelled unverified until evidence
   exists.

## BTC → BTC

1. Guest opens the request.
2. Guest pays the merchant-owned invoice directly.
3. Funds move from payer wallet to merchant wallet without an Ntumba hop.
4. Status remains `direct_payment_pending` until a merchant-wallet integration or independent
   proof can establish `direct_payment_settled`.

## BTC → ZMW

1. Ntumba creates an opaque provider-owned intent using the merchant destination transiently.
2. Guest opens the provider checkout and pays the provider's Lightning request.
3. Provider moves from collecting to settling.
4. Provider sends Kwacha directly to the merchant mobile-money account.
5. Ntumba displays normalized settled, failed, expired, refund or review status.

## ZMW → BTC

1. Ntumba creates an opaque provider-owned intent using the merchant Lightning destination
   transiently.
2. Provider collects mobile money directly from the guest.
3. Provider settles the merchant's external wallet directly.
4. Ntumba displays normalized status.

The payer's mobile number is collected by the provider, not Ntumba.

## Provider callback ingestion

1. The fake provider sends JSON with an HMAC over the timestamp and exact raw request bytes.
2. Ntumba rejects missing, invalid or more-than-five-minute-old signatures before parsing.
3. The adapter normalizes the event in memory and hashes the raw bytes without retaining them.
4. Ntumba matches the opaque provider reference, direction, source/settlement assets and integer
   amounts against the retained intent and quote.
5. A new provider/event ID is appended. An identical retry is acknowledged as a duplicate, while
   the same ID with different bytes is rejected.

This ingestion milestone deliberately leaves `processed_at` empty and does not advance payment
status. Status processing and reconciliation remain separate work so transitions can be applied
transactionally and unknown outcomes can enter manual review.

## State model

```text
created -> provider_collecting -> provider_settling -> settled
created -> direct_payment_pending -> direct_payment_settled
```

Controlled alternatives are `expired`, `failed`, `refund_pending -> refunded` and
`manual_review`. Unknown provider outcomes map to manual review; they must not trigger a second
payment.
