# Payment Flows

## Merchant request creation

1. Merchant enters an amount, chooses Mobile Money or Bitcoin to receive and supplies that
   destination. Reference is optional.
2. Ntumba creates the fake-provider options compatible with the receive asset. The merchant does
   not choose the payer method.
3. For bridge directions, the server passes the destination transiently to the fake settlement
   provider and retains only its opaque reference/token.
4. For direct Bitcoin, the server obtains or passes through a merchant-owned invoice.
5. The server publishes a short-lived checkout projection behind an opaque `publicId`; the
   browser stores a masked local summary behind an unrelated `localId`.
6. The merchant shares `/pay/:publicId`. There is no destination, invoice or checkout payload in
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

## State model

```text
created -> provider_collecting -> provider_settling -> settled
created -> direct_payment_pending -> direct_payment_settled
```

Controlled alternatives are `expired`, `failed`, `refund_pending -> refunded` and
`manual_review`. Unknown provider outcomes map to manual review; they must not trigger a second
payment.
