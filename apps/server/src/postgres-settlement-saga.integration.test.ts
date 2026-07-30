import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { loadConfig } from "@ntumba/config";
import {
  bridgeSettlementLegs,
  bridgeSettlements,
  createDatabase,
  destinationSettlementOutbox,
  liquidityReservations,
  paymentIntents,
  providerEvents,
  providerIntentOutbox,
  publicPaymentRequestOptions,
  publicPaymentRequests,
  purgeExpiredOperationalData,
  quotes,
  refundObligations,
  settlementAttemptEvents,
  settlementObligations,
  treasuryInventoryPositions,
  treasuryJournalTransactions,
} from "@ntumba/database";
import {
  DeterministicFakeReconciliationService,
  FakeLipilaMobileMoneyTreasury,
  FakeLipilaRemoteState,
  FakeVoltageLndRemoteState,
  FakeVoltageLndTreasury,
  InMemorySettlementDestinationVault,
  RepositoryBackedSettlementCoordinator,
} from "@ntumba/treasury";
import { and, eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresPaymentStore } from "./postgres-payment-store.js";
import { PostgresSettlementSagaRepository } from "./postgres-settlement-saga-repository.js";
import { PostgresPublicRequestStore } from "./public-request-store.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

integration("PostgreSQL durable fake settlement saga", () => {
  if (!connectionString) {
    return;
  }
  const { database, pool } = createDatabase(connectionString);
  const config = loadConfig({
    BRIDGE_ENGINE_MODE: "fake",
    DATABASE_URL: connectionString,
    NODE_ENV: "test",
  });
  const repository = new PostgresSettlementSagaRepository(database, config);
  const bitcoinRemote = new FakeVoltageLndRemoteState();
  const mobileMoneyRemote = new FakeLipilaRemoteState();
  const bitcoin = new FakeVoltageLndTreasury(bitcoinRemote);
  const mobileMoney = new FakeLipilaMobileMoneyTreasury(mobileMoneyRemote);
  const vault = new InMemorySettlementDestinationVault();
  const coordinator = () =>
    new RepositoryBackedSettlementCoordinator({
      bitcoin,
      mobileMoney,
      reconciliation: new DeterministicFakeReconciliationService(),
      repository,
      vault,
    });

  beforeAll(async () => {
    if (!connectionString.toLowerCase().includes("test")) {
      throw new Error("PostgreSQL integration tests require a database name containing 'test'.");
    }
    await pool.query("drop schema public cascade");
    await pool.query("drop schema if exists drizzle cascade");
    await pool.query("create schema public");
    await migrate(database, {
      migrationsFolder: resolve(import.meta.dirname, "../../../migrations"),
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedQuote() {
    const now = new Date();
    const id = randomUUID();
    await database.insert(quotes).values({
      amountZmwMinor: 10_000n,
      createdAt: now,
      direction: "btc_to_zmw",
      expiresAt: new Date(now.getTime() + 60_000),
      feeZmwMinor: 500n,
      id,
      merchantAmountSats: null,
      payerAmountSats: 5_834n,
      payerAmountZmwMinor: null,
      purgeAt: new Date(now.getTime() + 86_400_000),
      rateZmwMinorPerBitcoin: 180_000_000n,
      updatedAt: now,
    });
    return { id, now };
  }

  async function createBridge(suffix: string, destinationAmount = 10_000n) {
    const quote = await seedQuote();
    const intentId = randomUUID();
    return coordinator().create({
      collectionIdempotencyKey: `collection:${suffix}`,
      destination: { network: "mtn", phone: "0971234567", type: "mobile_money" },
      destinationAmount,
      destinationAsset: "ZMW",
      destinationExpiresAt: new Date(quote.now.getTime() + 300_000),
      direction: "btc_to_zmw",
      intent: {
        createdAt: quote.now,
        destinationAmount,
        destinationAsset: "ZMW",
        direction: "btc_to_zmw",
        expiresAt: new Date(quote.now.getTime() + 180_000),
        id: intentId,
        idempotencyKey: `intent:${suffix}`,
        provider: "fake_treasury",
        purgeAt: new Date(quote.now.getTime() + 86_400_000),
        quoteId: quote.id,
        sourceAmount: 5_834n,
        sourceAsset: "BTC",
      },
      settlementIdempotencyKey: `settlement:${suffix}`,
      sourceAmount: 5_834n,
      sourceAsset: "BTC",
      sourcePaymentExpiresAt: new Date(quote.now.getTime() + 180_000),
    });
  }

  it("applies all migrations and enforces accounting, positivity and mapping constraints", async () => {
    const created = await createBridge("constraints");
    const saga = coordinator();
    await saga.markSourceOutcome(created.settlement.id, "settled");
    await saga.processNextDestination();
    const [journal] = await database.select().from(treasuryJournalTransactions).limit(1);
    expect(journal).toBeDefined();

    await expect(
      pool.query("update treasury_journal_transactions set opaque_reference = 'changed'"),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query("delete from treasury_journal_entries where transaction_id = $1", [journal?.id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query(
        "insert into liquidity_reservations (id, bridge_settlement_id, asset, amount, status, expires_at, purge_at) values ($1,$2,'ZMW',0,'active',now()+interval '1 minute',now()+interval '1 day')",
        [randomUUID(), created.settlement.id],
      ),
    ).rejects.toThrow(/amount_positive/);
    await expect(
      pool.query(
        "insert into bridge_settlements (id,payment_intent_id,direction,status,source_asset,source_amount,destination_asset,destination_amount,collection_idempotency_key,settlement_idempotency_key,exchange_group_id,expires_at,source_payment_expires_at,destination_expires_at,creation_fingerprint,purge_at) select $1,payment_intent_id,direction,status,source_asset,source_amount,destination_asset,destination_amount,$2,$3,$4,expires_at,source_payment_expires_at,destination_expires_at,'different',purge_at from bridge_settlements where id=$5",
        [
          randomUUID(),
          "different-collection",
          "different-settlement",
          randomUUID(),
          created.settlement.id,
        ],
      ),
    ).rejects.toThrow(/payment_intent/);
    await expect(
      pool.query(
        "insert into public_payment_requests (id,idempotency_key,amount_zmw_minor,receive_asset,destination_lookup_token,created_at,expires_at,purge_at) values ($1,$2,0,'ZMW',$3,now(),now()+interval '1 minute',now()+interval '1 day')",
        [randomUUID(), `invalid:${randomUUID()}`, randomUUID()],
      ),
    ).rejects.toThrow(/amount_positive/);

    const unbalancedId = randomUUID();
    await pool.query("begin");
    await pool.query(
      "insert into treasury_journal_transactions (id,exchange_group_id,asset,kind,idempotency_key,occurred_at) values ($1,$2,'BTC','refund',$3,now())",
      [unbalancedId, randomUUID(), `unbalanced:${unbalancedId}`],
    );
    await pool.query(
      "insert into treasury_journal_entries (id,transaction_id,account_code,side,amount) values ($1,$2,'a','debit',2),($3,$2,'b','credit',1)",
      [randomUUID(), unbalancedId, randomUUID()],
    );
    await expect(pool.query("commit")).rejects.toThrow(/not balanced/);
    await pool.query("rollback");
  });

  it("recovers creation, event ingestion and destination settlement across coordinator restarts", async () => {
    const created = await createBridge("restart");
    const event = {
      id: randomUUID(),
      normalizedStatus: "source_settled" as const,
      occurredAt: new Date(),
      payloadHash: "restart-hash",
      provider: "fake_treasury",
      providerEventId: "restart-event",
      purgeAt: new Date(Date.now() + 86_400_000),
      receivedAt: new Date(),
      sourceReference: created.sourceReference,
    };
    expect(await coordinator().appendProviderEvent(event)).toBe("inserted");
    expect((await coordinator().processNextProviderEvent())?.status).toBe(
      "destination_settlement_queued",
    );
    expect((await coordinator().processNextDestination())?.status).toBe("settled");
    expect(await coordinator().appendProviderEvent(event)).toBe("duplicate");
    expect(await repository.readJournal()).toHaveLength(4);
    expect(await repository.pendingDestinationWork()).toBe(0);
  });

  it("isolates a poisoned event without blocking a later valid event", async () => {
    const created = await createBridge("rollback");
    await database
      .delete(settlementObligations)
      .where(eq(settlementObligations.bridgeSettlementId, created.settlement.id));
    const receivedAt = new Date();
    await coordinator().appendProviderEvent({
      id: randomUUID(),
      normalizedStatus: "source_settled",
      occurredAt: new Date(),
      payloadHash: "rollback-hash",
      provider: "fake_treasury",
      providerEventId: "rollback-event",
      purgeAt: new Date(Date.now() + 86_400_000),
      receivedAt,
      sourceReference: created.sourceReference,
    });
    const valid = await createBridge("after-poison");
    await coordinator().appendProviderEvent({
      id: randomUUID(),
      normalizedStatus: "source_settled",
      occurredAt: new Date(),
      payloadHash: "after-poison-hash",
      provider: "fake_treasury",
      providerEventId: "after-poison-event",
      purgeAt: new Date(Date.now() + 86_400_000),
      receivedAt: new Date(receivedAt.getTime() + 1),
      sourceReference: valid.sourceReference,
    });
    expect(
      (await coordinator().processNextProviderEvent(new Date(receivedAt.getTime() + 1)))?.id,
    ).toBe(valid.settlement.id);
    const [event] = await database
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.providerEventId, "rollback-event"));
    const [sourceLeg] = await database
      .select()
      .from(bridgeSettlementLegs)
      .where(eq(bridgeSettlementLegs.bridgeSettlementId, created.settlement.id));
    expect(event?.processedAt).toBeNull();
    expect(event?.processingAttemptCount).toBe(1);
    expect(event?.lastProcessingFailureCode).toBe("EVENT_INVARIANT_MISSING_OBLIGATION");
    expect(sourceLeg?.status).toBe("pending");
    expect((await repository.read(created.settlement.id))?.status).toBe("awaiting_source_payment");
    await coordinator().processNextProviderEvent(new Date(receivedAt.getTime() + 6_000));
    await coordinator().processNextProviderEvent(new Date(receivedAt.getTime() + 17_000));
    const [deadLettered] = await database
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.providerEventId, "rollback-event"));
    expect(deadLettered?.deadLetteredAt).not.toBeNull();
    expect(deadLettered?.processingAttemptCount).toBe(3);
    await database
      .delete(providerEvents)
      .where(eq(providerEvents.providerEventId, "rollback-event"));
  });

  it("keeps concurrent event failure metadata on the exact poisoned row", async () => {
    const poisoned = await createBridge("concurrent-poison");
    await database
      .delete(settlementObligations)
      .where(eq(settlementObligations.bridgeSettlementId, poisoned.settlement.id));
    const valid = await createBridge("concurrent-valid");
    const now = new Date();
    const poisonedEventId = randomUUID();
    const validEventId = randomUUID();
    await coordinator().appendProviderEvent({
      id: poisonedEventId,
      normalizedStatus: "source_settled",
      occurredAt: now,
      payloadHash: "concurrent-poison-hash",
      provider: "fake_treasury",
      providerEventId: "concurrent-poison-event",
      purgeAt: new Date(now.getTime() + 86_400_000),
      receivedAt: now,
      sourceReference: poisoned.sourceReference,
    });
    await coordinator().appendProviderEvent({
      id: validEventId,
      normalizedStatus: "source_settled",
      occurredAt: now,
      payloadHash: "concurrent-valid-hash",
      provider: "fake_treasury",
      providerEventId: "concurrent-valid-event",
      purgeAt: new Date(now.getTime() + 86_400_000),
      receivedAt: new Date(now.getTime() + 1),
      sourceReference: valid.sourceReference,
    });

    await Promise.all([
      coordinator().processNextProviderEvent(new Date(now.getTime() + 1)),
      coordinator().processNextProviderEvent(new Date(now.getTime() + 1)),
    ]);
    const events = await database
      .select()
      .from(providerEvents)
      .where(inArray(providerEvents.id, [poisonedEventId, validEventId]));
    const poisonedEvent = events.find((event) => event.id === poisonedEventId);
    const validEvent = events.find((event) => event.id === validEventId);
    expect(poisonedEvent?.processingAttemptCount).toBe(1);
    expect(poisonedEvent?.processedAt).toBeNull();
    expect(validEvent?.processingAttemptCount).toBe(0);
    expect(validEvent?.processedAt).not.toBeNull();
    expect((await repository.read(valid.settlement.id))?.status).toBe(
      "destination_settlement_queued",
    );
    expect(
      (
        await database
          .select()
          .from(treasuryJournalTransactions)
          .where(eq(treasuryJournalTransactions.exchangeGroupId, valid.settlement.exchangeGroupId))
      ).filter((entry) => entry.kind === "source_collection"),
    ).toHaveLength(1);

    const isolation = repository as unknown as {
      isolateProviderEvent(eventId: string, at: Date, safeCode: string): Promise<void>;
    };
    await isolation.isolateProviderEvent(
      validEventId,
      new Date(now.getTime() + 2),
      "EVENT_PROCESSING_INTERNAL",
    );
    const [unchanged] = await database
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.id, validEventId));
    expect(unchanged?.processingAttemptCount).toBe(0);
    expect(unchanged?.lastProcessingFailureCode).toBeNull();
    await coordinator().processNextProviderEvent(new Date(now.getTime() + 6_000));
    await coordinator().processNextProviderEvent(new Date(now.getTime() + 17_000));
  });

  it("terminalizes conclusive source setup and provider failures without destination work", async () => {
    bitcoin.queueOutcome("create_invoice", "failure");
    await expect(createBridge("setup-failure")).rejects.toThrow();
    const setupFailure = await repository.findByCollectionKey("collection:setup-failure");
    expect(setupFailure?.status).toBe("source_payment_failed");

    const providerFailure = await createBridge("provider-failure");
    await coordinator().markSourceOutcome(providerFailure.settlement.id, "failed");
    await coordinator().markSourceOutcome(
      providerFailure.settlement.id,
      "failed",
      new Date(Date.now() + 1),
    );

    for (const settlementId of [setupFailure?.id, providerFailure.settlement.id]) {
      expect(settlementId).toBeDefined();
      const [sourceLeg] = await database
        .select()
        .from(bridgeSettlementLegs)
        .where(
          and(
            eq(bridgeSettlementLegs.bridgeSettlementId, settlementId ?? ""),
            eq(bridgeSettlementLegs.kind, "source"),
          ),
        );
      const [reservation] = await database
        .select()
        .from(liquidityReservations)
        .where(eq(liquidityReservations.bridgeSettlementId, settlementId ?? ""));
      const [obligation] = await database
        .select()
        .from(settlementObligations)
        .where(eq(settlementObligations.bridgeSettlementId, settlementId ?? ""));
      expect(sourceLeg?.status).toBe("failed");
      expect(reservation?.status).toBe("released");
      expect(obligation?.status).toBe("failed");
      expect(
        await database
          .select()
          .from(destinationSettlementOutbox)
          .innerJoin(
            settlementObligations,
            eq(destinationSettlementOutbox.settlementObligationId, settlementObligations.id),
          )
          .where(eq(settlementObligations.bridgeSettlementId, settlementId ?? "")),
      ).toHaveLength(0);
      expect(await repository.refundObligationCount(settlementId ?? "")).toBe(0);
    }
    const [setupOutbox] = await database
      .select()
      .from(providerIntentOutbox)
      .where(eq(providerIntentOutbox.paymentIntentId, setupFailure?.paymentIntentId ?? ""));
    expect(setupOutbox?.processedAt).not.toBeNull();
  });

  it("credits one late source settlement after conclusive failure and purges resolved failures only after grace", async () => {
    const late = await createBridge("failed-then-late");
    await coordinator().markSourceOutcome(late.settlement.id, "failed");
    const balanceBefore = (await repository.readStatus()).bookBtcBalanceSats;
    await coordinator().markSourceOutcome(late.settlement.id, "settled", new Date(Date.now() + 1));
    await coordinator().markSourceOutcome(late.settlement.id, "settled", new Date(Date.now() + 2));
    expect((await repository.readStatus()).bookBtcBalanceSats).toBe(
      balanceBefore + late.settlement.sourceAmount,
    );
    expect(await repository.refundObligationCount(late.settlement.id)).toBe(1);

    const resolved = await createBridge("resolved-source-failure");
    await coordinator().markSourceOutcome(resolved.settlement.id, "failed");
    const unknown = await createBridge("retained-unknown-source");
    await coordinator().markSourceOutcome(unknown.settlement.id, "unknown");
    const old = new Date("2020-01-01T00:00:00.000Z");
    await database
      .update(bridgeSettlements)
      .set({ purgeAt: old, sourcePaymentExpiresAt: old })
      .where(inArray(bridgeSettlements.id, [resolved.settlement.id, unknown.settlement.id]));
    await database
      .update(paymentIntents)
      .set({ purgeAt: old })
      .where(
        inArray(paymentIntents.id, [
          resolved.settlement.paymentIntentId,
          unknown.settlement.paymentIntentId,
        ]),
      );
    await database
      .update(providerEvents)
      .set({ purgeAt: old })
      .where(
        inArray(providerEvents.paymentIntentId, [
          resolved.settlement.paymentIntentId,
          unknown.settlement.paymentIntentId,
        ]),
      );
    await purgeExpiredOperationalData(database, new Date(), 60);
    expect(
      await database
        .select()
        .from(bridgeSettlements)
        .where(eq(bridgeSettlements.id, resolved.settlement.id)),
    ).toHaveLength(0);
    expect(
      await database
        .select()
        .from(bridgeSettlements)
        .where(eq(bridgeSettlements.id, unknown.settlement.id)),
    ).toHaveLength(1);
  });

  it("replays external success safely and creates one refund after vault loss", async () => {
    const crash = await createBridge("external-crash");
    await coordinator().markSourceOutcome(crash.settlement.id, "settled");
    const claimed = await repository.claimDestinationSettlementByBridgeId(
      crash.settlement.id,
      new Date(),
      1,
    );
    expect(claimed).not.toBeNull();
    const balanceBefore = (await mobileMoney.readStatus()).availableBalanceZmwMinor;
    await mobileMoney.disburse({
      amountZmwMinor: crash.settlement.destinationAmount,
      destination: { network: "mtn", phone: "0971234567", type: "mobile_money" },
      idempotencyKey: crash.settlement.settlementIdempotencyKey,
    });
    const replacementVault = new InMemorySettlementDestinationVault(
      () => crash.destinationLookupToken,
    );
    replacementVault.put(
      { network: "mtn", phone: "0971234567", type: "mobile_money" },
      crash.settlement.destinationExpiresAt,
    );
    const restartedRepository = new PostgresSettlementSagaRepository(database, config);
    const restarted = new RepositoryBackedSettlementCoordinator({
      bitcoin: new FakeVoltageLndTreasury(bitcoinRemote),
      mobileMoney: new FakeLipilaMobileMoneyTreasury(mobileMoneyRemote),
      reconciliation: new DeterministicFakeReconciliationService(),
      repository: restartedRepository,
      vault: replacementVault,
    });
    expect(
      (await restarted.processDestination(crash.settlement.id, new Date(Date.now() + 5))).status,
    ).toBe("settled");
    expect((await mobileMoney.readStatus()).availableBalanceZmwMinor).toBe(
      balanceBefore - crash.settlement.destinationAmount,
    );
    expect(
      (await repository.readAttemptEvents(crash.settlement.settlementIdempotencyKey)).map(
        (event) => event.attemptNumber,
      ),
    ).toEqual([1, 2, 2]);

    const lost = await createBridge("lost-vault");
    await coordinator().markSourceOutcome(lost.settlement.id, "settled");
    const restartedWithoutVault = new RepositoryBackedSettlementCoordinator({
      bitcoin,
      mobileMoney,
      reconciliation: new DeterministicFakeReconciliationService(),
      repository,
      vault: new InMemorySettlementDestinationVault(),
    });
    expect((await restartedWithoutVault.processDestination(lost.settlement.id)).status).toBe(
      "refund_required",
    );
    expect(await repository.refundObligationCount(lost.settlement.id)).toBe(1);
    expect(
      await repository.claimDestinationSettlementByBridgeId(lost.settlement.id, new Date(), 30_000),
    ).toBeNull();
    expect(await repository.refundObligationCount(lost.settlement.id)).toBe(1);
  });

  it("persists opening inventory once and protects concurrent durable reservations", async () => {
    await repository.initializeInventory();
    const before = await database.select().from(treasuryInventoryPositions);
    const changedConfig = loadConfig({
      BRIDGE_ENGINE_MODE: "fake",
      DATABASE_URL: connectionString,
      FAKE_BITCOIN_TREASURY_BALANCE_SATS: "1",
      FAKE_LIPILA_BALANCE_ZMW_MINOR: "1",
      NODE_ENV: "test",
    });
    await new PostgresSettlementSagaRepository(database, changedConfig).initializeInventory();
    expect(await database.select().from(treasuryInventoryPositions)).toEqual(before);

    const zmw = before.find((item) => item.asset === "ZMW")?.currentBalance ?? 0n;
    const amount = zmw / 2n + 1n;
    const reservations = await Promise.allSettled([
      createBridge("parallel-one", amount),
      createBridge("parallel-two", amount),
    ]);
    expect(reservations.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(reservations.filter((item) => item.status === "rejected")).toHaveLength(1);
    await coordinator().expireNextSourcePayment(new Date(Date.now() + 181_000));
  });

  it("credits late source value once after expiry and creates one refund without destination work", async () => {
    const created = await createBridge("late-source");
    const expiry = created.settlement.sourcePaymentExpiresAt;
    await coordinator().expireNextSourcePayment(expiry);
    const before = (await repository.readStatus()).bookBtcBalanceSats;
    expect(
      (await coordinator().markSourceOutcome(created.settlement.id, "settled", expiry)).status,
    ).toBe("refund_required");
    expect((await repository.readStatus()).bookBtcBalanceSats).toBe(
      before + created.settlement.sourceAmount,
    );
    expect(await repository.refundObligationCount(created.settlement.id)).toBe(1);
    expect(
      await database
        .select()
        .from(destinationSettlementOutbox)
        .innerJoin(
          settlementObligations,
          eq(destinationSettlementOutbox.settlementObligationId, settlementObligations.id),
        )
        .where(eq(settlementObligations.bridgeSettlementId, created.settlement.id)),
    ).toHaveLength(0);
    await coordinator().markSourceOutcome(
      created.settlement.id,
      "settled",
      new Date(expiry.getTime() + 1),
    );
    expect(await repository.refundObligationCount(created.settlement.id)).toBe(1);
    expect((await repository.readStatus()).bookBtcBalanceSats).toBe(
      before + created.settlement.sourceAmount,
    );
  });

  it("claims targeted work and preserves append-only monotonic transport attempts", async () => {
    const first = await createBridge("target-first");
    const second = await createBridge("target-second");
    await coordinator().markSourceOutcome(first.settlement.id, "settled");
    await coordinator().markSourceOutcome(second.settlement.id, "settled");
    expect((await coordinator().processDestination(second.settlement.id)).id).toBe(
      second.settlement.id,
    );
    expect((await repository.read(first.settlement.id))?.status).toBe(
      "destination_settlement_queued",
    );

    mobileMoney.queueOutcome("disburse", "failure");
    expect((await coordinator().processDestination(first.settlement.id)).status).toBe(
      "destination_settlement_failed",
    );
    expect((await coordinator().retryDestination(first.settlement.id)).status).toBe("settled");
    const history = await repository.readAttemptEvents(first.settlement.settlementIdempotencyKey);
    expect(history.map((event) => [event.attemptNumber, event.kind])).toEqual([
      [1, "started"],
      [1, "failed"],
      [2, "started"],
      [2, "succeeded"],
    ]);
    const [historicalFailure] = await database
      .select()
      .from(settlementAttemptEvents)
      .where(
        and(
          eq(settlementAttemptEvents.settlementAttemptId, history[0]?.settlementAttemptId ?? ""),
          eq(settlementAttemptEvents.kind, "failed"),
        ),
      );
    await expect(
      pool.query("update settlement_attempt_events set failure_code = 'CHANGED' where id = $1", [
        historicalFailure?.id,
      ]),
    ).rejects.toThrow(/append-only/);
  });

  it("retains unresolved financial states and purges only fully resolved terminal sagas", async () => {
    const manual = await createBridge("retention-manual");
    await coordinator().markSourceOutcome(manual.settlement.id, "unknown");

    const refund = await createBridge("retention-refund");
    await coordinator().expireNextSourcePayment(refund.settlement.sourcePaymentExpiresAt);
    await coordinator().markSourceOutcome(
      refund.settlement.id,
      "settled",
      refund.settlement.sourcePaymentExpiresAt,
    );

    const pending = await createBridge("retention-refund-pending");
    await coordinator().expireNextSourcePayment(pending.settlement.sourcePaymentExpiresAt);
    await coordinator().markSourceOutcome(
      pending.settlement.id,
      "settled",
      pending.settlement.sourcePaymentExpiresAt,
    );
    await database
      .update(refundObligations)
      .set({ status: "pending" })
      .where(eq(refundObligations.bridgeSettlementId, pending.settlement.id));
    await database
      .update(bridgeSettlements)
      .set({ status: "refund_pending" })
      .where(eq(bridgeSettlements.id, pending.settlement.id));

    const processing = await createBridge("retention-processing");
    await coordinator().markSourceOutcome(processing.settlement.id, "settled");
    await repository.claimDestinationSettlementByBridgeId(
      processing.settlement.id,
      new Date(),
      60_000,
    );

    const active = await createBridge("retention-active");

    const review = await createBridge("retention-review");
    await coordinator().markSourceOutcome(review.settlement.id, "settled");
    const reviewWork = await repository.claimDestinationSettlementByBridgeId(
      review.settlement.id,
      new Date(),
      30_000,
    );
    expect(reviewWork).not.toBeNull();
    if (reviewWork) {
      await repository.finalizeDestinationSettlement(
        reviewWork,
        {
          opaqueReference: `review-${randomUUID()}`,
          outcome: "success",
          reconciliation: {
            checkedAt: new Date(),
            outcome: "mismatch",
            safeCode: "BOOK_PROVIDER_MISMATCH",
          },
        },
        new Date(),
      );
    }

    const terminal = await createBridge("retention-terminal");
    await coordinator().markSourceOutcome(terminal.settlement.id, "settled");
    await coordinator().processDestination(terminal.settlement.id);
    const retainedIds = [
      manual.settlement.id,
      refund.settlement.id,
      pending.settlement.id,
      processing.settlement.id,
      active.settlement.id,
      review.settlement.id,
    ];
    const allIds = [...retainedIds, terminal.settlement.id];
    const old = new Date("2020-01-01T00:00:00.000Z");
    await database
      .update(bridgeSettlements)
      .set({ purgeAt: old, sourcePaymentExpiresAt: old })
      .where(inArray(bridgeSettlements.id, allIds));
    await database
      .update(paymentIntents)
      .set({ purgeAt: old })
      .where(
        inArray(
          paymentIntents.id,
          [manual, refund, pending, processing, active, review, terminal].map(
            (item) => item.settlement.paymentIntentId,
          ),
        ),
      );
    await purgeExpiredOperationalData(database, new Date(), 60);
    expect(
      (
        await database
          .select({ id: bridgeSettlements.id })
          .from(bridgeSettlements)
          .where(inArray(bridgeSettlements.id, retainedIds))
      )
        .map((item) => item.id)
        .sort(),
    ).toEqual([...retainedIds].sort());
    expect(
      await database
        .select()
        .from(bridgeSettlements)
        .where(eq(bridgeSettlements.id, terminal.settlement.id)),
    ).toHaveLength(0);
    expect(
      await database
        .select()
        .from(treasuryJournalTransactions)
        .where(
          eq(treasuryJournalTransactions.exchangeGroupId, terminal.settlement.exchangeGroupId),
        ),
    ).not.toHaveLength(0);
  });

  it("persists only a restart-safe public checkout envelope and purges it operationally", async () => {
    const paymentStore = new PostgresPaymentStore(database, config);
    const publicStore = new PostgresPublicRequestStore(database, paymentStore);
    const quote = await seedQuote();
    const storedQuote = await paymentStore.getQuote(quote.id);
    expect(storedQuote).toBeDefined();
    const publicId = randomUUID();
    const record = {
      destinationLookupToken: randomUUID(),
      idempotencyKey: `public:${randomUUID()}`,
      purgeAt: new Date(quote.now.getTime() + 120_000),
      request: {
        amountZmw: "100.00",
        createdAt: quote.now.toISOString(),
        developmentOnly: true as const,
        expiresAt: new Date(quote.now.getTime() + 60_000).toISOString(),
        options: [{ payerMethod: "BTC" as const, quote: storedQuote?.response }],
        publicId,
        receiveAsset: "ZMW" as const,
      },
    };
    if (!storedQuote) {
      throw new Error("The public-request test quote was not stored.");
    }
    const saved = await publicStore.save({
      ...record,
      request: {
        ...record.request,
        options: [{ payerMethod: "BTC", quote: storedQuote.response }],
      },
    });
    expect(saved.created).toBe(true);
    expect((await publicStore.save(saved.record)).created).toBe(false);
    const replacement = new PostgresPublicRequestStore(database, paymentStore);
    expect((await replacement.get(publicId))?.request).toEqual(saved.record.request);

    const columns = await pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_payment_requests' order by column_name",
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "amount_zmw_minor",
      "created_at",
      "destination_lookup_token",
      "expires_at",
      "id",
      "idempotency_key",
      "purge_at",
      "receive_asset",
    ]);
    const serialized = JSON.stringify(await replacement.get(publicId));
    for (const forbidden of [
      "phone",
      "invoice",
      "address",
      "merchantLabel",
      "customer",
      "business",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    await database
      .update(publicPaymentRequests)
      .set({
        createdAt: new Date("2020-01-01T00:00:00.000Z"),
        expiresAt: new Date("2020-01-01T00:01:00.000Z"),
        purgeAt: new Date("2020-01-01T00:02:00.000Z"),
      })
      .where(eq(publicPaymentRequests.id, publicId));
    const purged = await purgeExpiredOperationalData(database, new Date(), 60);
    expect(purged.publicPaymentRequests).toBe(1);
    expect(await replacement.get(publicId)).toBeUndefined();
    expect(
      await database
        .select()
        .from(publicPaymentRequestOptions)
        .where(eq(publicPaymentRequestOptions.publicRequestId, publicId)),
    ).toHaveLength(0);
  });
});
