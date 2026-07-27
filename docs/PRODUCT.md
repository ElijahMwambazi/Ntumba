# Product

## Promise

**Create a payment request. The payer pays the merchant or settlement provider directly.**

The merchant is the primary user and does not create an Ntumba account. The payer is an anonymous
guest.

## Directions

1. BTC → BTC pays a merchant-owned invoice directly.
2. BTC → ZMW pays an external provider that settles the merchant's mobile money.
3. ZMW → BTC pays an external provider that settles the merchant's external Lightning wallet.

For conversion directions, the external provider owns both collection and merchant settlement.
Ntumba never receives or forwards either leg.

## Merchant experience

The merchant enters a Kwacha amount, optional reference, settlement choice and external
destination. Preferences, recent requests and receipts stay in IndexedDB on that device. Clearing
browser data or losing the device removes local history.

Sharing uses a QR code, copied link or the device-native share sheet. WhatsApp Business Platform,
bots and branded chat integrations are deliberately excluded: they add identity/data retention,
vendor and operational scope without being necessary for ordinary link sharing.

## Amount semantics

All calculations use integer ngwee and satoshis. The payer sees what they send, what the merchant
receives, rate, fee and expiry. The merchant amount is not silently reduced by fees.

## Exact non-custodial boundary

Ntumba creates opaque coordination records and reads normalized provider status. It has no wallet,
treasury, liquidity, payment-gateway balance or unrestricted node credential. A provider may
receive source funds and settle destination funds, but those are provider-controlled flows.

The server can see a destination transiently when it sends that value to a provider. Avoiding
retention is not the same as being unable to see it.

## Non-goals

- Authentication, merchant profiles or cloud-synchronized history.
- Custodial balances, deposit addresses or internal wallets.
- Operator-controlled liquidity or treasury.
- Native mobile applications.
- WhatsApp Business Platform.
- Live provider integrations in the current milestone.
- Legal conclusions or production deployment.
