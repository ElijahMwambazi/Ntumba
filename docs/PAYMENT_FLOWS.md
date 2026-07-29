# Payment Flows

## Merchant request creation

1. Merchant enters an amount, chooses Mobile Money or Bitcoin to receive and supplies that
   destination. Reference is optional.
2. Ntumba creates fake-treasury options compatible with the receive asset. The merchant does
   not choose the payer method.
3. For bridge directions, the server atomically stages the intent, bridge, two legs, destination
   reservation, waiting obligation and payload-free source outbox after locking durable
   destination inventory. It also checks source-rail availability and applicable Lightning
   inbound/outbound or mobile-money capacity before presenting checkout. It then places the
   destination in its development-only vault before preparing source collection outside the
   transaction.
4. Collection and settlement use separate idempotency keys. Ntumba stores only opaque
   references/tokens. Conclusive setup failure releases safely; timeout or unknown preserves the
   original collection action in manual review without blind retry.
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
4. One primary action opens simulated source collection or reveals the merchant-owned Lightning
   invoice.
5. Expired options cannot continue. Direct payment stays labelled unverified until evidence
   exists.

## BTC → BTC

1. Guest opens the request.
2. Guest pays the merchant-owned invoice directly.
3. Funds move from payer wallet to merchant wallet without an Ntumba hop.
4. Status remains `direct_payment_pending` until a merchant-wallet integration or independent
   proof can establish `direct_payment_settled`.

## BTC → ZMW

1. The coordinator reserves fake operator ZMW inventory and vaults the mobile-money destination.
2. The fake Voltage/LND treasury creates an operator-owned Lightning invoice.
3. Only after that invoice is conclusively settled is destination settlement queued.
4. The fake Lipila treasury disburses ZMW from simulated operator balance to the merchant.
5. Source and destination journal transactions share an exchange link but balance independently
   in BTC and ZMW.
6. Unknown outcomes enter manual review. A missing destination after source settlement enters
   `refund_required`, never `settled`.

## ZMW → BTC

1. The coordinator reserves fake operator BTC inventory and vaults the merchant Lightning
   destination.
2. The fake Lipila treasury collects ZMW into simulated operator balance.
3. Only after collection is conclusively settled is destination settlement queued.
4. The fake Voltage/LND treasury pays the merchant invoice from simulated operator BTC balance.
5. Confirmed destination failure may retry only with its original settlement key; timeout or
   unknown outcome enters manual review without a blind retry.

The payer's mobile number is collected by the provider, not Ntumba.

## Provider callback ingestion

1. The fake treasury event verifier receives JSON with an HMAC over the timestamp and exact raw
   request bytes.
2. Ntumba rejects missing, invalid or more-than-five-minute-old signatures before parsing.
3. The adapter normalizes the event in memory and hashes the raw bytes without retaining them.
4. Ntumba matches the opaque provider reference, direction, source/settlement assets and integer
   amounts against the retained intent and quote.
5. A new provider/event ID is appended. An identical retry is acknowledged as a duplicate, while
   the same ID with different bytes is rejected.

A PostgreSQL worker row-locks an unprocessed event and atomically advances source state, journal,
obligation, destination outbox and `processed_at`. A leased destination worker records its attempt
before the fake rail call and transactionally finalizes the result afterward.

If source settlement becomes conclusive after expiry or conclusive source failure, the worker
journals and credits the source exactly once, creates one refund obligation and never initiates the
destination. A conclusive settlement after a source-unknown callback may resume destination work
only while the destination token, reservation and deadline remain valid. Duplicate settled events
make no second journal, inventory, refund, queue or payment change.

One poisoned event is retried with bounded backoff using a fixed safe failure code. It is then
dead-lettered for manual review while later unrelated events continue. Destination retries claim
their requested bridge rather than the global queue, reuse the same external idempotency key and
append a new numbered transport attempt only after conclusive failure.

## State model

```text
created -> quote_locked -> awaiting_source_payment -> source_payment_confirming
        -> source_payment_settled -> destination_settlement_queued
        -> destination_settlement_processing -> settled
created -> direct_payment_pending -> direct_payment_settled
```

Controlled alternatives are `expired`, `source_payment_failed`,
`destination_settlement_failed`, `liquidity_unavailable`, `rate_expired`, `refund_required`,
`refund_pending -> refunded` and `manual_review`. Unknown outcomes map to manual review and must
not trigger a second payment. Safe expiry or confirmed failure releases the reservation.
