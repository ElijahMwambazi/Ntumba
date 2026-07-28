import { describe, expect, it } from "vitest";
import {
  BridgeSourceSetupError,
  LiquidityUnavailableError,
  RepositoryBackedSettlementCoordinator,
} from "./coordinator.js";
import { FakeLipilaMobileMoneyTreasury, FakeVoltageLndTreasury } from "./fakes.js";
import { DeterministicFakeReconciliationService } from "./reconciliation.js";
import { InMemorySettlementSagaRepository } from "./repository.js";
import { InMemorySettlementDestinationVault } from "./vault.js";

const createdAt = new Date("2099-07-28T10:00:00.000Z");
const sourcePaymentExpiresAt = new Date("2099-07-28T10:03:00.000Z");
const destinationExpiresAt = new Date("2099-07-28T10:05:00.000Z");

function fixture(
  input: {
    repository?: InMemorySettlementSagaRepository;
    vault?: InMemorySettlementDestinationVault;
    reconciliation?: "matched" | "mismatch" | "unavailable";
    zmw?: bigint;
  } = {},
) {
  const bitcoin = new FakeVoltageLndTreasury({
    available: true,
    availableBalanceSats: 1_000_000n,
    inboundCapacitySats: 2_000_000n,
    outboundCapacitySats: 1_000_000n,
  });
  const mobileMoney = new FakeLipilaMobileMoneyTreasury({
    available: true,
    availableBalanceZmwMinor: input.zmw ?? 1_000_000n,
  });
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
  return { bitcoin, coordinator, mobileMoney, repository, vault };
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
      id: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: `intent-${suffix}`,
      provider: "fake_treasury",
      purgeAt: new Date("2099-07-29T10:00:00.000Z"),
      quoteId: "22222222-2222-4222-8222-222222222222",
      sourceAmount: 5_834n,
      sourceAsset: "BTC",
    },
    settlementIdempotencyKey: `settlement-${suffix}`,
    sourceAmount: 5_834n,
    sourceAsset: "BTC",
    sourcePaymentExpiresAt,
  });
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
      bitcoin: first.bitcoin,
      mobileMoney: first.mobileMoney,
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
      id: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: `intent-${suffix}`,
      provider: "fake_treasury" as const,
      purgeAt: new Date("2099-07-29T10:00:00.000Z"),
      quoteId: "22222222-2222-4222-8222-222222222222",
      sourceAmount: 5_834n,
      sourceAsset: "BTC" as const,
    },
    settlementIdempotencyKey: `settlement-${suffix}`,
    sourceAmount: 5_834n,
    sourceAsset: "BTC" as const,
    sourcePaymentExpiresAt,
  };
}
