import type { PaymentDirection, PaymentStatus, SettlementDestination } from "@ntumba/contracts";

export type TreasuryAsset = "BTC" | "ZMW";
export type ExternalOutcome = "success" | "failure" | "timeout" | "unknown";
export type InvoiceState = "pending" | "settled" | "expired" | "failed" | "unknown";
export type CollectionState = "pending" | "settled" | "expired" | "failed" | "unknown";

export interface RailResult<T> {
  outcome: ExternalOutcome;
  value: T | null;
}

export interface BitcoinTreasuryStatus {
  availableBalanceSats: bigint;
  available: boolean;
  inboundCapacitySats: bigint;
  outboundCapacitySats: bigint;
}

export interface BitcoinLiquidityRail {
  createInvoice(input: {
    amountSats: bigint;
    expiresAt: Date;
    idempotencyKey: string;
  }): Promise<RailResult<{ expiresAt: Date; lookupReference: string; paymentRequest: string }>>;
  getInvoiceState(lookupReference: string): Promise<InvoiceState>;
  payInvoice(input: {
    amountSats: bigint;
    idempotencyKey: string;
    paymentRequest: string;
  }): Promise<RailResult<{ lookupReference: string }>>;
  readStatus(): Promise<BitcoinTreasuryStatus>;
}

export interface MobileMoneyTreasuryStatus {
  available: boolean;
  availableBalanceZmwMinor: bigint;
}

export interface MobileMoneyLiquidityRail {
  collect(input: {
    amountZmwMinor: bigint;
    idempotencyKey: string;
  }): Promise<RailResult<{ checkoutUrl: string; lookupReference: string }>>;
  disburse(input: {
    amountZmwMinor: bigint;
    destination: Extract<SettlementDestination, { type: "mobile_money" }>;
    idempotencyKey: string;
  }): Promise<RailResult<{ lookupReference: string }>>;
  getCollectionState(lookupReference: string): Promise<CollectionState>;
  readStatus(): Promise<MobileMoneyTreasuryStatus>;
}

export interface IntegerRateQuote {
  expiresAt: Date;
  rateZmwMinorPerBitcoin: bigint;
}

export interface RateProvider {
  readRate(now: Date): Promise<IntegerRateQuote>;
}

export interface LiquidityReservation {
  amount: bigint;
  asset: TreasuryAsset;
  id: string;
}

export interface LiquidityInventoryService {
  available(asset: TreasuryAsset): bigint;
  commit(reservationId: string): void;
  credit(asset: TreasuryAsset, amount: bigint): void;
  release(reservationId: string): void;
  reserve(input: {
    amount: bigint;
    asset: TreasuryAsset;
    reservationId: string;
  }): LiquidityReservation | null;
  reserved(asset: TreasuryAsset): bigint;
}

export interface SettlementDestinationVault {
  readonly developmentOnly: true;
  delete(token: string): void;
  put(destination: SettlementDestination, expiresAt: Date): string;
  read(token: string, now: Date): SettlementDestination | null;
  purgeExpired(now: Date): number;
}

export type JournalSide = "debit" | "credit";

export interface TreasuryJournalEntry {
  account: string;
  amount: bigint;
  side: JournalSide;
}

export interface TreasuryJournalTransaction {
  asset: TreasuryAsset;
  entries: readonly TreasuryJournalEntry[];
  exchangeGroupId: string;
  id: string;
  idempotencyKey: string;
  kind: "source_collection" | "destination_settlement" | "refund";
  occurredAt: Date;
  opaqueReference: string | null;
}

export interface TreasuryJournal {
  append(
    transaction: Omit<TreasuryJournalTransaction, "id"> & { id?: string },
  ): TreasuryJournalTransaction;
  entries(): readonly TreasuryJournalTransaction[];
}

export interface ReconciliationResult {
  checkedAt: Date;
  outcome: "matched" | "mismatch" | "unavailable";
  safeCode: string | null;
}

export interface ReconciliationService {
  reconcile(settlement: BridgeSettlement, now: Date): Promise<ReconciliationResult>;
}

export interface BridgeSettlement {
  collectionIdempotencyKey: string;
  createdAt: Date;
  destinationAmount: bigint;
  destinationAsset: TreasuryAsset;
  destinationLookupToken: string | null;
  destinationReference: string | null;
  direction: Exclude<PaymentDirection, "btc_to_btc">;
  exchangeGroupId: string;
  expiresAt: Date;
  failureCode: string | null;
  id: string;
  reservationId: string | null;
  settlementAttemptCount: number;
  settlementIdempotencyKey: string;
  sourceAmount: bigint;
  sourceAsset: TreasuryAsset;
  sourceReference: string | null;
  status: Exclude<PaymentStatus, "direct_payment_pending" | "direct_payment_settled">;
  updatedAt: Date;
}

export interface BridgeCreation {
  checkoutUrl: string;
  destinationLookupToken: string;
  expiresAt: Date;
  payerInstructions: string;
  sourceReference: string;
  settlement: BridgeSettlement;
}

export interface BridgeEngine {
  create(input: {
    collectionIdempotencyKey: string;
    destination: SettlementDestination;
    destinationAmount: bigint;
    destinationAsset: TreasuryAsset;
    direction: Exclude<PaymentDirection, "btc_to_btc">;
    expiresAt: Date;
    settlementIdempotencyKey: string;
    sourceAmount: bigint;
    sourceAsset: TreasuryAsset;
  }): Promise<BridgeCreation>;
  expireBeforeSourceSettlement(settlementId: string, now?: Date): BridgeSettlement;
  markSourceOutcome(
    settlementId: string,
    outcome: "pending" | "settled" | "failed" | "timeout" | "unknown",
    now?: Date,
  ): Promise<BridgeSettlement>;
  processDestination(settlementId: string, now?: Date): Promise<BridgeSettlement>;
  read(settlementId: string): BridgeSettlement | undefined;
  readOperationalStatus(): Promise<TreasuryOperationalStatus>;
  requireRefund(settlementId: string, now?: Date): BridgeSettlement;
  retryDestination(settlementId: string, now?: Date): Promise<BridgeSettlement>;
}

export interface TreasuryOperationalStatus {
  bitcoin: BitcoinTreasuryStatus;
  lastSuccessfulReconciliationAt: Date | null;
  manualReview: number;
  mobileMoney: MobileMoneyTreasuryStatus;
  refundRequired: number;
  reservedBtcSats: bigint;
  reservedZmwMinor: bigint;
  unsettledBtcLiabilitySats: bigint;
  unsettledZmwLiabilityMinor: bigint;
  waitingDestinationSettlement: number;
  waitingSourcePayment: number;
}
