import { createHash, randomUUID } from "node:crypto";
import type { SettlementDestination } from "@ntumba/contracts";
import { assertTransition } from "@ntumba/domain";
import type {
  BitcoinLiquidityRail,
  BridgeCreation,
  BridgeEngine,
  BridgeSettlement,
  LiquidityInventoryService,
  MobileMoneyLiquidityRail,
  ReconciliationService,
  SettlementDestinationVault,
  TreasuryJournal,
  TreasuryOperationalStatus,
} from "./types.js";

export class LiquidityUnavailableError extends Error {
  constructor() {
    super("Destination liquidity is unavailable.");
    this.name = "LiquidityUnavailableError";
  }
}

export class BridgeSourceSetupError extends Error {
  constructor(readonly safeCode: "SOURCE_SETUP_FAILED" | "SOURCE_SETUP_UNCERTAIN") {
    super("The fake bridge source leg could not be prepared.");
    this.name = "BridgeSourceSetupError";
  }
}

function fakeLightningInvoiceFor(destination: SettlementDestination): string {
  if (destination.type === "lightning_invoice") {
    return destination.invoice;
  }
  if (destination.type !== "lightning_address") {
    throw new Error("The destination is not compatible with Bitcoin settlement.");
  }
  const suffix = createHash("sha256").update(destination.address).digest("hex").slice(0, 24);
  return `lntb1n1fakeaddress${suffix}`;
}

function creationFingerprint(input: {
  collectionIdempotencyKey: string;
  destination: SettlementDestination;
  destinationAmount: bigint;
  destinationAsset: "BTC" | "ZMW";
  direction: "btc_to_zmw" | "zmw_to_btc";
  expiresAt: Date;
  settlementIdempotencyKey: string;
  sourceAmount: bigint;
  sourceAsset: "BTC" | "ZMW";
}): string {
  const destination =
    input.destination.type === "mobile_money"
      ? `mobile_money:${input.destination.network}:${input.destination.phone}`
      : input.destination.type === "lightning_address"
        ? `lightning_address:${input.destination.address}`
        : `lightning_invoice:${input.destination.invoice}`;
  return createHash("sha256")
    .update(
      [
        input.collectionIdempotencyKey,
        input.settlementIdempotencyKey,
        input.direction,
        input.sourceAsset,
        input.sourceAmount.toString(),
        input.destinationAsset,
        input.destinationAmount.toString(),
        input.expiresAt.toISOString(),
        destination,
      ].join("\u0000"),
    )
    .digest("hex");
}

export class FakeSettlementCoordinator implements BridgeEngine {
  readonly #bitcoin: BitcoinLiquidityRail;
  readonly #creationFingerprintsByCollectionKey = new Map<string, string>();
  readonly #creationsByCollectionKey = new Map<string, BridgeCreation>();
  readonly #inventory: LiquidityInventoryService;
  readonly #journal: TreasuryJournal;
  #lastSuccessfulReconciliationAt: Date | null = null;
  readonly #mobileMoney: MobileMoneyLiquidityRail;
  readonly #reconciliation: ReconciliationService;
  readonly #settlements = new Map<string, BridgeSettlement>();
  readonly #vault: SettlementDestinationVault;

  constructor(dependencies: {
    bitcoin: BitcoinLiquidityRail;
    inventory: LiquidityInventoryService;
    journal: TreasuryJournal;
    mobileMoney: MobileMoneyLiquidityRail;
    reconciliation: ReconciliationService;
    vault: SettlementDestinationVault;
  }) {
    this.#bitcoin = dependencies.bitcoin;
    this.#inventory = dependencies.inventory;
    this.#journal = dependencies.journal;
    this.#mobileMoney = dependencies.mobileMoney;
    this.#reconciliation = dependencies.reconciliation;
    this.#vault = dependencies.vault;
  }

  private transition(
    settlement: BridgeSettlement,
    status: BridgeSettlement["status"],
    now: Date,
    failureCode: string | null = settlement.failureCode,
  ): BridgeSettlement {
    assertTransition(settlement.status, status);
    const updated = { ...settlement, failureCode, status, updatedAt: now };
    this.#settlements.set(updated.id, updated);
    return updated;
  }

  async create(input: {
    collectionIdempotencyKey: string;
    destination: SettlementDestination;
    destinationAmount: bigint;
    destinationAsset: "BTC" | "ZMW";
    direction: "btc_to_zmw" | "zmw_to_btc";
    expiresAt: Date;
    settlementIdempotencyKey: string;
    sourceAmount: bigint;
    sourceAsset: "BTC" | "ZMW";
  }): Promise<BridgeCreation> {
    if (input.collectionIdempotencyKey === input.settlementIdempotencyKey) {
      throw new Error("Collection and settlement require separate idempotency keys.");
    }
    const fingerprint = creationFingerprint(input);
    const existing = this.#creationsByCollectionKey.get(input.collectionIdempotencyKey);
    if (existing) {
      if (
        this.#creationFingerprintsByCollectionKey.get(input.collectionIdempotencyKey) !==
        fingerprint
      ) {
        throw new Error("Bridge idempotency conflict.");
      }
      return existing;
    }
    if (
      input.sourceAmount <= 0n ||
      input.destinationAmount <= 0n ||
      (input.direction === "btc_to_zmw" &&
        (input.sourceAsset !== "BTC" ||
          input.destinationAsset !== "ZMW" ||
          input.destination.type !== "mobile_money")) ||
      (input.direction === "zmw_to_btc" &&
        (input.sourceAsset !== "ZMW" ||
          input.destinationAsset !== "BTC" ||
          input.destination.type === "mobile_money"))
    ) {
      throw new Error("Bridge direction, destination and integer amounts are inconsistent.");
    }

    const now = new Date();
    const id = randomUUID();
    const exchangeGroupId = randomUUID();
    const reservationId = `bridge-reservation:${id}`;
    let settlement: BridgeSettlement = {
      collectionIdempotencyKey: input.collectionIdempotencyKey,
      createdAt: now,
      destinationAmount: input.destinationAmount,
      destinationAsset: input.destinationAsset,
      destinationLookupToken: null,
      destinationReference: null,
      direction: input.direction,
      exchangeGroupId,
      expiresAt: input.expiresAt,
      failureCode: null,
      id,
      reservationId: null,
      settlementAttemptCount: 0,
      settlementIdempotencyKey: input.settlementIdempotencyKey,
      sourceAmount: input.sourceAmount,
      sourceAsset: input.sourceAsset,
      sourceReference: null,
      status: "created",
      updatedAt: now,
    };
    this.#settlements.set(id, settlement);

    const reservation = this.#inventory.reserve({
      amount: input.destinationAmount,
      asset: input.destinationAsset,
      reservationId,
    });
    if (!reservation) {
      settlement = this.transition(
        settlement,
        "liquidity_unavailable",
        now,
        "LIQUIDITY_UNAVAILABLE",
      );
      throw new LiquidityUnavailableError();
    }
    settlement = {
      ...this.transition(settlement, "quote_locked", now),
      reservationId: reservation.id,
    };
    this.#settlements.set(id, settlement);
    const destinationLookupToken = this.#vault.put(input.destination, input.expiresAt);
    settlement = { ...settlement, destinationLookupToken };
    this.#settlements.set(id, settlement);

    const source =
      input.direction === "btc_to_zmw"
        ? await this.#bitcoin.createInvoice({
            amountSats: input.sourceAmount,
            expiresAt: input.expiresAt,
            idempotencyKey: input.collectionIdempotencyKey,
          })
        : await this.#mobileMoney.collect({
            amountZmwMinor: input.sourceAmount,
            idempotencyKey: input.collectionIdempotencyKey,
          });

    if (source.outcome !== "success" || !source.value) {
      if (source.outcome === "failure") {
        this.#inventory.release(reservationId);
        this.#vault.delete(destinationLookupToken);
        this.transition(settlement, "source_payment_failed", now, "SOURCE_SETUP_FAILED");
        throw new BridgeSourceSetupError("SOURCE_SETUP_FAILED");
      }
      this.transition(settlement, "manual_review", now, "SOURCE_SETUP_UNCERTAIN");
      throw new BridgeSourceSetupError("SOURCE_SETUP_UNCERTAIN");
    }

    const sourceReference = source.value.lookupReference;
    settlement = {
      ...this.transition(settlement, "awaiting_source_payment", now),
      destinationLookupToken,
      sourceReference,
    };
    this.#settlements.set(id, settlement);
    const checkoutUrl =
      input.direction === "btc_to_zmw"
        ? `https://treasury.invalid/lightning/${sourceReference}`
        : "checkoutUrl" in source.value
          ? source.value.checkoutUrl
          : "https://treasury.invalid/mobile-money";
    const creation: BridgeCreation = {
      checkoutUrl,
      destinationLookupToken,
      expiresAt: input.expiresAt,
      payerInstructions:
        input.direction === "btc_to_zmw"
          ? "Pay the simulated operator Lightning invoice."
          : "Approve the simulated Lipila mobile-money collection.",
      sourceReference,
      settlement,
    };
    this.#creationsByCollectionKey.set(input.collectionIdempotencyKey, creation);
    this.#creationFingerprintsByCollectionKey.set(input.collectionIdempotencyKey, fingerprint);
    return creation;
  }

  read(settlementId: string): BridgeSettlement | undefined {
    return this.#settlements.get(settlementId);
  }

  expireBeforeSourceSettlement(settlementId: string, now = new Date()): BridgeSettlement {
    const settlement = this.required(settlementId);
    if (
      settlement.status !== "awaiting_source_payment" &&
      settlement.status !== "source_payment_confirming"
    ) {
      throw new Error("Only an unsettled source leg can expire safely.");
    }
    if (settlement.expiresAt.getTime() > now.getTime()) {
      throw new Error("The source leg has not expired.");
    }
    if (settlement.reservationId) {
      this.#inventory.release(settlement.reservationId);
    }
    if (settlement.destinationLookupToken) {
      this.#vault.delete(settlement.destinationLookupToken);
    }
    return this.transition(settlement, "expired", now, "SOURCE_EXPIRED");
  }

  async markSourceOutcome(
    settlementId: string,
    outcome: "pending" | "settled" | "failed" | "timeout" | "unknown",
    now = new Date(),
  ): Promise<BridgeSettlement> {
    let settlement = this.required(settlementId);
    if (
      [
        "source_payment_settled",
        "destination_settlement_queued",
        "destination_settlement_processing",
        "settled",
        "refund_required",
        "refund_pending",
        "refunded",
      ].includes(settlement.status)
    ) {
      return settlement;
    }
    if (
      settlement.status !== "awaiting_source_payment" &&
      settlement.status !== "source_payment_confirming"
    ) {
      throw new Error("Source outcome is not legal in the current bridge state.");
    }
    if (outcome === "pending") {
      return settlement.status === "source_payment_confirming"
        ? settlement
        : this.transition(settlement, "source_payment_confirming", now);
    }
    if (outcome === "failed") {
      if (settlement.reservationId) {
        this.#inventory.release(settlement.reservationId);
      }
      if (settlement.destinationLookupToken) {
        this.#vault.delete(settlement.destinationLookupToken);
      }
      return this.transition(settlement, "source_payment_failed", now, "SOURCE_PAYMENT_FAILED");
    }
    if (outcome === "timeout" || outcome === "unknown") {
      return this.transition(settlement, "manual_review", now, "SOURCE_OUTCOME_UNKNOWN");
    }

    settlement = this.transition(settlement, "source_payment_settled", now);
    this.#inventory.credit(settlement.sourceAsset, settlement.sourceAmount);
    this.#journal.append({
      asset: settlement.sourceAsset,
      entries: [
        { account: "treasury_asset", amount: settlement.sourceAmount, side: "debit" },
        { account: "source_collection_clearing", amount: settlement.sourceAmount, side: "credit" },
      ],
      exchangeGroupId: settlement.exchangeGroupId,
      idempotencyKey: `${settlement.collectionIdempotencyKey}:journal`,
      kind: "source_collection",
      occurredAt: now,
      opaqueReference: settlement.sourceReference,
    });
    return this.transition(settlement, "destination_settlement_queued", now);
  }

  async processDestination(settlementId: string, now = new Date()): Promise<BridgeSettlement> {
    let settlement = this.required(settlementId);
    if (settlement.status === "settled") {
      return settlement;
    }
    if (settlement.status !== "destination_settlement_queued") {
      throw new Error("Destination settlement requires conclusive source settlement.");
    }
    const destination =
      settlement.destinationLookupToken === null
        ? null
        : this.#vault.read(settlement.destinationLookupToken, now);
    if (!destination) {
      if (settlement.reservationId) {
        this.#inventory.release(settlement.reservationId);
      }
      return this.transition(settlement, "refund_required", now, "DESTINATION_UNAVAILABLE");
    }

    settlement = this.transition(settlement, "destination_settlement_processing", now);
    settlement = {
      ...settlement,
      settlementAttemptCount: settlement.settlementAttemptCount + 1,
    };
    this.#settlements.set(settlement.id, settlement);
    const result =
      settlement.direction === "btc_to_zmw"
        ? destination.type === "mobile_money"
          ? await this.#mobileMoney.disburse({
              amountZmwMinor: settlement.destinationAmount,
              destination,
              idempotencyKey: settlement.settlementIdempotencyKey,
            })
          : { outcome: "failure" as const, value: null }
        : await this.#bitcoin.payInvoice({
            amountSats: settlement.destinationAmount,
            idempotencyKey: settlement.settlementIdempotencyKey,
            paymentRequest: fakeLightningInvoiceFor(destination),
          });

    if (result.outcome === "timeout" || result.outcome === "unknown") {
      return this.transition(settlement, "manual_review", now, "DESTINATION_OUTCOME_UNKNOWN");
    }
    if (result.outcome === "failure" || !result.value) {
      if (settlement.reservationId) {
        this.#inventory.release(settlement.reservationId);
      }
      return this.transition(
        settlement,
        "destination_settlement_failed",
        now,
        "DESTINATION_SETTLEMENT_FAILED",
      );
    }

    if (!settlement.reservationId) {
      throw new Error("Destination settlement has no liquidity reservation.");
    }
    this.#inventory.commit(settlement.reservationId);
    this.#journal.append({
      asset: settlement.destinationAsset,
      entries: [
        {
          account: "destination_settlement_clearing",
          amount: settlement.destinationAmount,
          side: "debit",
        },
        {
          account: "treasury_asset",
          amount: settlement.destinationAmount,
          side: "credit",
        },
      ],
      exchangeGroupId: settlement.exchangeGroupId,
      idempotencyKey: `${settlement.settlementIdempotencyKey}:journal`,
      kind: "destination_settlement",
      occurredAt: now,
      opaqueReference: result.value.lookupReference,
    });
    if (settlement.destinationLookupToken) {
      this.#vault.delete(settlement.destinationLookupToken);
    }
    settlement = {
      ...settlement,
      destinationReference: result.value.lookupReference,
    };
    this.#settlements.set(settlement.id, settlement);
    const reconciled = await this.#reconciliation.reconcile(settlement, now);
    if (reconciled.outcome === "matched") {
      this.#lastSuccessfulReconciliationAt = reconciled.checkedAt;
    }
    return this.transition(settlement, "settled", now);
  }

  async retryDestination(settlementId: string, now = new Date()): Promise<BridgeSettlement> {
    let settlement = this.required(settlementId);
    if (settlement.status !== "destination_settlement_failed") {
      throw new Error("Only a conclusively failed destination settlement can be retried.");
    }
    if (!settlement.reservationId) {
      throw new Error("Destination retry has no reservation identity.");
    }
    const reservation = this.#inventory.reserve({
      amount: settlement.destinationAmount,
      asset: settlement.destinationAsset,
      reservationId: settlement.reservationId,
    });
    if (!reservation) {
      const unavailable = {
        ...settlement,
        failureCode: "LIQUIDITY_UNAVAILABLE",
        updatedAt: now,
      };
      this.#settlements.set(unavailable.id, unavailable);
      return unavailable;
    }
    settlement = this.transition(settlement, "destination_settlement_queued", now);
    return this.processDestination(settlement.id, now);
  }

  requireRefund(settlementId: string, now = new Date()): BridgeSettlement {
    const settlement = this.required(settlementId);
    if (settlement.reservationId) {
      this.#inventory.release(settlement.reservationId);
    }
    if (settlement.destinationLookupToken) {
      this.#vault.delete(settlement.destinationLookupToken);
    }
    return this.transition(settlement, "refund_required", now, "REFUND_REQUIRED");
  }

  async readOperationalStatus(): Promise<TreasuryOperationalStatus> {
    const active = [...this.#settlements.values()];
    const liability = (asset: "BTC" | "ZMW") =>
      active
        .filter(
          (item) =>
            item.destinationAsset === asset &&
            ![
              "settled",
              "refunded",
              "source_payment_failed",
              "expired",
              "liquidity_unavailable",
            ].includes(item.status),
        )
        .reduce((total, item) => total + item.destinationAmount, 0n);
    return {
      bitcoin: await this.#bitcoin.readStatus(),
      lastSuccessfulReconciliationAt: this.#lastSuccessfulReconciliationAt,
      manualReview: active.filter((item) => item.status === "manual_review").length,
      mobileMoney: await this.#mobileMoney.readStatus(),
      refundRequired: active.filter((item) => item.status === "refund_required").length,
      reservedBtcSats: this.#inventory.reserved("BTC"),
      reservedZmwMinor: this.#inventory.reserved("ZMW"),
      unsettledBtcLiabilitySats: liability("BTC"),
      unsettledZmwLiabilityMinor: liability("ZMW"),
      waitingDestinationSettlement: active.filter((item) =>
        [
          "source_payment_settled",
          "destination_settlement_queued",
          "destination_settlement_processing",
          "destination_settlement_failed",
        ].includes(item.status),
      ).length,
      waitingSourcePayment: active.filter((item) =>
        ["awaiting_source_payment", "source_payment_confirming"].includes(item.status),
      ).length,
    };
  }

  private required(settlementId: string): BridgeSettlement {
    const settlement = this.#settlements.get(settlementId);
    if (!settlement) {
      throw new Error("Bridge settlement was not found.");
    }
    return settlement;
  }
}
