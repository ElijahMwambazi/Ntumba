import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { loadConfig } from "@ntumba/config";
import {
  bridgeSettlementLegs,
  createDatabase,
  providerEvents,
  quotes,
  settlementObligations,
  treasuryJournalTransactions,
} from "@ntumba/database";
import {
  DeterministicFakeReconciliationService,
  FakeLipilaMobileMoneyTreasury,
  FakeVoltageLndTreasury,
  InMemorySettlementDestinationVault,
  RepositoryBackedSettlementCoordinator,
} from "@ntumba/treasury";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresSettlementSagaRepository } from "./postgres-settlement-saga-repository.js";

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
  const bitcoin = new FakeVoltageLndTreasury();
  const mobileMoney = new FakeLipilaMobileMoneyTreasury();
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

  async function createBridge(suffix: string) {
    const quote = await seedQuote();
    const intentId = randomUUID();
    return coordinator().create({
      collectionIdempotencyKey: `collection:${suffix}`,
      destination: { network: "mtn", phone: "0971234567", type: "mobile_money" },
      destinationAmount: 10_000n,
      destinationAsset: "ZMW",
      destinationExpiresAt: new Date(quote.now.getTime() + 300_000),
      direction: "btc_to_zmw",
      intent: {
        createdAt: quote.now,
        destinationAmount: 10_000n,
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

  it("rolls back event application when the obligation is missing", async () => {
    const created = await createBridge("rollback");
    await database
      .delete(settlementObligations)
      .where(eq(settlementObligations.bridgeSettlementId, created.settlement.id));
    await coordinator().appendProviderEvent({
      id: randomUUID(),
      normalizedStatus: "source_settled",
      occurredAt: new Date(),
      payloadHash: "rollback-hash",
      provider: "fake_treasury",
      providerEventId: "rollback-event",
      purgeAt: new Date(Date.now() + 86_400_000),
      receivedAt: new Date(),
      sourceReference: created.sourceReference,
    });
    await expect(coordinator().processNextProviderEvent()).rejects.toThrow(
      "destination obligation",
    );
    const [event] = await database
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.providerEventId, "rollback-event"));
    const [sourceLeg] = await database
      .select()
      .from(bridgeSettlementLegs)
      .where(eq(bridgeSettlementLegs.bridgeSettlementId, created.settlement.id));
    expect(event?.processedAt).toBeNull();
    expect(sourceLeg?.status).toBe("pending");
    expect((await repository.read(created.settlement.id))?.status).toBe("awaiting_source_payment");
    await database
      .delete(providerEvents)
      .where(eq(providerEvents.providerEventId, "rollback-event"));
  });

  it("replays external success safely and creates one refund after vault loss", async () => {
    const crash = await createBridge("external-crash");
    await coordinator().markSourceOutcome(crash.settlement.id, "settled");
    const claimed = await repository.claimDestinationSettlement(new Date(), 1);
    expect(claimed).not.toBeNull();
    await mobileMoney.disburse({
      amountZmwMinor: crash.settlement.destinationAmount,
      destination: { network: "mtn", phone: "0971234567", type: "mobile_money" },
      idempotencyKey: crash.settlement.settlementIdempotencyKey,
    });
    expect((await coordinator().processNextDestination(new Date(Date.now() + 5)))?.status).toBe(
      "settled",
    );

    const lost = await createBridge("lost-vault");
    await coordinator().markSourceOutcome(lost.settlement.id, "settled");
    const restartedWithoutVault = new RepositoryBackedSettlementCoordinator({
      bitcoin,
      mobileMoney,
      reconciliation: new DeterministicFakeReconciliationService(),
      repository,
      vault: new InMemorySettlementDestinationVault(),
    });
    expect((await restartedWithoutVault.processNextDestination())?.status).toBe("refund_required");
    expect(await repository.refundObligationCount(lost.settlement.id)).toBe(1);
    expect(await restartedWithoutVault.processNextDestination()).toBeNull();
    expect(await repository.refundObligationCount(lost.settlement.id)).toBe(1);
  });
});
