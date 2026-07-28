# ADR 0001: Operator-liquidity conversion bridge

- Status: Accepted for fake foundation
- Date: 2026-07-28

## Context

Ntumba originally assumed one external provider would collect the source asset and settle the
merchant destination directly. That boundary avoided operator custody but did not match the
intended integrations: Lipila supplies mobile-money collection/disbursement and balance access,
while a Voltage-hosted LND node supplies Lightning invoices, payments and channel liquidity.
Neither provider owns the complete cross-asset transaction.

Ntumba remains an accountless payment bridge with direct settlement and no merchant balances.
Accountless does not mean non-custodial: during a conversion the operator receives the source
asset and owes the destination asset.

## Decision

Keep BTC → BTC separate and non-custodial. The payer pays a merchant-owned invoice directly;
operator treasury code cannot substitute an operator invoice or pay on this rail.

Model conversion as two explicit legs:

- BTC → ZMW: create an operator-controlled LND invoice, wait for conclusive settlement, then
  disburse from operator Lipila ZMW balance.
- ZMW → BTC: collect into operator Lipila ZMW balance, wait for conclusive settlement, then pay
  the merchant invoice from operator LND BTC balance.

Separate the Bitcoin rail, mobile-money rail, integer rate provider, liquidity inventory,
settlement coordinator, destination vault, append-only treasury journal and reconciliation
service. Reserve destination liquidity before accepting source payment. Use distinct collection
and settlement idempotency keys, reuse the original key on a safe retry, and send unknown outcomes
to manual review.

This milestone provides only a disabled-by-default deterministic fake. Fake Voltage/LND and
Lipila adapters contain no network-call path or real credential. No Voltage, Lipila, sandbox,
mainnet or live configuration mode exists.

## Destination handling

Automatic second-leg execution must temporarily recover the destination. The fake coordinator
uses a development-only in-memory vault with strict expiry, opaque lookup tokens and deletion
after terminal settlement, confirmed source failure or expiry. Destination loss after source
settlement creates `refund_required` or `manual_review`; it can never produce `settled`.

Production must use either provider-issued opaque beneficiary tokenization or a reviewed
short-lived envelope-encrypted destination store with automatic deletion. This ADR does not
approve or implement the encrypted store.

## Journal and reconciliation

Every treasury movement is an immutable debit/credit transaction balanced independently for its
asset. The BTC and ZMW sides of an exchange share an exchange-group identifier but are not balanced
against one another. Persist only integer amounts, opaque references, normalized states and safe
failure codes.

## Consequences and risks

- Ntumba owns liquidity risk: destination inventory or Lightning capacity can be insufficient
  after a quote.
- Ntumba owns failed-second-leg and refund risk after source funds settle.
- Voltage and Lipila introduce availability and counterparty risk, but Lipila is used only as the
  mobile-money liquidity rail; it is not the cross-asset settlement coordinator.
- A stale rate creates market exposure between source collection and destination settlement.
- An unknown external result can strand funds and requires reconciliation before any retry.
- The in-memory destination vault is non-durable and unsuitable for production.
- Operator-controlled funds require treasury security, separation of read-only and fund-moving
  credentials, reconciliation, capital limits, incident response and auditable refunds.

## Launch gates

No real-fund launch is authorized. Before a capped pilot, Ntumba requires least-privilege
credentials, provider-contract and counterparty review, reconciliation and backup drills,
liquidity/rate/refund limits, penetration and privacy testing, and qualified Zambian legal review
covering custody/safeguarding, payment services, AML/KYC, consumer protection, tax and retention.

The next integration is a disabled-by-default Voltage MutinyNet adapter using least-privilege LND
credentials. Lipila sandbox follows; mainnet and real funds remain out of scope.
