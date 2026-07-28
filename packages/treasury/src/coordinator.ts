import { createHash, randomUUID } from "node:crypto";
import type { SettlementDestination } from "@ntumba/contracts";
import type {
  DestinationSettlementWork,
  DurablePaymentIntentInput,
  NormalizedProviderEventInput,
  SettlementSagaRepository,
} from "./repository.js";
import type {
  BitcoinLiquidityRail,
  BridgeCreation,
  BridgeEngine,
  BridgeSettlement,
  MobileMoneyLiquidityRail,
  ReconciliationResult,
  ReconciliationService,
  SettlementDestinationVault,
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
  destinationExpiresAt: Date;
  direction: "btc_to_zmw" | "zmw_to_btc";
  intent: DurablePaymentIntentInput;
  settlementIdempotencyKey: string;
  sourceAmount: bigint;
  sourceAsset: "BTC" | "ZMW";
  sourcePaymentExpiresAt: Date;
}): string {
  return createHash("sha256")
    .update(
      [
        input.intent.id,
        input.intent.idempotencyKey,
        input.collectionIdempotencyKey,
        input.settlementIdempotencyKey,
        input.direction,
        input.sourceAsset,
        input.sourceAmount.toString(),
        input.destinationAsset,
        input.destinationAmount.toString(),
        input.sourcePaymentExpiresAt.toISOString(),
        input.destinationExpiresAt.toISOString(),
        JSON.stringify(input.destination),
      ].join("\u0000"),
    )
    .digest("hex");
}

function validateCreation(input: Parameters<BridgeEngine["create"]>[0], now: Date): void {
  if (
    input.collectionIdempotencyKey === input.settlementIdempotencyKey ||
    input.sourceAmount <= 0n ||
    input.destinationAmount <= 0n ||
    input.intent.sourceAmount !== input.sourceAmount ||
    input.intent.destinationAmount !== input.destinationAmount ||
    input.intent.sourceAsset !== input.sourceAsset ||
    input.intent.destinationAsset !== input.destinationAsset ||
    input.intent.direction !== input.direction ||
    input.sourcePaymentExpiresAt.getTime() <= now.getTime() ||
    input.destinationExpiresAt.getTime() <= input.sourcePaymentExpiresAt.getTime() ||
    (input.direction === "btc_to_zmw" &&
      (input.sourceAsset !== "BTC" ||
        input.destinationAsset !== "ZMW" ||
        input.destination.type !== "mobile_money")) ||
    (input.direction === "zmw_to_btc" &&
      (input.sourceAsset !== "ZMW" ||
        input.destinationAsset !== "BTC" ||
        input.destination.type === "mobile_money"))
  ) {
    throw new Error(
      "Bridge direction, deadlines, destination and integer amounts are inconsistent.",
    );
  }
}

export class RepositoryBackedSettlementCoordinator implements BridgeEngine {
  readonly #bitcoin: BitcoinLiquidityRail;
  readonly #enabled: boolean;
  readonly #mobileMoney: MobileMoneyLiquidityRail;
  readonly #reconciliation: ReconciliationService;
  readonly #repository: SettlementSagaRepository;
  readonly #vault: SettlementDestinationVault;

  constructor(dependencies: {
    bitcoin: BitcoinLiquidityRail;
    enabled?: boolean;
    mobileMoney: MobileMoneyLiquidityRail;
    reconciliation: ReconciliationService;
    repository: SettlementSagaRepository;
    vault: SettlementDestinationVault;
  }) {
    this.#bitcoin = dependencies.bitcoin;
    this.#enabled = dependencies.enabled ?? true;
    this.#mobileMoney = dependencies.mobileMoney;
    this.#reconciliation = dependencies.reconciliation;
    this.#repository = dependencies.repository;
    this.#vault = dependencies.vault;
  }

  async create(input: Parameters<BridgeEngine["create"]>[0]): Promise<BridgeCreation> {
    const now = input.intent.createdAt;
    validateCreation(input, now);
    let staged: Awaited<ReturnType<SettlementSagaRepository["stageBridge"]>>;
    try {
      staged = await this.#repository.stageBridge({
        collectionIdempotencyKey: input.collectionIdempotencyKey,
        creationFingerprint: creationFingerprint(input),
        destinationExpiresAt: input.destinationExpiresAt,
        intent: input.intent,
        settlementIdempotencyKey: input.settlementIdempotencyKey,
        sourcePaymentExpiresAt: input.sourcePaymentExpiresAt,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("liquidity")) {
        throw new LiquidityUnavailableError();
      }
      throw error;
    }

    let settlement = staged.settlement;
    let destinationToken = settlement.destinationLookupToken;
    if (!destinationToken) {
      try {
        destinationToken = this.#vault.put(input.destination, input.destinationExpiresAt);
        settlement = await this.#repository.attachDestinationToken(
          settlement.id,
          destinationToken,
          now,
        );
      } catch (error) {
        if (destinationToken) {
          this.#vault.delete(destinationToken);
        }
        await this.#repository.failSourceSetup(settlement.id, "failure", now);
        throw error;
      }
    }

    const source =
      input.direction === "btc_to_zmw"
        ? await this.#bitcoin.createInvoice({
            amountSats: input.sourceAmount,
            expiresAt: input.sourcePaymentExpiresAt,
            idempotencyKey: input.collectionIdempotencyKey,
          })
        : await this.#mobileMoney.collect({
            amountZmwMinor: input.sourceAmount,
            idempotencyKey: input.collectionIdempotencyKey,
          });

    if (source.outcome !== "success" || !source.value) {
      const conclusive = source.outcome === "failure";
      settlement = await this.#repository.failSourceSetup(
        settlement.id,
        conclusive ? "failure" : "unknown",
        new Date(),
      );
      if (conclusive && destinationToken) {
        this.#vault.delete(destinationToken);
      }
      throw new BridgeSourceSetupError(
        conclusive ? "SOURCE_SETUP_FAILED" : "SOURCE_SETUP_UNCERTAIN",
      );
    }

    settlement = await this.#repository.completeSourceSetup(
      settlement.id,
      source.value.lookupReference,
      new Date(),
    );
    const checkoutUrl =
      input.direction === "btc_to_zmw"
        ? `https://treasury.invalid/lightning/${source.value.lookupReference}`
        : "checkoutUrl" in source.value
          ? source.value.checkoutUrl
          : "https://treasury.invalid/mobile-money";
    return {
      checkoutUrl,
      destinationLookupToken: destinationToken,
      expiresAt: input.sourcePaymentExpiresAt,
      payerInstructions:
        input.direction === "btc_to_zmw"
          ? "Pay the simulated operator Lightning invoice."
          : "Approve the simulated Lipila mobile-money collection.",
      sourceReference: source.value.lookupReference,
      settlement,
    };
  }

  appendProviderEvent(event: NormalizedProviderEventInput) {
    return this.#repository.appendProviderEvent(event);
  }

  async expireNextSourcePayment(now = new Date()): Promise<BridgeSettlement | null> {
    const expired = await this.#repository.expireNextSourcePayment(now);
    if (expired?.destinationTokenToDelete) {
      this.#vault.delete(expired.destinationTokenToDelete);
    }
    return expired?.settlement ?? null;
  }

  async processNextProviderEvent(now = new Date()): Promise<BridgeSettlement | null> {
    const applied = await this.#repository.processNextProviderEvent(now);
    if (applied?.destinationTokenToDelete) {
      this.#vault.delete(applied.destinationTokenToDelete);
    }
    return applied?.settlement ?? null;
  }

  async markSourceOutcome(
    settlementId: string,
    outcome: "pending" | "settled" | "failed" | "timeout" | "unknown",
    now = new Date(),
  ): Promise<BridgeSettlement> {
    const settlement = await this.required(settlementId);
    if (!settlement.sourceReference) {
      throw new Error("Source setup has no opaque reference.");
    }
    await this.appendProviderEvent({
      id: randomUUID(),
      normalizedStatus:
        outcome === "settled"
          ? "source_settled"
          : outcome === "failed"
            ? "failed"
            : outcome === "pending"
              ? "source_confirming"
              : "unknown",
      occurredAt: now,
      payloadHash: createHash("sha256")
        .update(`${settlement.id}:${outcome}:${now.toISOString()}`)
        .digest("hex"),
      provider: "fake_treasury",
      providerEventId: randomUUID(),
      purgeAt: new Date(now.getTime() + 86_400_000),
      receivedAt: now,
      sourceReference: settlement.sourceReference,
    });
    const processed = await this.processNextProviderEvent(now);
    if (!processed) {
      throw new Error("The source event was not processed.");
    }
    return processed;
  }

  async processNextDestination(now = new Date()): Promise<BridgeSettlement | null> {
    const work = await this.#repository.claimDestinationSettlement(now, 30_000);
    return work ? this.executeDestination(work, now) : null;
  }

  async processDestination(settlementId: string, now = new Date()): Promise<BridgeSettlement> {
    const current = await this.required(settlementId);
    if (current.status === "settled") {
      return current;
    }
    if (
      current.status !== "destination_settlement_queued" &&
      current.status !== "destination_settlement_processing"
    ) {
      throw new Error("Destination settlement requires conclusive source settlement.");
    }
    const work = await this.#repository.claimDestinationSettlement(now, 30_000);
    if (!work || work.settlement.id !== settlementId) {
      throw new Error("Destination settlement work could not be claimed.");
    }
    return this.executeDestination(work, now);
  }

  async retryDestination(settlementId: string, now = new Date()): Promise<BridgeSettlement> {
    await this.#repository.requeueConclusiveDestinationFailure(settlementId, now);
    return this.processDestination(settlementId, now);
  }

  read(settlementId: string) {
    return this.#repository.read(settlementId);
  }

  async readOperationalStatus(): Promise<TreasuryOperationalStatus> {
    const durable = await this.#repository.readStatus();
    if (!this.#enabled) {
      return {
        bitcoin: {
          available: false,
          availableBalanceSats: 0n,
          inboundCapacitySats: 0n,
          outboundCapacitySats: 0n,
        },
        ...durable,
        mobileMoney: { available: false, availableBalanceZmwMinor: 0n },
      };
    }
    return {
      bitcoin: await this.#bitcoin.readStatus(),
      ...durable,
      mobileMoney: await this.#mobileMoney.readStatus(),
    };
  }

  private async executeDestination(
    work: DestinationSettlementWork,
    now: Date,
  ): Promise<BridgeSettlement> {
    const token = work.destinationLookupToken;
    const destination = token ? this.#vault.read(token, now) : null;
    if (!destination) {
      return this.#repository.recordDestinationUnavailable(work, now);
    }
    const settlement = work.settlement;
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

    if (result.outcome !== "success" || !result.value) {
      return this.#repository.finalizeDestinationSettlement(
        work,
        {
          outcome: result.outcome === "success" ? "failure" : result.outcome,
          safeCode:
            result.outcome === "timeout" || result.outcome === "unknown"
              ? "DESTINATION_OUTCOME_UNKNOWN"
              : "DESTINATION_SETTLEMENT_FAILED",
        },
        now,
      );
    }

    let reconciliation: ReconciliationResult;
    try {
      reconciliation = await this.#reconciliation.reconcile(settlement, now);
    } catch {
      reconciliation = {
        checkedAt: now,
        outcome: "unavailable",
        safeCode: "RECONCILIATION_UNAVAILABLE",
      };
    }
    const completed = await this.#repository.finalizeDestinationSettlement(
      work,
      {
        opaqueReference: result.value.lookupReference,
        outcome: "success",
        reconciliation,
      },
      now,
    );
    if (token) {
      this.#vault.delete(token);
    }
    return completed;
  }

  private async required(settlementId: string): Promise<BridgeSettlement> {
    const settlement = await this.#repository.read(settlementId);
    if (!settlement) {
      throw new Error("Bridge settlement was not found.");
    }
    return settlement;
  }
}

export { RepositoryBackedSettlementCoordinator as FakeSettlementCoordinator };
