import { describe, expect, it } from "vitest";
import { FakeSettlementCoordinator, LiquidityUnavailableError } from "./coordinator.js";
import { FakeLipilaMobileMoneyTreasury, FakeVoltageLndTreasury } from "./fakes.js";
import { InMemoryLiquidityInventory } from "./inventory.js";
import { InMemoryTreasuryJournal } from "./journal.js";
import { DeterministicFakeReconciliationService } from "./reconciliation.js";
import { InMemorySettlementDestinationVault } from "./vault.js";

const expiresAt = new Date("2027-07-28T12:00:00.000Z");

function fixture(input: { btc?: bigint; zmw?: bigint } = {}) {
  const bitcoin = new FakeVoltageLndTreasury({
    available: true,
    availableBalanceSats: input.btc ?? 1_000_000n,
    inboundCapacitySats: 2_000_000n,
    outboundCapacitySats: 1_000_000n,
  });
  const mobileMoney = new FakeLipilaMobileMoneyTreasury({
    available: true,
    availableBalanceZmwMinor: input.zmw ?? 1_000_000n,
  });
  const inventory = new InMemoryLiquidityInventory({
    BTC: input.btc ?? 1_000_000n,
    ZMW: input.zmw ?? 1_000_000n,
  });
  const journal = new InMemoryTreasuryJournal();
  const vault = new InMemorySettlementDestinationVault(() => "opaque-destination-token");
  const coordinator = new FakeSettlementCoordinator({
    bitcoin,
    inventory,
    journal,
    mobileMoney,
    reconciliation: new DeterministicFakeReconciliationService(),
    vault,
  });
  return { bitcoin, coordinator, inventory, journal, mobileMoney, vault };
}

async function createBtcToZmw(coordinator: FakeSettlementCoordinator, suffix = "one") {
  return coordinator.create({
    collectionIdempotencyKey: `collection-${suffix}`,
    destination: { network: "mtn", phone: "0971234567", type: "mobile_money" },
    destinationAmount: 10_000n,
    destinationAsset: "ZMW",
    direction: "btc_to_zmw",
    expiresAt,
    settlementIdempotencyKey: `settlement-${suffix}`,
    sourceAmount: 5_834n,
    sourceAsset: "BTC",
  });
}

describe("fake settlement coordinator", () => {
  it("reserves destination liquidity before accepting source payment", async () => {
    const { coordinator, inventory } = fixture();
    const created = await createBtcToZmw(coordinator);

    expect(created.settlement.status).toBe("awaiting_source_payment");
    expect(inventory.reserved("ZMW")).toBe(10_000n);
    expect(created.destinationLookupToken).toBe("opaque-destination-token");
  });

  it("rejects reuse of a collection key for different bridge terms", async () => {
    const { coordinator } = fixture();
    await createBtcToZmw(coordinator);

    await expect(
      coordinator.create({
        collectionIdempotencyKey: "collection-one",
        destination: { network: "mtn", phone: "0971234567", type: "mobile_money" },
        destinationAmount: 10_001n,
        destinationAsset: "ZMW",
        direction: "btc_to_zmw",
        expiresAt,
        settlementIdempotencyKey: "settlement-one",
        sourceAmount: 5_834n,
        sourceAsset: "BTC",
      }),
    ).rejects.toThrow("Bridge idempotency conflict");
  });

  it("fails closed when destination liquidity is insufficient", async () => {
    const { coordinator, inventory } = fixture({ zmw: 9_999n });

    await expect(createBtcToZmw(coordinator)).rejects.toBeInstanceOf(LiquidityUnavailableError);
    expect(inventory.reserved("ZMW")).toBe(0n);
  });

  it("never initiates destination settlement before conclusive source settlement", async () => {
    const { coordinator, mobileMoney } = fixture();
    const created = await createBtcToZmw(coordinator);

    await expect(coordinator.processDestination(created.settlement.id)).rejects.toThrow(
      "conclusive source settlement",
    );
    expect(mobileMoney.attemptedDisbursementIdempotencyKeys).toEqual([]);
  });

  it("settles each destination once and journals linked asset-specific transactions", async () => {
    const { coordinator, inventory, journal, mobileMoney } = fixture();
    const created = await createBtcToZmw(coordinator);
    const sourceSettled = await coordinator.markSourceOutcome(created.settlement.id, "settled");
    expect(sourceSettled.status).toBe("destination_settlement_queued");

    const settled = await coordinator.processDestination(created.settlement.id);
    const duplicate = await coordinator.processDestination(created.settlement.id);

    expect(settled.status).toBe("settled");
    expect(duplicate).toEqual(settled);
    expect(mobileMoney.attemptedDisbursementIdempotencyKeys).toEqual(["settlement-one"]);
    expect(inventory.reserved("ZMW")).toBe(0n);
    expect(journal.entries()).toHaveLength(2);
    expect(new Set(journal.entries().map((entry) => entry.asset))).toEqual(new Set(["BTC", "ZMW"]));
    expect(new Set(journal.entries().map((entry) => entry.exchangeGroupId)).size).toBe(1);
  });

  it("retries only a conclusive failure and reuses the settlement idempotency key", async () => {
    const { coordinator, mobileMoney } = fixture();
    const created = await createBtcToZmw(coordinator);
    await coordinator.markSourceOutcome(created.settlement.id, "settled");
    mobileMoney.queueOutcome("disburse", "failure");
    expect((await coordinator.processDestination(created.settlement.id)).status).toBe(
      "destination_settlement_failed",
    );

    expect((await coordinator.retryDestination(created.settlement.id)).status).toBe("settled");
    expect(mobileMoney.attemptedDisbursementIdempotencyKeys).toEqual([
      "settlement-one",
      "settlement-one",
    ]);
  });

  it("sends unknown external outcomes to manual review without a blind retry", async () => {
    const { coordinator, mobileMoney } = fixture();
    const created = await createBtcToZmw(coordinator);
    await coordinator.markSourceOutcome(created.settlement.id, "settled");
    mobileMoney.queueOutcome("disburse", "unknown");

    const uncertain = await coordinator.processDestination(created.settlement.id);
    expect(uncertain.status).toBe("manual_review");
    await expect(coordinator.retryDestination(created.settlement.id)).rejects.toThrow(
      "conclusively failed",
    );
    expect(mobileMoney.attemptedDisbursementIdempotencyKeys).toHaveLength(1);
  });

  it("requires a refund when the destination expires after source settlement", async () => {
    const { coordinator, inventory, vault } = fixture();
    const created = await createBtcToZmw(coordinator);
    await coordinator.markSourceOutcome(created.settlement.id, "settled");
    vault.delete(created.destinationLookupToken);

    const result = await coordinator.processDestination(created.settlement.id);
    expect(result.status).toBe("refund_required");
    expect(result.failureCode).toBe("DESTINATION_UNAVAILABLE");
    expect(inventory.reserved("ZMW")).toBe(0n);
  });

  it("releases reservations and deletes destinations after confirmed source failure", async () => {
    const { coordinator, inventory, vault } = fixture();
    const created = await createBtcToZmw(coordinator);

    const failed = await coordinator.markSourceOutcome(created.settlement.id, "failed");
    expect(failed.status).toBe("source_payment_failed");
    expect(inventory.reserved("ZMW")).toBe(0n);
    expect(vault.read(created.destinationLookupToken, new Date())).toBeNull();
  });

  it("releases reservations and deletes destinations after conclusive source expiry", async () => {
    const { coordinator, inventory, vault } = fixture();
    const created = await createBtcToZmw(coordinator);

    expect(() =>
      coordinator.expireBeforeSourceSettlement(
        created.settlement.id,
        new Date("2027-07-28T11:59:59.000Z"),
      ),
    ).toThrow("has not expired");
    const expired = coordinator.expireBeforeSourceSettlement(created.settlement.id, expiresAt);

    expect(expired.status).toBe("expired");
    expect(inventory.reserved("ZMW")).toBe(0n);
    expect(vault.read(created.destinationLookupToken, new Date())).toBeNull();
  });

  it("sends a source timeout to manual review without starting destination settlement", async () => {
    const { coordinator, mobileMoney } = fixture();
    const created = await createBtcToZmw(coordinator);

    const uncertain = await coordinator.markSourceOutcome(created.settlement.id, "timeout");

    expect(uncertain.status).toBe("manual_review");
    expect(mobileMoney.attemptedDisbursementIdempotencyKeys).toEqual([]);
  });
});

describe("treasury journal and destination vault", () => {
  it("balances each journal transaction independently by asset", () => {
    const journal = new InMemoryTreasuryJournal();
    expect(() =>
      journal.append({
        asset: "BTC",
        entries: [
          { account: "cash", amount: 10n, side: "debit" },
          { account: "clearing", amount: 9n, side: "credit" },
        ],
        exchangeGroupId: "exchange",
        idempotencyKey: "unbalanced",
        kind: "source_collection",
        occurredAt: new Date(),
        opaqueReference: null,
      }),
    ).toThrow("not balanced for BTC");
  });

  it("rejects a journal idempotency key reused for different entries", () => {
    const journal = new InMemoryTreasuryJournal();
    const input = {
      asset: "BTC" as const,
      entries: [
        { account: "cash", amount: 10n, side: "debit" as const },
        { account: "clearing", amount: 10n, side: "credit" as const },
      ],
      exchangeGroupId: "exchange",
      idempotencyKey: "journal-key",
      kind: "source_collection" as const,
      occurredAt: new Date(),
      opaqueReference: null,
    };
    journal.append(input);

    expect(() =>
      journal.append({
        ...input,
        entries: [
          { account: "cash", amount: 11n, side: "debit" },
          { account: "clearing", amount: 11n, side: "credit" },
        ],
      }),
    ).toThrow("Journal idempotency conflict");
  });

  it("expires and deletes destinations without exposing them in the lookup token", () => {
    const vault = new InMemorySettlementDestinationVault(() => "opaque-token");
    const destination = {
      network: "mtn" as const,
      phone: "0971234567",
      type: "mobile_money" as const,
    };
    const token = vault.put(destination, expiresAt);

    expect(token).toBe("opaque-token");
    expect(token).not.toContain(destination.phone);
    expect(vault.read(token, new Date("2027-07-28T11:59:59.000Z"))).toEqual(destination);
    expect(vault.read(token, expiresAt)).toBeNull();
  });
});
