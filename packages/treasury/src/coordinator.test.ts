import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BridgeRailUnavailableError,
  BridgeSourceSetupError,
  LiquidityUnavailableError,
  RepositoryBackedSettlementCoordinator,
} from "./coordinator.js";
import {
  FakeLipilaMobileMoneyTreasury,
  FakeLipilaRemoteState,
  FakeVoltageLndRemoteState,
  FakeVoltageLndTreasury,
} from "./fakes.js";
import { DeterministicFakeReconciliationService } from "./reconciliation.js";
import { InMemorySettlementSagaRepository } from "./repository.js";
import { InMemorySettlementDestinationVault } from "./vault.js";

const createdAt = new Date("2099-07-28T10:00:00.000Z");
const sourcePaymentExpiresAt = new Date("2099-07-28T10:03:00.000Z");
const destinationExpiresAt = new Date("2099-07-28T10:05:00.000Z");

function fixture(
  input: {
    bitcoin?: {
      available?: boolean;
      inboundCapacitySats?: bigint;
      outboundCapacitySats?: bigint;
    };
    mobileAvailable?: boolean;
    bitcoinRemote?: FakeVoltageLndRemoteState;
    mobileRemote?: FakeLipilaRemoteState;
    repository?: InMemorySettlementSagaRepository;
    vault?: InMemorySettlementDestinationVault;
    reconciliation?: "matched" | "mismatch" | "unavailable";
    zmw?: bigint;
  } = {},
) {
  const bitcoinRemote =
    input.bitcoinRemote ??
    new FakeVoltageLndRemoteState({
      available: input.bitcoin?.available ?? true,
      availableBalanceSats: 1_000_000n,
      inboundCapacitySats: input.bitcoin?.inboundCapacitySats ?? 2_000_000n,
      outboundCapacitySats: input.bitcoin?.outboundCapacitySats ?? 1_000_000n,
    });
  const mobileRemote =
    input.mobileRemote ??
    new FakeLipilaRemoteState({
      available: input.mobileAvailable ?? true,
      availableBalanceZmwMinor: input.zmw ?? 1_000_000n,
    });
  const bitcoin = new FakeVoltageLndTreasury(bitcoinRemote);
  const mobileMoney = new FakeLipilaMobileMoneyTreasury(mobileRemote);
  const repository =
    input.repository ??
    new InMemorySettlementSagaRepository({
      BTC: 1_000_000n,
      ZMW: input.zmw ?? 1_000_000n,
    });
  const vault =
    input.vault ?? new InMemorySettlementDestinationVault(() => "opaque-destination-token");
  const coordinator = new RepositoryBackedSettlementCoordinator({
    bitcoin,
    mobileMoney,
    reconciliation: new DeterministicFakeReconciliationService(input.reconciliation ?? "matched"),
    repository,
    vault,
  });
  return {
    bitcoin,
    bitcoinRemote,
    coordinator,
    mobileMoney,
    mobileRemote,
    repository,
    vault,
  };
}

async function createBtcToZmw(coordinator: RepositoryBackedSettlementCoordinator, suffix = "one") {
  return coordinator.create({
    collectionIdempotencyKey: `collection-${suffix}`,
    destination: { network: "mtn", phone: "0971234567", type: "mobile_money" },
    destinationAmount: 10_000n,
    destinationAsset: "ZMW",
    destinationExpiresAt,
    direction: "btc_to_zmw",
    intent: {
      createdAt,
      destinationAmount: 10_000n,
      destinationAsset: "ZMW",
      direction: "btc_to_zmw",
      expiresAt: sourcePaymentExpiresAt,
      id: identifier(`intent:${suffix}`),
      idempotencyKey: `intent-${suffix}`,
      provider: "fake_treasury",
      purgeAt: new Date("2099-07-29T10:00:00.000Z"),
      quoteId: identifier(`quote:${suffix}`),
      sourceAmount: 5_834n,
      sourceAsset: "BTC",
    },
    settlementIdempotencyKey: `settlement-${suffix}`,
    sourceAmount: 5_834n,
    sourceAsset: "BTC",
    sourcePaymentExpiresAt,
  });
}

function identifier(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

describe("repository-backed fake settlement saga", () => {
  it("persists unique mappings, reservation, obligation and source setup", async () => {
    const { coordinator, repository } = fixture();
    const created = await createBtcToZmw(coordinator);

    expect(created.settlement.status).toBe("awaiting_source_payment");
    expect((await repository.findByPaymentIntentId(created.settlement.paymentIntentId))?.id).toBe(
      created.settlement.id,
    );
    expect((await repository.findBySourceReference(created.sourceReference))?.id).toBe(
      created.settlement.id,
    );
    expect((await repository.findByCollectionKey("collection-one"))?.id).toBe(
      created.settlement.id,
    );
    expect((await repository.findBySettlementKey("settlement-one"))?.id).toBe(
      created.settlement.id,
    );
    expect((await repository.readReservation(created.settlement.id))?.status).toBe("active");
    expect((await repository.readObligation(created.settlement.id))?.status).toBe("waiting_source");
  });

  it("returns the same logical bridge and rejects conflicting key reuse", async () => {
    const { coordinator } = fixture();
    const first = await createBtcToZmw(coordinator);
    const duplicate = await createBtcToZmw(coordinator);
    expect(duplicate.settlement.id).toBe(first.settlement.id);

    await expect(
      coordinator.create({
        ...awaitInput("one"),
        destinationAmount: 10_001n,
        intent: { ...awaitInput("one").intent, destinationAmount: 10_001n },
      }),
    ).rejects.toThrow("Bridge idempotency conflict");
  });

  it("fails before vault or source side effects when liquidity is unavailable", async () => {
    const { coordinator, mobileMoney, vault } = fixture({ zmw: 9_999n });
    await expect(createBtcToZmw(coordinator)).rejects.toBeInstanceOf(LiquidityUnavailableError);
    expect(mobileMoney.attemptedDisbursementIdempotencyKeys).toEqual([]);
    expect(vault.read("opaque-destination-token", createdAt)).toBeNull();
  });

  it("processes duplicate source callbacks exactly once", async () => {
    const { coordinator, repository } = fixture();
    const created = await createBtcToZmw(coordinator);
    const event = {
      id: "33333333-3333-4333-8333-333333333333",
      normalizedStatus: "source_settled" as const,
      occurredAt: createdAt,
      payloadHash: "abc",
      provider: "fake_treasury",
      providerEventId: "source-settled-one",
      purgeAt: new Date("2099-07-29T10:00:00.000Z"),
      receivedAt: createdAt,
      sourceReference: created.sourceReference,
    };
    expect(await coordinator.appendProviderEvent(event)).toBe("inserted");
    expect(await coordinator.appendProviderEvent(event)).toBe("duplicate");
    expect((await coordinator.processNextProviderEvent(createdAt))?.status).toBe(
      "destination_settlement_queued",
    );
    expect(await coordinator.processNextProviderEvent(createdAt)).toBeNull();
    expect(await repository.readJournal()).toHaveLength(1);
    expect(await repository.pendingDestinationWork()).toBe(1);
  });

  it("survives coordinator restart without losing queued destination work", async () => {
    const first = fixture();
    const created = await createBtcToZmw(first.coordinator);
    await first.coordinator.markSourceOutcome(created.settlement.id, "settled", createdAt);
    const restarted = fixture({ repository: first.repository, vault: first.vault });

    expect((await restarted.coordinator.processNextDestination(createdAt))?.status).toBe("settled");
    expect(await first.repository.readJournal()).toHaveLength(2);
    expect(await first.repository.pendingDestinationWork()).toBe(0);
  });

  it("reuses the rail idempotency key after external success and pre-finalization crash", async () => {
    const first = fixture();
    const created = await createBtcToZmw(first.coordinator);
    await first.coordinator.markSourceOutcome(created.settlement.id, "settled", createdAt);
    const work = await first.repository.claimDestinationSettlement(createdAt, 1);
    expect(work).not.toBeNull();
    await first.mobileMoney.disburse({
      amountZmwMinor: created.settlement.destinationAmount,
      destination: { network: "mtn", phone: "0971234567", type: "mobile_money" },
      idempotencyKey: created.settlement.settlementIdempotencyKey,
    });

    const restarted = new RepositoryBackedSettlementCoordinator({
      bitcoin: new FakeVoltageLndTreasury(first.bitcoinRemote),
      mobileMoney: new FakeLipilaMobileMoneyTreasury(first.mobileRemote),
      reconciliation: new DeterministicFakeReconciliationService(),
      repository: first.repository,
      vault: first.vault,
    });
    expect(
      (await restarted.processNextDestination(new Date(createdAt.getTime() + 2)))?.status,
    ).toBe("settled");
    expect(first.mobileMoney.attemptedDisbursementIdempotencyKeys).toEqual([
      "settlement-one",
      "settlement-one",
    ]);
    expect(await first.repository.readJournal()).toHaveLength(2);
  });

  it("creates one refund obligation when an in-memory destination is lost on restart", async () => {
    const first = fixture();
    const created = await createBtcToZmw(first.coordinator);
    await first.coordinator.markSourceOutcome(created.settlement.id, "settled", createdAt);
    const restarted = fixture({
      repository: first.repository,
      vault: new InMemorySettlementDestinationVault(),
    });

    expect((await restarted.coordinator.processNextDestination(createdAt))?.status).toBe(
      "refund_required",
    );
    expect(await first.repository.refundObligationCount(created.settlement.id)).toBe(1);
    expect(await restarted.coordinator.processNextDestination(createdAt)).toBeNull();
    expect(await first.repository.refundObligationCount(created.settlement.id)).toBe(1);
  });

  it("keeps timeout liability in manual review and never blindly retries", async () => {
    const { coordinator, mobileMoney, repository } = fixture();
    const created = await createBtcToZmw(coordinator);
    await coordinator.markSourceOutcome(created.settlement.id, "settled", createdAt);
    mobileMoney.queueOutcome("disburse", "timeout");
    expect((await coordinator.processNextDestination(createdAt))?.status).toBe("manual_review");
    expect((await repository.readReservation(created.settlement.id))?.status).toBe("active");
    expect(await coordinator.processNextDestination(createdAt)).toBeNull();
  });

  it("settles independently of reconciliation and flags mismatches durably", async () => {
    const { coordinator, repository } = fixture({ reconciliation: "mismatch" });
    const created = await createBtcToZmw(coordinator);
    await coordinator.markSourceOutcome(created.settlement.id, "settled", createdAt);
    const settled = await coordinator.processNextDestination(createdAt);
    expect(settled?.status).toBe("settled");
    expect(settled?.reconciliationReviewRequired).toBe(true);
    expect((await repository.readReconciliation(created.settlement.id))[0]?.outcome).toBe(
      "mismatch",
    );
  });

  it("validates illegal destination work before mutating durable or ephemeral state", async () => {
    const { coordinator, repository, vault } = fixture();
    const created = await createBtcToZmw(coordinator);
    const beforeReservation = await repository.readReservation(created.settlement.id);
    const beforeObligation = await repository.readObligation(created.settlement.id);

    await expect(coordinator.processDestination(created.settlement.id, createdAt)).rejects.toThrow(
      "conclusive source settlement",
    );
    expect(await repository.readReservation(created.settlement.id)).toEqual(beforeReservation);
    expect(await repository.readObligation(created.settlement.id)).toEqual(beforeObligation);
    expect(await repository.readJournal()).toEqual([]);
    expect(await repository.refundObligationCount(created.settlement.id)).toBe(0);
    expect(vault.read(created.destinationLookupToken, createdAt)).toEqual({
      network: "mtn",
      phone: "0971234567",
      type: "mobile_money",
    });
  });

  it("preserves reservation and obligation on uncertain source setup", async () => {
    const { bitcoin, coordinator, repository } = fixture();
    bitcoin.queueOutcome("create_invoice", "unknown");
    await expect(createBtcToZmw(coordinator)).rejects.toEqual(
      new BridgeSourceSetupError("SOURCE_SETUP_UNCERTAIN"),
    );
    const settlement = await repository.findByCollectionKey("collection-one");
    expect(settlement?.status).toBe("manual_review");
    expect((await repository.readReservation(settlement?.id ?? ""))?.status).toBe("active");
    expect((await repository.readObligation(settlement?.id ?? ""))?.status).toBe("manual_review");
  });

  it("credits settled sources and consumes durable destination inventory exactly once", async () => {
    const { coordinator, repository } = fixture();
    const created = await createBtcToZmw(coordinator);
    await coordinator.markSourceOutcome(created.settlement.id, "settled", createdAt);
    let status = await repository.readStatus();
    expect(status.bookBtcBalanceSats).toBe(1_005_834n);
    expect(status.bookZmwBalanceMinor).toBe(1_000_000n);

    await coordinator.processNextDestination(createdAt);
    status = await repository.readStatus();
    expect(status.bookBtcBalanceSats).toBe(1_005_834n);
    expect(status.bookZmwBalanceMinor).toBe(990_000n);
    expect(await repository.readJournal()).toHaveLength(2);
  });

  it("accounts for a settled callback after expiry once and creates one refund", async () => {
    const { coordinator, repository } = fixture();
    const created = await createBtcToZmw(coordinator);
    await coordinator.expireNextSourcePayment(sourcePaymentExpiresAt);

    expect(
      (
        await coordinator.markSourceOutcome(
          created.settlement.id,
          "settled",
          sourcePaymentExpiresAt,
        )
      ).status,
    ).toBe("refund_required");
    expect(await repository.refundObligationCount(created.settlement.id)).toBe(1);
    expect(await repository.pendingDestinationWork()).toBe(0);
    expect((await repository.readStatus()).bookBtcBalanceSats).toBe(1_005_834n);

    await coordinator.markSourceOutcome(
      created.settlement.id,
      "settled",
      new Date(sourcePaymentExpiresAt.getTime() + 1),
    );
    expect(await repository.refundObligationCount(created.settlement.id)).toBe(1);
    expect(await repository.readJournal()).toHaveLength(1);
    expect((await repository.readStatus()).bookBtcBalanceSats).toBe(1_005_834n);
  });

  it("queues a conclusive settled callback after an earlier unknown callback", async () => {
    const { coordinator, repository } = fixture();
    const created = await createBtcToZmw(coordinator);
    expect(
      (await coordinator.markSourceOutcome(created.settlement.id, "unknown", createdAt)).status,
    ).toBe("manual_review");
    expect(
      (await coordinator.markSourceOutcome(created.settlement.id, "settled", createdAt)).status,
    ).toBe("destination_settlement_queued");
    expect(await repository.pendingDestinationWork()).toBe(1);
    expect(await repository.readJournal()).toHaveLength(1);
  });

  it("targets only the requested queued destination", async () => {
    const { coordinator, repository } = fixture();
    const first = await createBtcToZmw(coordinator, "target-one");
    const second = await createBtcToZmw(coordinator, "target-two");
    await coordinator.markSourceOutcome(first.settlement.id, "settled", createdAt);
    await coordinator.markSourceOutcome(second.settlement.id, "settled", createdAt);

    expect((await coordinator.processDestination(second.settlement.id, createdAt)).id).toBe(
      second.settlement.id,
    );
    expect((await repository.read(first.settlement.id))?.status).toBe(
      "destination_settlement_queued",
    );
  });

  it("preserves monotonic transport history across a conclusive retry", async () => {
    const { coordinator, mobileMoney, repository } = fixture();
    const created = await createBtcToZmw(coordinator);
    await coordinator.markSourceOutcome(created.settlement.id, "settled", createdAt);
    mobileMoney.queueOutcome("disburse", "failure");
    expect((await coordinator.processDestination(created.settlement.id, createdAt)).status).toBe(
      "destination_settlement_failed",
    );
    expect((await coordinator.retryDestination(created.settlement.id, createdAt)).status).toBe(
      "settled",
    );
    expect(
      (await repository.readAttemptEvents(created.settlement.settlementIdempotencyKey)).map(
        (event) => [event.attemptNumber, event.kind],
      ),
    ).toEqual([
      [1, "started"],
      [1, "failed"],
      [2, "started"],
      [2, "succeeded"],
    ]);
    expect(mobileMoney.attemptedDisbursementIdempotencyKeys).toEqual([
      "settlement-one",
      "settlement-one",
    ]);
  });

  it("does not automatically retry a timed-out transport attempt", async () => {
    const { coordinator, mobileMoney, repository } = fixture();
    const created = await createBtcToZmw(coordinator);
    await coordinator.markSourceOutcome(created.settlement.id, "settled", createdAt);
    mobileMoney.queueOutcome("disburse", "timeout");
    await coordinator.processDestination(created.settlement.id, createdAt);
    expect(await coordinator.processNextDestination(createdAt)).toBeNull();
    expect(
      (await repository.readAttemptEvents(created.settlement.settlementIdempotencyKey)).map(
        (event) => event.kind,
      ),
    ).toEqual(["started", "timeout"]);
  });

  it("prevents concurrent reservations from exceeding durable spendable liquidity", async () => {
    const { coordinator } = fixture();
    const createLarge = (suffix: string) => {
      const input = awaitInput(suffix);
      return coordinator.create({
        ...input,
        destinationAmount: 600_000n,
        intent: { ...input.intent, destinationAmount: 600_000n },
      });
    };
    const outcomes = await Promise.allSettled([
      createLarge("parallel-a"),
      createLarge("parallel-b"),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
  });

  it("fails closed on source and destination rail capacity gates", async () => {
    await expect(
      createBtcToZmw(fixture({ bitcoin: { inboundCapacitySats: 5_833n } }).coordinator),
    ).rejects.toBeInstanceOf(BridgeRailUnavailableError);
    await expect(createBtcToZmw(fixture({ zmw: 9_999n }).coordinator)).rejects.toBeInstanceOf(
      LiquidityUnavailableError,
    );

    const unavailableMobile = fixture({ mobileAvailable: false });
    await expect(
      unavailableMobile.coordinator.create(zwmToBtcInput("mobile-unavailable")),
    ).rejects.toBeInstanceOf(BridgeRailUnavailableError);
    const noOutbound = fixture({ bitcoin: { outboundCapacitySats: 9_999n } });
    await expect(
      noOutbound.coordinator.create(zwmToBtcInput("no-outbound")),
    ).rejects.toBeInstanceOf(LiquidityUnavailableError);
  });

  it("expires only after the separate source-payment deadline", async () => {
    const { coordinator, repository, vault } = fixture();
    const created = await createBtcToZmw(coordinator);
    expect(
      await coordinator.expireNextSourcePayment(new Date(sourcePaymentExpiresAt.getTime() - 1)),
    ).toBeNull();
    expect((await coordinator.expireNextSourcePayment(sourcePaymentExpiresAt))?.status).toBe(
      "expired",
    );
    expect((await repository.readReservation(created.settlement.id))?.status).toBe("released");
    expect(vault.read(created.destinationLookupToken, sourcePaymentExpiresAt)).toBeNull();
  });
});

function awaitInput(suffix: string) {
  return {
    collectionIdempotencyKey: `collection-${suffix}`,
    destination: { network: "mtn" as const, phone: "0971234567", type: "mobile_money" as const },
    destinationAmount: 10_000n,
    destinationAsset: "ZMW" as const,
    destinationExpiresAt,
    direction: "btc_to_zmw" as const,
    intent: {
      createdAt,
      destinationAmount: 10_000n,
      destinationAsset: "ZMW" as const,
      direction: "btc_to_zmw" as const,
      expiresAt: sourcePaymentExpiresAt,
      id: identifier(`intent:${suffix}`),
      idempotencyKey: `intent-${suffix}`,
      provider: "fake_treasury" as const,
      purgeAt: new Date("2099-07-29T10:00:00.000Z"),
      quoteId: identifier(`quote:${suffix}`),
      sourceAmount: 5_834n,
      sourceAsset: "BTC" as const,
    },
    settlementIdempotencyKey: `settlement-${suffix}`,
    sourceAmount: 5_834n,
    sourceAsset: "BTC" as const,
    sourcePaymentExpiresAt,
  };
}

function zwmToBtcInput(suffix: string) {
  const base = awaitInput(suffix);
  return {
    ...base,
    destination: { invoice: "lntb10000n1merchant", type: "lightning_invoice" as const },
    destinationAsset: "BTC" as const,
    direction: "zmw_to_btc" as const,
    intent: {
      ...base.intent,
      destinationAsset: "BTC" as const,
      direction: "zmw_to_btc" as const,
      sourceAsset: "ZMW" as const,
    },
    sourceAsset: "ZMW" as const,
  };
}
