import { randomUUID } from "node:crypto";
import type { PaymentDirection } from "@ntumba/contracts";
import { assertTransition } from "@ntumba/domain";
import type {
  BridgeSettlement,
  ReconciliationResult,
  TreasuryAsset,
  TreasuryJournalTransaction,
} from "./types.js";

export interface DurablePaymentIntentInput {
  createdAt: Date;
  direction: Exclude<PaymentDirection, "btc_to_btc">;
  expiresAt: Date;
  id: string;
  idempotencyKey: string;
  provider: "fake_treasury";
  purgeAt: Date;
  quoteId: string;
  sourceAmount: bigint;
  sourceAsset: TreasuryAsset;
  destinationAmount: bigint;
  destinationAsset: TreasuryAsset;
}

export interface StageBridgeInput {
  collectionIdempotencyKey: string;
  creationFingerprint: string;
  destinationExpiresAt: Date;
  intent: DurablePaymentIntentInput;
  settlementIdempotencyKey: string;
  sourcePaymentExpiresAt: Date;
}

export interface StoredBridgeLeg {
  amount: bigint;
  asset: TreasuryAsset;
  bridgeSettlementId: string;
  failureCode: string | null;
  id: string;
  idempotencyKey: string;
  kind: "source" | "destination";
  opaqueReference: string | null;
  rail: "fake_lipila" | "fake_voltage";
  status: "pending" | "processing" | "settled" | "failed" | "unknown";
}

export interface StoredLiquidityReservation {
  amount: bigint;
  asset: TreasuryAsset;
  bridgeSettlementId: string;
  expiresAt: Date;
  id: string;
  status: "active" | "committed" | "released" | "expired";
}

export interface StoredSettlementObligation {
  amount: bigint;
  asset: TreasuryAsset;
  bridgeSettlementId: string;
  failureCode: string | null;
  id: string;
  status: "waiting_source" | "queued" | "processing" | "settled" | "failed" | "manual_review";
}

export interface StoredSettlementAttempt {
  completedAt: Date | null;
  failureCode: string | null;
  id: string;
  idempotencyKey: string;
  opaqueReference: string | null;
  outcome: "processing" | "succeeded" | "failed" | "timeout" | "unknown";
  settlementObligationId: string;
  startedAt: Date;
}

export interface DestinationSettlementWork {
  attempt: StoredSettlementAttempt;
  destinationLookupToken: string | null;
  leaseToken: string;
  settlement: BridgeSettlement;
}

export interface NormalizedProviderEventInput {
  id: string;
  normalizedStatus:
    | "source_pending"
    | "source_confirming"
    | "source_settled"
    | "failed"
    | "unknown";
  occurredAt: Date;
  payloadHash: string;
  provider: string;
  providerEventId: string;
  purgeAt: Date;
  receivedAt: Date;
  sourceReference: string;
}

export interface ProviderEventApplication {
  destinationTokenToDelete: string | null;
  settlement: BridgeSettlement;
}

export interface BridgeSettlementRepository {
  attachDestinationToken(settlementId: string, token: string, now: Date): Promise<BridgeSettlement>;
  completeSourceSetup(
    settlementId: string,
    sourceReference: string,
    now: Date,
  ): Promise<BridgeSettlement>;
  expireNextSourcePayment(now: Date): Promise<ProviderEventApplication | null>;
  failSourceSetup(
    settlementId: string,
    outcome: "failure" | "unknown",
    now: Date,
  ): Promise<BridgeSettlement>;
  findByCollectionKey(key: string): Promise<BridgeSettlement | undefined>;
  findByPaymentIntentId(paymentIntentId: string): Promise<BridgeSettlement | undefined>;
  findBySettlementKey(key: string): Promise<BridgeSettlement | undefined>;
  findBySourceReference(reference: string): Promise<BridgeSettlement | undefined>;
  read(settlementId: string): Promise<BridgeSettlement | undefined>;
  stageBridge(input: StageBridgeInput): Promise<{ created: boolean; settlement: BridgeSettlement }>;
}

export interface ProviderEventRepository {
  appendProviderEvent(
    event: NormalizedProviderEventInput,
  ): Promise<"inserted" | "duplicate" | "conflict">;
  processNextProviderEvent(now: Date): Promise<ProviderEventApplication | null>;
}

export interface DestinationSettlementRepository {
  claimDestinationSettlement(now: Date, leaseMs: number): Promise<DestinationSettlementWork | null>;
  finalizeDestinationSettlement(
    work: DestinationSettlementWork,
    result:
      | { outcome: "success"; opaqueReference: string; reconciliation: ReconciliationResult }
      | { outcome: "failure" | "timeout" | "unknown"; safeCode: string },
    now: Date,
  ): Promise<BridgeSettlement>;
  recordDestinationUnavailable(
    work: DestinationSettlementWork,
    now: Date,
  ): Promise<BridgeSettlement>;
  requeueConclusiveDestinationFailure(settlementId: string, now: Date): Promise<BridgeSettlement>;
}

export interface LiquidityReservationRepository {
  readReservation(settlementId: string): Promise<StoredLiquidityReservation | undefined>;
}

export interface SettlementObligationRepository {
  readObligation(settlementId: string): Promise<StoredSettlementObligation | undefined>;
}

export interface SettlementAttemptRepository {
  readAttempt(idempotencyKey: string): Promise<StoredSettlementAttempt | undefined>;
}

export interface TreasuryJournalRepository {
  readJournal(): Promise<readonly TreasuryJournalTransaction[]>;
}

export interface ReconciliationResultRepository {
  readReconciliation(settlementId: string): Promise<readonly ReconciliationResult[]>;
}

export interface RefundObligationRepository {
  refundObligationCount(settlementId: string): Promise<number>;
}

export interface DestinationSettlementOutboxRepository {
  pendingDestinationWork(): Promise<number>;
}

export interface SettlementRepositoryStatus {
  lastSuccessfulReconciliationAt: Date | null;
  manualReview: number;
  reconciliationReviewRequired: number;
  refundRequired: number;
  reservedBtcSats: bigint;
  reservedZmwMinor: bigint;
  unsettledBtcLiabilitySats: bigint;
  unsettledZmwLiabilityMinor: bigint;
  waitingDestinationSettlement: number;
  waitingSourcePayment: number;
}

export interface SettlementSagaRepository
  extends BridgeSettlementRepository,
    ProviderEventRepository,
    DestinationSettlementRepository,
    LiquidityReservationRepository,
    SettlementObligationRepository,
    SettlementAttemptRepository,
    TreasuryJournalRepository,
    ReconciliationResultRepository,
    RefundObligationRepository,
    DestinationSettlementOutboxRepository {
  readStatus(): Promise<SettlementRepositoryStatus>;
}

interface InMemoryEvent extends NormalizedProviderEventInput {
  processedAt: Date | null;
}

interface InMemoryOutbox {
  availableAt: Date;
  leaseExpiresAt: Date | null;
  leaseToken: string | null;
  obligationId: string;
  processedAt: Date | null;
}

function transition(
  settlement: BridgeSettlement,
  status: BridgeSettlement["status"],
  now: Date,
  failureCode: string | null = settlement.failureCode,
): BridgeSettlement {
  assertTransition(settlement.status, status);
  return { ...settlement, failureCode, status, updatedAt: now };
}

function sameStage(existing: BridgeSettlement, input: StageBridgeInput): boolean {
  return (
    existing.paymentIntentId === input.intent.id &&
    existing.collectionIdempotencyKey === input.collectionIdempotencyKey &&
    existing.settlementIdempotencyKey === input.settlementIdempotencyKey &&
    existing.creationFingerprint === input.creationFingerprint
  );
}

export class InMemorySettlementSagaRepository implements SettlementSagaRepository {
  readonly #attempts = new Map<string, StoredSettlementAttempt>();
  readonly #collectionIndex = new Map<string, string>();
  readonly #events = new Map<string, InMemoryEvent>();
  readonly #journal = new Map<string, TreasuryJournalTransaction>();
  readonly #legs = new Map<string, StoredBridgeLeg>();
  readonly #obligations = new Map<string, StoredSettlementObligation>();
  readonly #outbox = new Map<string, InMemoryOutbox>();
  readonly #paymentIntentIndex = new Map<string, string>();
  readonly #reconciliations = new Map<string, ReconciliationResult[]>();
  readonly #refunds = new Map<string, string>();
  readonly #reservations = new Map<string, StoredLiquidityReservation>();
  readonly #settlementIndex = new Map<string, string>();
  readonly #settlements = new Map<string, BridgeSettlement>();
  readonly #sourceReferenceIndex = new Map<string, string>();
  readonly #initialLiquidity: Record<TreasuryAsset, bigint>;

  constructor(initialLiquidity: { BTC: bigint; ZMW: bigint }) {
    if (initialLiquidity.BTC < 0n || initialLiquidity.ZMW < 0n) {
      throw new Error("Initial liquidity cannot be negative.");
    }
    this.#initialLiquidity = { ...initialLiquidity };
  }

  async stageBridge(
    input: StageBridgeInput,
  ): Promise<{ created: boolean; settlement: BridgeSettlement }> {
    const indexedId =
      this.#paymentIntentIndex.get(input.intent.id) ??
      this.#collectionIndex.get(input.collectionIdempotencyKey) ??
      this.#settlementIndex.get(input.settlementIdempotencyKey);
    if (indexedId) {
      const existing = this.required(indexedId);
      if (!sameStage(existing, input)) {
        throw new Error("Bridge idempotency conflict.");
      }
      return { created: false, settlement: existing };
    }
    if (
      input.intent.sourceAmount <= 0n ||
      input.intent.destinationAmount <= 0n ||
      input.collectionIdempotencyKey === input.settlementIdempotencyKey
    ) {
      throw new Error("Bridge amounts and idempotency keys are invalid.");
    }
    if (
      input.sourcePaymentExpiresAt.getTime() <= input.intent.createdAt.getTime() ||
      input.destinationExpiresAt.getTime() <= input.sourcePaymentExpiresAt.getTime()
    ) {
      throw new Error("Bridge deadlines are invalid.");
    }
    const reserved = [...this.#reservations.values()]
      .filter((item) => item.asset === input.intent.destinationAsset && item.status === "active")
      .reduce((sum, item) => sum + item.amount, 0n);
    if (
      this.#initialLiquidity[input.intent.destinationAsset] - reserved <
      input.intent.destinationAmount
    ) {
      throw new Error("Destination liquidity is unavailable.");
    }

    const id = randomUUID();
    const now = input.intent.createdAt;
    const settlement: BridgeSettlement = {
      collectionIdempotencyKey: input.collectionIdempotencyKey,
      createdAt: now,
      creationFingerprint: input.creationFingerprint,
      destinationAmount: input.intent.destinationAmount,
      destinationAsset: input.intent.destinationAsset,
      destinationExpiresAt: input.destinationExpiresAt,
      destinationLookupToken: null,
      destinationReference: null,
      direction: input.intent.direction,
      exchangeGroupId: randomUUID(),
      expiresAt: input.sourcePaymentExpiresAt,
      failureCode: null,
      id,
      paymentIntentId: input.intent.id,
      reconciliationReviewRequired: false,
      reservationId: randomUUID(),
      settlementAttemptCount: 0,
      settlementIdempotencyKey: input.settlementIdempotencyKey,
      sourceAmount: input.intent.sourceAmount,
      sourceAsset: input.intent.sourceAsset,
      sourcePaymentExpiresAt: input.sourcePaymentExpiresAt,
      sourceReference: null,
      status: "quote_locked",
      updatedAt: now,
    };
    this.#settlements.set(id, settlement);
    this.#paymentIntentIndex.set(input.intent.id, id);
    this.#collectionIndex.set(input.collectionIdempotencyKey, id);
    this.#settlementIndex.set(input.settlementIdempotencyKey, id);
    this.#legs.set(`${id}:source`, {
      amount: settlement.sourceAmount,
      asset: settlement.sourceAsset,
      bridgeSettlementId: id,
      failureCode: null,
      id: randomUUID(),
      idempotencyKey: input.collectionIdempotencyKey,
      kind: "source",
      opaqueReference: null,
      rail: input.intent.direction === "btc_to_zmw" ? "fake_voltage" : "fake_lipila",
      status: "pending",
    });
    this.#legs.set(`${id}:destination`, {
      amount: settlement.destinationAmount,
      asset: settlement.destinationAsset,
      bridgeSettlementId: id,
      failureCode: null,
      id: randomUUID(),
      idempotencyKey: input.settlementIdempotencyKey,
      kind: "destination",
      opaqueReference: null,
      rail: input.intent.direction === "btc_to_zmw" ? "fake_lipila" : "fake_voltage",
      status: "pending",
    });
    this.#reservations.set(id, {
      amount: settlement.destinationAmount,
      asset: settlement.destinationAsset,
      bridgeSettlementId: id,
      expiresAt: input.destinationExpiresAt,
      id: settlement.reservationId ?? randomUUID(),
      status: "active",
    });
    this.#obligations.set(id, {
      amount: settlement.destinationAmount,
      asset: settlement.destinationAsset,
      bridgeSettlementId: id,
      failureCode: null,
      id: randomUUID(),
      status: "waiting_source",
    });
    return { created: true, settlement };
  }

  async attachDestinationToken(
    settlementId: string,
    token: string,
    now: Date,
  ): Promise<BridgeSettlement> {
    const settlement = this.required(settlementId);
    if (settlement.destinationLookupToken && settlement.destinationLookupToken !== token) {
      throw new Error("Destination token conflict.");
    }
    const updated = { ...settlement, destinationLookupToken: token, updatedAt: now };
    this.#settlements.set(settlementId, updated);
    return updated;
  }

  async completeSourceSetup(
    settlementId: string,
    sourceReference: string,
    now: Date,
  ): Promise<BridgeSettlement> {
    const settlement = this.required(settlementId);
    if (settlement.sourceReference) {
      if (settlement.sourceReference !== sourceReference) {
        throw new Error("Source reference conflict.");
      }
      return settlement;
    }
    if (this.#sourceReferenceIndex.has(sourceReference)) {
      throw new Error("Source reference conflict.");
    }
    const updated = transition(settlement, "awaiting_source_payment", now);
    const leg = this.requiredLeg(settlementId, "source");
    this.#legs.set(`${settlementId}:source`, { ...leg, opaqueReference: sourceReference });
    this.#sourceReferenceIndex.set(sourceReference, settlementId);
    this.#settlements.set(settlementId, { ...updated, sourceReference });
    return { ...updated, sourceReference };
  }

  async failSourceSetup(
    settlementId: string,
    outcome: "failure" | "unknown",
    now: Date,
  ): Promise<BridgeSettlement> {
    const settlement = this.required(settlementId);
    if (settlement.status !== "quote_locked") {
      return settlement;
    }
    const status = outcome === "failure" ? "source_payment_failed" : "manual_review";
    const updated = transition(
      settlement,
      status,
      now,
      outcome === "failure" ? "SOURCE_SETUP_FAILED" : "SOURCE_SETUP_UNCERTAIN",
    );
    const leg = this.requiredLeg(settlementId, "source");
    this.#legs.set(`${settlementId}:source`, {
      ...leg,
      failureCode: updated.failureCode,
      status: outcome === "failure" ? "failed" : "unknown",
    });
    if (outcome === "failure") {
      this.releaseReservation(settlementId, now);
    } else {
      const obligation = this.requiredObligation(settlementId);
      this.#obligations.set(settlementId, { ...obligation, status: "manual_review" });
    }
    this.#settlements.set(settlementId, updated);
    return updated;
  }

  async expireNextSourcePayment(now: Date): Promise<ProviderEventApplication | null> {
    const settlement = [...this.#settlements.values()]
      .filter(
        (item) =>
          (item.status === "awaiting_source_payment" ||
            item.status === "source_payment_confirming") &&
          item.sourcePaymentExpiresAt <= now,
      )
      .sort(
        (left, right) =>
          left.sourcePaymentExpiresAt.getTime() - right.sourcePaymentExpiresAt.getTime(),
      )[0];
    if (!settlement) {
      return null;
    }
    const updated = transition(settlement, "expired", now, "SOURCE_EXPIRED");
    this.releaseReservation(settlement.id, now);
    const leg = this.requiredLeg(settlement.id, "source");
    this.#legs.set(`${settlement.id}:source`, {
      ...leg,
      failureCode: "SOURCE_EXPIRED",
      status: "failed",
    });
    const obligation = this.requiredObligation(settlement.id);
    this.#obligations.set(settlement.id, {
      ...obligation,
      failureCode: "SOURCE_EXPIRED",
      status: "failed",
    });
    this.#settlements.set(settlement.id, updated);
    return {
      destinationTokenToDelete: settlement.destinationLookupToken,
      settlement: updated,
    };
  }

  async appendProviderEvent(
    event: NormalizedProviderEventInput,
  ): Promise<"inserted" | "duplicate" | "conflict"> {
    const key = `${event.provider}:${event.providerEventId}`;
    const existing = this.#events.get(key);
    if (existing) {
      return existing.payloadHash === event.payloadHash &&
        existing.sourceReference === event.sourceReference
        ? "duplicate"
        : "conflict";
    }
    this.#events.set(key, { ...event, processedAt: null });
    return "inserted";
  }

  async processNextProviderEvent(now: Date): Promise<ProviderEventApplication | null> {
    const event = [...this.#events.values()]
      .filter((item) => item.processedAt === null)
      .sort((left, right) => left.receivedAt.getTime() - right.receivedAt.getTime())[0];
    if (!event) {
      return null;
    }
    const settlementId = this.#sourceReferenceIndex.get(event.sourceReference);
    if (!settlementId) {
      throw new Error("Provider event has no durable source mapping.");
    }
    let settlement = this.required(settlementId);
    let destinationTokenToDelete: string | null = null;
    if (event.normalizedStatus === "source_settled") {
      if (
        settlement.status === "awaiting_source_payment" ||
        settlement.status === "source_payment_confirming"
      ) {
        settlement = transition(settlement, "source_payment_settled", now);
        settlement = transition(settlement, "destination_settlement_queued", now);
        const leg = this.requiredLeg(settlementId, "source");
        this.#legs.set(`${settlementId}:source`, { ...leg, status: "settled" });
        const obligation = this.requiredObligation(settlementId);
        this.#obligations.set(settlementId, { ...obligation, status: "queued" });
        this.appendJournal(
          settlement,
          "source_collection",
          event.occurredAt,
          event.sourceReference,
        );
        this.#outbox.set(obligation.id, {
          availableAt: now,
          leaseExpiresAt: null,
          leaseToken: null,
          obligationId: obligation.id,
          processedAt: null,
        });
      }
    } else if (
      event.normalizedStatus === "source_pending" ||
      event.normalizedStatus === "source_confirming"
    ) {
      if (settlement.status === "awaiting_source_payment") {
        settlement = transition(settlement, "source_payment_confirming", now);
      }
    } else if (event.normalizedStatus === "failed") {
      if (
        settlement.status === "awaiting_source_payment" ||
        settlement.status === "source_payment_confirming"
      ) {
        destinationTokenToDelete = settlement.destinationLookupToken;
        settlement = transition(settlement, "source_payment_failed", now, "SOURCE_PAYMENT_FAILED");
        this.releaseReservation(settlementId, now);
        const leg = this.requiredLeg(settlementId, "source");
        this.#legs.set(`${settlementId}:source`, {
          ...leg,
          failureCode: "SOURCE_PAYMENT_FAILED",
          status: "failed",
        });
      }
    } else if (
      settlement.status === "awaiting_source_payment" ||
      settlement.status === "source_payment_confirming"
    ) {
      settlement = transition(settlement, "manual_review", now, "SOURCE_OUTCOME_UNKNOWN");
      const obligation = this.requiredObligation(settlementId);
      this.#obligations.set(settlementId, { ...obligation, status: "manual_review" });
    }
    event.processedAt = now;
    this.#settlements.set(settlementId, settlement);
    return { destinationTokenToDelete, settlement };
  }

  async claimDestinationSettlement(
    now: Date,
    leaseMs: number,
  ): Promise<DestinationSettlementWork | null> {
    const candidate = [...this.#outbox.values()]
      .filter(
        (item) =>
          item.processedAt === null &&
          item.availableAt <= now &&
          (item.leaseExpiresAt === null || item.leaseExpiresAt <= now),
      )
      .sort((left, right) => left.availableAt.getTime() - right.availableAt.getTime())[0];
    if (!candidate) {
      return null;
    }
    const obligation = [...this.#obligations.values()].find(
      (item) => item.id === candidate.obligationId,
    );
    if (!obligation) {
      throw new Error("Destination outbox has no obligation.");
    }
    let settlement = this.required(obligation.bridgeSettlementId);
    if (
      settlement.status !== "destination_settlement_queued" &&
      settlement.status !== "destination_settlement_processing"
    ) {
      throw new Error("Destination work is illegal in the current bridge state.");
    }
    if (settlement.status === "destination_settlement_queued") {
      settlement = transition(settlement, "destination_settlement_processing", now);
    }
    const leaseToken = randomUUID();
    candidate.leaseToken = leaseToken;
    candidate.leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const existingAttempt = this.#attempts.get(settlement.settlementIdempotencyKey);
    const attempt: StoredSettlementAttempt = existingAttempt
      ? { ...existingAttempt, outcome: "processing", startedAt: now }
      : {
          completedAt: null,
          failureCode: null,
          id: randomUUID(),
          idempotencyKey: settlement.settlementIdempotencyKey,
          opaqueReference: null,
          outcome: "processing",
          settlementObligationId: obligation.id,
          startedAt: now,
        };
    this.#attempts.set(attempt.idempotencyKey, attempt);
    this.#obligations.set(settlement.id, { ...obligation, status: "processing" });
    settlement = {
      ...settlement,
      settlementAttemptCount: existingAttempt
        ? settlement.settlementAttemptCount
        : settlement.settlementAttemptCount + 1,
    };
    this.#settlements.set(settlement.id, settlement);
    return {
      attempt,
      destinationLookupToken: settlement.destinationLookupToken,
      leaseToken,
      settlement,
    };
  }

  async finalizeDestinationSettlement(
    work: DestinationSettlementWork,
    result:
      | { outcome: "success"; opaqueReference: string; reconciliation: ReconciliationResult }
      | { outcome: "failure" | "timeout" | "unknown"; safeCode: string },
    now: Date,
  ): Promise<BridgeSettlement> {
    let settlement = this.required(work.settlement.id);
    const obligation = this.requiredObligation(settlement.id);
    const outbox = this.requiredOutbox(obligation.id, work.leaseToken);
    if (settlement.status === "settled") {
      return settlement;
    }
    if (settlement.status !== "destination_settlement_processing") {
      throw new Error("Destination finalization is illegal in the current bridge state.");
    }
    const attempt = this.#attempts.get(settlement.settlementIdempotencyKey);
    if (!attempt || attempt.id !== work.attempt.id) {
      throw new Error("Destination attempt does not match the durable claim.");
    }
    if (result.outcome === "success") {
      settlement = transition(settlement, "settled", now);
      const reservation = this.requiredReservation(settlement.id);
      if (reservation.status !== "active" && reservation.status !== "committed") {
        throw new Error("Successful settlement has no active liquidity reservation.");
      }
      this.#reservations.set(settlement.id, { ...reservation, status: "committed" });
      this.#obligations.set(settlement.id, { ...obligation, status: "settled" });
      const leg = this.requiredLeg(settlement.id, "destination");
      this.#legs.set(`${settlement.id}:destination`, {
        ...leg,
        opaqueReference: result.opaqueReference,
        status: "settled",
      });
      this.#attempts.set(attempt.idempotencyKey, {
        ...attempt,
        completedAt: now,
        opaqueReference: result.opaqueReference,
        outcome: "succeeded",
      });
      this.appendJournal(settlement, "destination_settlement", now, result.opaqueReference);
      const reconciliations = this.#reconciliations.get(settlement.id) ?? [];
      reconciliations.push(result.reconciliation);
      this.#reconciliations.set(settlement.id, reconciliations);
      settlement = {
        ...settlement,
        destinationReference: result.opaqueReference,
        reconciliationReviewRequired: result.reconciliation.outcome !== "matched",
      };
      outbox.processedAt = now;
      outbox.leaseToken = null;
      outbox.leaseExpiresAt = null;
    } else {
      const uncertain = result.outcome === "timeout" || result.outcome === "unknown";
      settlement = transition(
        settlement,
        uncertain ? "manual_review" : "destination_settlement_failed",
        now,
        result.safeCode,
      );
      this.#attempts.set(attempt.idempotencyKey, {
        ...attempt,
        completedAt: now,
        failureCode: result.safeCode,
        outcome: result.outcome === "failure" ? "failed" : result.outcome,
      });
      this.#obligations.set(settlement.id, {
        ...obligation,
        failureCode: result.safeCode,
        status: uncertain ? "manual_review" : "failed",
      });
      if (!uncertain) {
        this.releaseReservation(settlement.id, now);
      }
      outbox.processedAt = now;
      outbox.leaseToken = null;
      outbox.leaseExpiresAt = null;
    }
    this.#settlements.set(settlement.id, settlement);
    return settlement;
  }

  async recordDestinationUnavailable(
    work: DestinationSettlementWork,
    now: Date,
  ): Promise<BridgeSettlement> {
    let settlement = this.required(work.settlement.id);
    const obligation = this.requiredObligation(settlement.id);
    const outbox = this.requiredOutbox(obligation.id, work.leaseToken);
    if (settlement.status !== "destination_settlement_processing") {
      throw new Error("Destination loss is illegal in the current bridge state.");
    }
    settlement = transition(settlement, "refund_required", now, "DESTINATION_UNAVAILABLE");
    this.releaseReservation(settlement.id, now);
    this.#refunds.set(settlement.id, `refund:${settlement.collectionIdempotencyKey}`);
    this.#obligations.set(settlement.id, {
      ...obligation,
      failureCode: "DESTINATION_UNAVAILABLE",
      status: "manual_review",
    });
    const attempt = this.#attempts.get(settlement.settlementIdempotencyKey);
    if (attempt) {
      this.#attempts.set(attempt.idempotencyKey, {
        ...attempt,
        completedAt: now,
        failureCode: "DESTINATION_UNAVAILABLE",
        outcome: "failed",
      });
    }
    outbox.processedAt = now;
    outbox.leaseExpiresAt = null;
    outbox.leaseToken = null;
    this.#settlements.set(settlement.id, settlement);
    return settlement;
  }

  async requeueConclusiveDestinationFailure(
    settlementId: string,
    now: Date,
  ): Promise<BridgeSettlement> {
    let settlement = this.required(settlementId);
    if (settlement.status !== "destination_settlement_failed") {
      throw new Error("Only a conclusively failed destination settlement can be retried.");
    }
    const reserved = [...this.#reservations.values()]
      .filter(
        (item) =>
          item.asset === settlement.destinationAsset &&
          item.status === "active" &&
          item.bridgeSettlementId !== settlementId,
      )
      .reduce((sum, item) => sum + item.amount, 0n);
    if (
      this.#initialLiquidity[settlement.destinationAsset] - reserved <
      settlement.destinationAmount
    ) {
      return { ...settlement, failureCode: "LIQUIDITY_UNAVAILABLE", updatedAt: now };
    }
    const reservation = this.requiredReservation(settlementId);
    this.#reservations.set(settlementId, { ...reservation, status: "active" });
    const obligation = this.requiredObligation(settlementId);
    this.#obligations.set(settlementId, {
      ...obligation,
      failureCode: null,
      status: "queued",
    });
    const outbox = [...this.#outbox.values()].find((item) => item.obligationId === obligation.id);
    if (!outbox) {
      throw new Error("Destination retry has no durable outbox.");
    }
    Object.assign(outbox, {
      availableAt: now,
      leaseExpiresAt: null,
      leaseToken: null,
      processedAt: null,
    });
    settlement = transition(settlement, "destination_settlement_queued", now, null);
    this.#settlements.set(settlementId, settlement);
    return settlement;
  }

  async findByCollectionKey(key: string) {
    return this.readIndexed(this.#collectionIndex.get(key));
  }

  async findByPaymentIntentId(id: string) {
    return this.readIndexed(this.#paymentIntentIndex.get(id));
  }

  async findBySettlementKey(key: string) {
    return this.readIndexed(this.#settlementIndex.get(key));
  }

  async findBySourceReference(reference: string) {
    return this.readIndexed(this.#sourceReferenceIndex.get(reference));
  }

  async read(id: string) {
    return this.#settlements.get(id);
  }

  async readReservation(id: string) {
    return this.#reservations.get(id);
  }

  async readObligation(id: string) {
    return this.#obligations.get(id);
  }

  async readAttempt(key: string) {
    return this.#attempts.get(key);
  }

  async readJournal() {
    return [...this.#journal.values()];
  }

  async readReconciliation(id: string) {
    return this.#reconciliations.get(id) ?? [];
  }

  async refundObligationCount(id: string) {
    return this.#refunds.has(id) ? 1 : 0;
  }

  async pendingDestinationWork() {
    return [...this.#outbox.values()].filter((item) => item.processedAt === null).length;
  }

  async readStatus(): Promise<SettlementRepositoryStatus> {
    const settlements = [...this.#settlements.values()];
    const reservations = [...this.#reservations.values()].filter(
      (item) => item.status === "active",
    );
    const unsettled = (asset: TreasuryAsset) =>
      settlements
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
        .reduce((sum, item) => sum + item.destinationAmount, 0n);
    const matched = [...this.#reconciliations.values()]
      .flat()
      .filter((item) => item.outcome === "matched")
      .sort((left, right) => right.checkedAt.getTime() - left.checkedAt.getTime())[0];
    return {
      lastSuccessfulReconciliationAt: matched?.checkedAt ?? null,
      manualReview: settlements.filter((item) => item.status === "manual_review").length,
      reconciliationReviewRequired: settlements.filter((item) => item.reconciliationReviewRequired)
        .length,
      refundRequired: settlements.filter((item) => item.status === "refund_required").length,
      reservedBtcSats: reservations
        .filter((item) => item.asset === "BTC")
        .reduce((sum, item) => sum + item.amount, 0n),
      reservedZmwMinor: reservations
        .filter((item) => item.asset === "ZMW")
        .reduce((sum, item) => sum + item.amount, 0n),
      unsettledBtcLiabilitySats: unsettled("BTC"),
      unsettledZmwLiabilityMinor: unsettled("ZMW"),
      waitingDestinationSettlement: settlements.filter((item) =>
        [
          "source_payment_settled",
          "destination_settlement_queued",
          "destination_settlement_processing",
          "destination_settlement_failed",
        ].includes(item.status),
      ).length,
      waitingSourcePayment: settlements.filter((item) =>
        ["awaiting_source_payment", "source_payment_confirming"].includes(item.status),
      ).length,
    };
  }

  private appendJournal(
    settlement: BridgeSettlement,
    kind: "source_collection" | "destination_settlement",
    occurredAt: Date,
    opaqueReference: string,
  ) {
    const source = kind === "source_collection";
    const idempotencyKey = `${
      source ? settlement.collectionIdempotencyKey : settlement.settlementIdempotencyKey
    }:journal`;
    if (this.#journal.has(idempotencyKey)) {
      return;
    }
    const amount = source ? settlement.sourceAmount : settlement.destinationAmount;
    const asset = source ? settlement.sourceAsset : settlement.destinationAsset;
    const transaction: TreasuryJournalTransaction = {
      asset,
      entries: source
        ? [
            { account: "treasury_asset", amount, side: "debit" },
            { account: "source_collection_clearing", amount, side: "credit" },
          ]
        : [
            { account: "destination_settlement_clearing", amount, side: "debit" },
            { account: "treasury_asset", amount, side: "credit" },
          ],
      exchangeGroupId: settlement.exchangeGroupId,
      id: randomUUID(),
      idempotencyKey,
      kind,
      occurredAt,
      opaqueReference,
    };
    this.#journal.set(idempotencyKey, transaction);
  }

  private releaseReservation(settlementId: string, now: Date) {
    const reservation = this.requiredReservation(settlementId);
    if (reservation.status === "active") {
      this.#reservations.set(settlementId, {
        ...reservation,
        status: "released",
      });
    }
    void now;
  }

  private required(id: string) {
    const settlement = this.#settlements.get(id);
    if (!settlement) {
      throw new Error("Bridge settlement was not found.");
    }
    return settlement;
  }

  private requiredLeg(id: string, kind: "source" | "destination") {
    const leg = this.#legs.get(`${id}:${kind}`);
    if (!leg) {
      throw new Error("Bridge settlement leg was not found.");
    }
    return leg;
  }

  private requiredObligation(id: string) {
    const obligation = this.#obligations.get(id);
    if (!obligation) {
      throw new Error("Settlement obligation was not found.");
    }
    return obligation;
  }

  private requiredReservation(id: string) {
    const reservation = this.#reservations.get(id);
    if (!reservation) {
      throw new Error("Liquidity reservation was not found.");
    }
    return reservation;
  }

  private requiredOutbox(obligationId: string, leaseToken: string) {
    const outbox = this.#outbox.get(obligationId);
    if (!outbox || outbox.leaseToken !== leaseToken) {
      throw new Error("Destination outbox lease is unavailable.");
    }
    return outbox;
  }

  private readIndexed(id: string | undefined) {
    return id ? this.#settlements.get(id) : undefined;
  }
}
