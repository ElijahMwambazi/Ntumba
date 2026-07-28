# Product

## Promise

**An accountless payment bridge with direct settlement and no merchant balances.**

The merchant is the primary user and does not create an Ntumba account. The payer is an anonymous
guest.

## Directions

1. BTC → BTC pays a merchant-owned invoice directly.
2. BTC → ZMW is designed to collect into operator-controlled Lightning liquidity and then
   disburse from operator mobile-money liquidity.
3. ZMW → BTC is designed to collect into operator mobile-money liquidity and then pay from
   operator-controlled Lightning liquidity.

For conversion directions, Ntumba controls source and destination liquidity during settlement.
Merchants still have no Ntumba account, balance, deposit wallet or synchronized profile.

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

## Exact custody boundary

Direct BTC → BTC goes from payer wallet to merchant wallet and is non-custodial. Conversion is
custodial during settlement because the operator treasury receives the source asset and owes the
destination asset. The current implementation is disabled-by-default deterministic fake
infrastructure with no network calls, real credentials or real funds.

The server can see a destination transiently when it sends that value to a provider. Avoiding
retention is not the same as being unable to see it.

## Non-goals

- Authentication, merchant profiles or cloud-synchronized history.
- Custodial balances, deposit addresses or internal wallets.
- Merchant balances, deposits or stored-value accounts.
- Native mobile applications.
- WhatsApp Business Platform.
- Live provider integrations in the current milestone.
- Legal conclusions or production deployment.
