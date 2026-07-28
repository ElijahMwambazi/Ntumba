import { randomUUID } from "node:crypto";
import type { NtumbaConfig } from "@ntumba/config";
import {
  bridgeSettlementLegs,
  bridgeSettlements,
  destinationSettlementOutbox,
  liquidityReservations,
  type NtumbaDatabase,
  paymentIntents,
  providerEvents,
  providerIntentOutbox,
  reconciliationResults,
  refundObligations,
  settlementAttempts,
  settlementObligations,
  treasuryJournalEntries,
  treasuryJournalTransactions,
} from "@ntumba/database";
import { assertTransition } from "@ntumba/domain";
import type {
  BridgeSettlement,
  DestinationSettlementWork,
  NormalizedProviderEventInput,
  ProviderEventApplication,
  ReconciliationResult,
  SettlementRepositoryStatus,
  SettlementSagaRepository,
  StageBridgeInput,
  StoredSettlementAttempt,
  TreasuryAsset,
  TreasuryJournalTransaction,
} from "@ntumba/treasury";
import { and, asc, count, desc, eq, isNull, or, sql, sum } from "drizzle-orm";

type BridgeRow = typeof bridgeSettlements.$inferSelect;

function mapSettlement(
  row: BridgeRow,
  sourceReference: string | null,
  destinationReference: string | null,
  reservationId: string | null,
  settlementAttemptCount: number,
): BridgeSettlement {
  if (
    row.direction === "btc_to_btc" ||
    row.status === "direct_payment_pending" ||
    row.status === "direct_payment_settled"
  ) {
    throw new Error("A direct payment cannot be mapped as a bridge settlement.");
  }
  const status =
    row.status === "provider_collecting"
      ? "awaiting_source_payment"
      : row.status === "provider_settling"
        ? "destination_settlement_processing"
        : row.status === "failed"
          ? "manual_review"
          : row.status;
  return {
    collectionIdempotencyKey: row.collectionIdempotencyKey,
    createdAt: row.createdAt,
    creationFingerprint: row.creationFingerprint,
    destinationAmount: row.destinationAmount,
    destinationAsset: row.destinationAsset,
    destinationExpiresAt: row.destinationExpiresAt,
    destinationLookupToken: row.destinationLookupToken,
    destinationReference,
    direction: row.direction,
    exchangeGroupId: row.exchangeGroupId,
    expiresAt: row.sourcePaymentExpiresAt,
    failureCode: row.failureCode,
    id: row.id,
    paymentIntentId: row.paymentIntentId,
    reconciliationReviewRequired: row.reconciliationReviewRequired,
    reservationId,
    settlementAttemptCount,
    settlementIdempotencyKey: row.settlementIdempotencyKey,
    sourceAmount: row.sourceAmount,
    sourceAsset: row.sourceAsset,
    sourcePaymentExpiresAt: row.sourcePaymentExpiresAt,
    sourceReference,
    status,
    updatedAt: row.updatedAt,
  };
}

function mapAttempt(row: typeof settlementAttempts.$inferSelect): StoredSettlementAttempt {
  return {
    completedAt: row.completedAt,
    failureCode: row.failureCode,
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    opaqueReference: row.opaqueReference,
    outcome: row.outcome,
    settlementObligationId: row.settlementObligationId,
    startedAt: row.startedAt,
  };
}

function normalizedSourceStatus(
  status: typeof providerEvents.$inferSelect.normalizedStatus,
): "source_pending" | "source_confirming" | "source_settled" | "failed" | "unknown" {
  if (status === "collecting") {
    return "source_pending";
  }
  if (
    status === "source_pending" ||
    status === "source_confirming" ||
    status === "source_settled"
  ) {
    return status;
  }
  return status === "failed" || status === "expired" ? "failed" : "unknown";
}

export class PostgresSettlementSagaRepository implements SettlementSagaRepository {
  constructor(
    readonly database: NtumbaDatabase,
    readonly config: NtumbaConfig,
  ) {}

  async stageBridge(
    input: StageBridgeInput,
  ): Promise<{ created: boolean; settlement: BridgeSettlement }> {
    const result = await this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`ntumba:${input.intent.destinationAsset}`}))`,
      );
      const [existing] = await transaction
        .select()
        .from(bridgeSettlements)
        .where(
          or(
            eq(bridgeSettlements.paymentIntentId, input.intent.id),
            eq(bridgeSettlements.collectionIdempotencyKey, input.collectionIdempotencyKey),
            eq(bridgeSettlements.settlementIdempotencyKey, input.settlementIdempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (
          existing.paymentIntentId !== input.intent.id ||
          existing.collectionIdempotencyKey !== input.collectionIdempotencyKey ||
          existing.settlementIdempotencyKey !== input.settlementIdempotencyKey ||
          existing.creationFingerprint !== input.creationFingerprint
        ) {
          throw new Error("Bridge idempotency conflict.");
        }
        return { created: false, id: existing.id };
      }

      const [reserved] = await transaction
        .select({ value: sum(liquidityReservations.amount) })
        .from(liquidityReservations)
        .where(
          and(
            eq(liquidityReservations.asset, input.intent.destinationAsset),
            eq(liquidityReservations.status, "active"),
          ),
        );
      const available =
        input.intent.destinationAsset === "BTC"
          ? this.config.FAKE_BITCOIN_TREASURY_BALANCE_SATS
          : this.config.FAKE_LIPILA_BALANCE_ZMW_MINOR;
      if (available - BigInt(reserved?.value ?? "0") < input.intent.destinationAmount) {
        throw new Error("Destination liquidity is unavailable.");
      }

      await transaction
        .insert(paymentIntents)
        .values({
          createdAt: input.intent.createdAt,
          destinationToken: null,
          direction: input.intent.direction,
          expiresAt: input.sourcePaymentExpiresAt,
          failureCode: null,
          id: input.intent.id,
          idempotencyKey: input.intent.idempotencyKey,
          provider: input.intent.provider,
          providerReference: null,
          purgeAt: input.intent.purgeAt,
          quoteId: input.intent.quoteId,
          settlementAmountSats:
            input.intent.destinationAsset === "BTC" ? input.intent.destinationAmount : null,
          settlementAmountZmwMinor:
            input.intent.destinationAsset === "ZMW" ? input.intent.destinationAmount : null,
          settlementAsset: input.intent.destinationAsset,
          sourceAmountSats: input.intent.sourceAsset === "BTC" ? input.intent.sourceAmount : null,
          sourceAmountZmwMinor:
            input.intent.sourceAsset === "ZMW" ? input.intent.sourceAmount : null,
          sourceAsset: input.intent.sourceAsset,
          status: "quote_locked",
          updatedAt: input.intent.createdAt,
        })
        .onConflictDoNothing({ target: paymentIntents.idempotencyKey });
      const [persistedIntent] = await transaction
        .select()
        .from(paymentIntents)
        .where(eq(paymentIntents.idempotencyKey, input.intent.idempotencyKey))
        .limit(1);
      if (
        !persistedIntent ||
        persistedIntent.id !== input.intent.id ||
        persistedIntent.quoteId !== input.intent.quoteId ||
        persistedIntent.direction !== input.intent.direction
      ) {
        throw new Error("Payment intent idempotency conflict.");
      }

      const bridgeId = randomUUID();
      const reservationId = randomUUID();
      const obligationId = randomUUID();
      await transaction.insert(bridgeSettlements).values({
        collectionIdempotencyKey: input.collectionIdempotencyKey,
        createdAt: input.intent.createdAt,
        creationFingerprint: input.creationFingerprint,
        destinationAmount: input.intent.destinationAmount,
        destinationAsset: input.intent.destinationAsset,
        destinationExpiresAt: input.destinationExpiresAt,
        destinationLookupToken: null,
        direction: input.intent.direction,
        exchangeGroupId: randomUUID(),
        expiresAt: input.sourcePaymentExpiresAt,
        failureCode: null,
        id: bridgeId,
        paymentIntentId: input.intent.id,
        purgeAt: input.intent.purgeAt,
        reconciliationReviewRequired: false,
        settlementIdempotencyKey: input.settlementIdempotencyKey,
        sourceAmount: input.intent.sourceAmount,
        sourceAsset: input.intent.sourceAsset,
        sourcePaymentExpiresAt: input.sourcePaymentExpiresAt,
        status: "quote_locked",
        updatedAt: input.intent.createdAt,
      });
      await transaction.insert(bridgeSettlementLegs).values([
        {
          amount: input.intent.sourceAmount,
          asset: input.intent.sourceAsset,
          bridgeSettlementId: bridgeId,
          createdAt: input.intent.createdAt,
          failureCode: null,
          id: randomUUID(),
          idempotencyKey: input.collectionIdempotencyKey,
          kind: "source",
          opaqueReference: null,
          purgeAt: input.intent.purgeAt,
          rail: input.intent.direction === "btc_to_zmw" ? "fake_voltage" : "fake_lipila",
          status: "pending",
          updatedAt: input.intent.createdAt,
        },
        {
          amount: input.intent.destinationAmount,
          asset: input.intent.destinationAsset,
          bridgeSettlementId: bridgeId,
          createdAt: input.intent.createdAt,
          failureCode: null,
          id: randomUUID(),
          idempotencyKey: input.settlementIdempotencyKey,
          kind: "destination",
          opaqueReference: null,
          purgeAt: input.intent.purgeAt,
          rail: input.intent.direction === "btc_to_zmw" ? "fake_lipila" : "fake_voltage",
          status: "pending",
          updatedAt: input.intent.createdAt,
        },
      ]);
      await transaction.insert(liquidityReservations).values({
        amount: input.intent.destinationAmount,
        asset: input.intent.destinationAsset,
        bridgeSettlementId: bridgeId,
        createdAt: input.intent.createdAt,
        expiresAt: input.destinationExpiresAt,
        id: reservationId,
        purgeAt: input.intent.purgeAt,
        status: "active",
        updatedAt: input.intent.createdAt,
      });
      await transaction.insert(settlementObligations).values({
        amount: input.intent.destinationAmount,
        asset: input.intent.destinationAsset,
        bridgeSettlementId: bridgeId,
        createdAt: input.intent.createdAt,
        dueAt: input.sourcePaymentExpiresAt,
        failureCode: null,
        id: obligationId,
        purgeAt: input.intent.purgeAt,
        status: "waiting_source",
        updatedAt: input.intent.createdAt,
      });
      await transaction.insert(providerIntentOutbox).values({
        attemptCount: 1,
        createdAt: input.intent.createdAt,
        id: randomUUID(),
        lastAttemptAt: input.intent.createdAt,
        lastFailureCode: null,
        paymentIntentId: input.intent.id,
        processedAt: null,
        provider: "fake_treasury",
        purgeAt: input.intent.purgeAt,
        updatedAt: input.intent.createdAt,
      });
      return { created: true, id: bridgeId };
    });
    const settlement = await this.required(result.id);
    return { created: result.created, settlement };
  }

  async attachDestinationToken(
    settlementId: string,
    token: string,
    now: Date,
  ): Promise<BridgeSettlement> {
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(bridgeSettlements)
        .where(eq(bridgeSettlements.id, settlementId))
        .for("update")
        .limit(1);
      if (!row) {
        throw new Error("Bridge settlement was not found.");
      }
      if (row.destinationLookupToken && row.destinationLookupToken !== token) {
        throw new Error("Destination token conflict.");
      }
      await transaction
        .update(bridgeSettlements)
        .set({ destinationLookupToken: token, updatedAt: now })
        .where(eq(bridgeSettlements.id, settlementId));
    });
    return this.required(settlementId);
  }

  async completeSourceSetup(
    settlementId: string,
    sourceReference: string,
    now: Date,
  ): Promise<BridgeSettlement> {
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(bridgeSettlements)
        .where(eq(bridgeSettlements.id, settlementId))
        .for("update")
        .limit(1);
      if (!row) {
        throw new Error("Bridge settlement was not found.");
      }
      const [sourceLeg] = await transaction
        .select()
        .from(bridgeSettlementLegs)
        .where(
          and(
            eq(bridgeSettlementLegs.bridgeSettlementId, settlementId),
            eq(bridgeSettlementLegs.kind, "source"),
          ),
        )
        .limit(1);
      if (!sourceLeg) {
        throw new Error("Source leg was not found.");
      }
      if (sourceLeg.opaqueReference) {
        if (sourceLeg.opaqueReference !== sourceReference) {
          throw new Error("Source reference conflict.");
        }
        return;
      }
      if (row.status !== "quote_locked") {
        throw new Error("Source setup is illegal in the current bridge state.");
      }
      assertTransition(row.status, "awaiting_source_payment");
      await transaction
        .update(bridgeSettlementLegs)
        .set({ opaqueReference: sourceReference, updatedAt: now })
        .where(eq(bridgeSettlementLegs.id, sourceLeg.id));
      await transaction
        .update(bridgeSettlements)
        .set({ status: "awaiting_source_payment", updatedAt: now })
        .where(eq(bridgeSettlements.id, settlementId));
      await transaction
        .update(paymentIntents)
        .set({
          destinationToken: row.destinationLookupToken,
          expiresAt: row.sourcePaymentExpiresAt,
          providerReference: sourceReference,
          status: "awaiting_source_payment",
          updatedAt: now,
        })
        .where(eq(paymentIntents.id, row.paymentIntentId));
      await transaction
        .update(providerIntentOutbox)
        .set({ processedAt: now, updatedAt: now })
        .where(eq(providerIntentOutbox.paymentIntentId, row.paymentIntentId));
    });
    return this.required(settlementId);
  }

  async failSourceSetup(
    settlementId: string,
    outcome: "failure" | "unknown",
    now: Date,
  ): Promise<BridgeSettlement> {
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(bridgeSettlements)
        .where(eq(bridgeSettlements.id, settlementId))
        .for("update")
        .limit(1);
      if (row?.status !== "quote_locked") {
        return;
      }
      const status = outcome === "failure" ? "source_payment_failed" : "manual_review";
      const failureCode = outcome === "failure" ? "SOURCE_SETUP_FAILED" : "SOURCE_SETUP_UNCERTAIN";
      assertTransition(row.status, status);
      await transaction
        .update(bridgeSettlements)
        .set({ failureCode, status, updatedAt: now })
        .where(eq(bridgeSettlements.id, settlementId));
      await transaction
        .update(paymentIntents)
        .set({ failureCode, status, updatedAt: now })
        .where(eq(paymentIntents.id, row.paymentIntentId));
      await transaction
        .update(bridgeSettlementLegs)
        .set({
          failureCode,
          status: outcome === "failure" ? "failed" : "unknown",
          updatedAt: now,
        })
        .where(
          and(
            eq(bridgeSettlementLegs.bridgeSettlementId, settlementId),
            eq(bridgeSettlementLegs.kind, "source"),
          ),
        );
      if (outcome === "failure") {
        await transaction
          .update(liquidityReservations)
          .set({ releasedAt: now, status: "released", updatedAt: now })
          .where(
            and(
              eq(liquidityReservations.bridgeSettlementId, settlementId),
              eq(liquidityReservations.status, "active"),
            ),
          );
      } else {
        await transaction
          .update(settlementObligations)
          .set({ failureCode, status: "manual_review", updatedAt: now })
          .where(eq(settlementObligations.bridgeSettlementId, settlementId));
      }
      await transaction
        .update(providerIntentOutbox)
        .set({ lastFailureCode: failureCode, updatedAt: now })
        .where(eq(providerIntentOutbox.paymentIntentId, row.paymentIntentId));
    });
    return this.required(settlementId);
  }

  async expireNextSourcePayment(now: Date): Promise<ProviderEventApplication | null> {
    const expired = await this.database.transaction(async (transaction) => {
      const locked = await transaction.execute<{
        destination_lookup_token: string | null;
        id: string;
        payment_intent_id: string;
        status: BridgeRow["status"];
      }>(sql`
        select id, payment_intent_id, destination_lookup_token, status
        from bridge_settlements
        where status in ('awaiting_source_payment', 'source_payment_confirming')
          and source_payment_expires_at <= ${now}
        order by source_payment_expires_at
        for update skip locked
        limit 1
      `);
      const bridge = locked.rows[0];
      if (!bridge) {
        return null;
      }
      if (
        bridge.status !== "awaiting_source_payment" &&
        bridge.status !== "source_payment_confirming"
      ) {
        throw new Error("Source expiry is illegal in the current bridge state.");
      }
      assertTransition(bridge.status, "expired");
      await transaction
        .update(liquidityReservations)
        .set({ releasedAt: now, status: "expired", updatedAt: now })
        .where(
          and(
            eq(liquidityReservations.bridgeSettlementId, bridge.id),
            eq(liquidityReservations.status, "active"),
          ),
        );
      await transaction
        .update(bridgeSettlementLegs)
        .set({ failureCode: "SOURCE_EXPIRED", status: "failed", updatedAt: now })
        .where(
          and(
            eq(bridgeSettlementLegs.bridgeSettlementId, bridge.id),
            eq(bridgeSettlementLegs.kind, "source"),
          ),
        );
      await transaction
        .update(settlementObligations)
        .set({ failureCode: "SOURCE_EXPIRED", status: "failed", updatedAt: now })
        .where(eq(settlementObligations.bridgeSettlementId, bridge.id));
      await transaction
        .update(bridgeSettlements)
        .set({ failureCode: "SOURCE_EXPIRED", status: "expired", updatedAt: now })
        .where(eq(bridgeSettlements.id, bridge.id));
      await transaction
        .update(paymentIntents)
        .set({ failureCode: "SOURCE_EXPIRED", status: "expired", updatedAt: now })
        .where(eq(paymentIntents.id, bridge.payment_intent_id));
      return {
        destinationToken: bridge.destination_lookup_token,
        settlementId: bridge.id,
      };
    });
    if (!expired) {
      return null;
    }
    return {
      destinationTokenToDelete: expired.destinationToken,
      settlement: await this.required(expired.settlementId),
    };
  }

  async appendProviderEvent(
    event: NormalizedProviderEventInput,
  ): Promise<"inserted" | "duplicate" | "conflict"> {
    const settlement = await this.findBySourceReference(event.sourceReference);
    if (!settlement) {
      throw new Error("Provider event has no durable source mapping.");
    }
    const inserted = await this.database
      .insert(providerEvents)
      .values({
        id: event.id,
        normalizedStatus: event.normalizedStatus,
        occurredAt: event.occurredAt,
        payloadHash: event.payloadHash,
        paymentIntentId: settlement.paymentIntentId,
        processedAt: null,
        provider: event.provider,
        providerEventId: event.providerEventId,
        purgeAt: event.purgeAt,
        receivedAt: event.receivedAt,
      })
      .onConflictDoNothing({
        target: [providerEvents.provider, providerEvents.providerEventId],
      })
      .returning({ id: providerEvents.id });
    if (inserted.length > 0) {
      return "inserted";
    }
    const [existing] = await this.database
      .select()
      .from(providerEvents)
      .where(
        and(
          eq(providerEvents.provider, event.provider),
          eq(providerEvents.providerEventId, event.providerEventId),
        ),
      )
      .limit(1);
    return existing?.paymentIntentId === settlement.paymentIntentId &&
      existing.payloadHash === event.payloadHash
      ? "duplicate"
      : "conflict";
  }

  async processNextProviderEvent(now: Date): Promise<ProviderEventApplication | null> {
    const result = await this.database.transaction(async (transaction) => {
      const locked = await transaction.execute<{
        id: string;
        normalized_status: typeof providerEvents.$inferSelect.normalizedStatus;
        occurred_at: Date | string;
        payment_intent_id: string;
      }>(sql`
        select id, normalized_status, occurred_at, payment_intent_id
        from provider_events
        where processed_at is null
        order by received_at
        for update skip locked
        limit 1
      `);
      const event = locked.rows[0];
      if (!event) {
        return null;
      }
      const [bridge] = await transaction
        .select()
        .from(bridgeSettlements)
        .where(eq(bridgeSettlements.paymentIntentId, event.payment_intent_id))
        .for("update")
        .limit(1);
      if (!bridge) {
        throw new Error("Provider event has no bridge settlement.");
      }
      const [sourceLeg] = await transaction
        .select()
        .from(bridgeSettlementLegs)
        .where(
          and(
            eq(bridgeSettlementLegs.bridgeSettlementId, bridge.id),
            eq(bridgeSettlementLegs.kind, "source"),
          ),
        )
        .limit(1);
      if (!sourceLeg?.opaqueReference) {
        throw new Error("Provider event bridge has no opaque source mapping.");
      }
      const status = normalizedSourceStatus(event.normalized_status);
      let nextStatus = bridge.status;
      let failureCode = bridge.failureCode;
      let deleteToken: string | null = null;
      if (status === "source_settled") {
        if (
          bridge.status === "awaiting_source_payment" ||
          bridge.status === "source_payment_confirming"
        ) {
          assertTransition(bridge.status, "source_payment_settled");
          assertTransition("source_payment_settled", "destination_settlement_queued");
          nextStatus = "destination_settlement_queued";
          await transaction
            .update(bridgeSettlementLegs)
            .set({ status: "settled", updatedAt: now })
            .where(eq(bridgeSettlementLegs.id, sourceLeg.id));
          const [obligation] = await transaction
            .update(settlementObligations)
            .set({ status: "queued", updatedAt: now })
            .where(eq(settlementObligations.bridgeSettlementId, bridge.id))
            .returning();
          if (!obligation) {
            throw new Error("Source settlement has no destination obligation.");
          }
          const journalId = randomUUID();
          const insertedJournal = await transaction
            .insert(treasuryJournalTransactions)
            .values({
              asset: bridge.sourceAsset,
              exchangeGroupId: bridge.exchangeGroupId,
              id: journalId,
              idempotencyKey: `${bridge.collectionIdempotencyKey}:journal`,
              kind: "source_collection",
              occurredAt: new Date(event.occurred_at),
              opaqueReference: sourceLeg.opaqueReference,
            })
            .onConflictDoNothing({
              target: treasuryJournalTransactions.idempotencyKey,
            })
            .returning({ id: treasuryJournalTransactions.id });
          if (insertedJournal.length > 0) {
            await transaction.insert(treasuryJournalEntries).values([
              {
                accountCode: "treasury_asset",
                amount: bridge.sourceAmount,
                id: randomUUID(),
                side: "debit",
                transactionId: journalId,
              },
              {
                accountCode: "source_collection_clearing",
                amount: bridge.sourceAmount,
                id: randomUUID(),
                side: "credit",
                transactionId: journalId,
              },
            ]);
          }
          await transaction
            .insert(destinationSettlementOutbox)
            .values({
              availableAt: now,
              createdAt: now,
              id: randomUUID(),
              processedAt: null,
              purgeAt: bridge.purgeAt,
              settlementObligationId: obligation.id,
              updatedAt: now,
            })
            .onConflictDoNothing({
              target: destinationSettlementOutbox.settlementObligationId,
            });
        }
      } else if (status === "source_pending" || status === "source_confirming") {
        if (bridge.status === "awaiting_source_payment") {
          assertTransition(bridge.status, "source_payment_confirming");
          nextStatus = "source_payment_confirming";
        }
      } else if (status === "failed") {
        if (
          bridge.status === "awaiting_source_payment" ||
          bridge.status === "source_payment_confirming"
        ) {
          assertTransition(bridge.status, "source_payment_failed");
          nextStatus = "source_payment_failed";
          failureCode = "SOURCE_PAYMENT_FAILED";
          deleteToken = bridge.destinationLookupToken;
          await transaction
            .update(bridgeSettlementLegs)
            .set({ failureCode, status: "failed", updatedAt: now })
            .where(eq(bridgeSettlementLegs.id, sourceLeg.id));
          await transaction
            .update(liquidityReservations)
            .set({ releasedAt: now, status: "released", updatedAt: now })
            .where(
              and(
                eq(liquidityReservations.bridgeSettlementId, bridge.id),
                eq(liquidityReservations.status, "active"),
              ),
            );
        }
      } else if (
        bridge.status === "awaiting_source_payment" ||
        bridge.status === "source_payment_confirming"
      ) {
        assertTransition(bridge.status, "manual_review");
        nextStatus = "manual_review";
        failureCode = "SOURCE_OUTCOME_UNKNOWN";
        await transaction
          .update(settlementObligations)
          .set({ failureCode, status: "manual_review", updatedAt: now })
          .where(eq(settlementObligations.bridgeSettlementId, bridge.id));
      }
      await transaction
        .update(bridgeSettlements)
        .set({ failureCode, status: nextStatus, updatedAt: now })
        .where(eq(bridgeSettlements.id, bridge.id));
      await transaction
        .update(paymentIntents)
        .set({ failureCode, status: nextStatus, updatedAt: now })
        .where(eq(paymentIntents.id, bridge.paymentIntentId));
      await transaction
        .update(providerEvents)
        .set({ processedAt: now })
        .where(and(eq(providerEvents.id, event.id), isNull(providerEvents.processedAt)));
      return { deleteToken, settlementId: bridge.id };
    });
    if (!result) {
      return null;
    }
    return {
      destinationTokenToDelete: result.deleteToken,
      settlement: await this.required(result.settlementId),
    };
  }

  async claimDestinationSettlement(
    now: Date,
    leaseMs: number,
  ): Promise<DestinationSettlementWork | null> {
    const claimed = await this.database.transaction(async (transaction) => {
      const locked = await transaction.execute<{
        bridge_settlement_id: string;
        obligation_id: string;
        outbox_id: string;
      }>(sql`
        select
          o.id as outbox_id,
          so.id as obligation_id,
          so.bridge_settlement_id
        from destination_settlement_outbox o
        join settlement_obligations so on so.id = o.settlement_obligation_id
        where o.processed_at is null
          and o.available_at <= ${now}
          and (o.lease_expires_at is null or o.lease_expires_at <= ${now})
          and so.status in ('queued', 'processing')
        order by o.available_at
        for update of o, so skip locked
        limit 1
      `);
      const item = locked.rows[0];
      if (!item) {
        return null;
      }
      const [bridge] = await transaction
        .select()
        .from(bridgeSettlements)
        .where(eq(bridgeSettlements.id, item.bridge_settlement_id))
        .for("update")
        .limit(1);
      if (!bridge) {
        throw new Error("Destination obligation has no bridge settlement.");
      }
      if (
        bridge.status !== "destination_settlement_queued" &&
        bridge.status !== "destination_settlement_processing"
      ) {
        throw new Error("Destination work is illegal in the current bridge state.");
      }
      if (bridge.status === "destination_settlement_queued") {
        assertTransition(bridge.status, "destination_settlement_processing");
      }
      const leaseToken = randomUUID();
      await transaction
        .update(destinationSettlementOutbox)
        .set({
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
          leaseToken,
          updatedAt: now,
        })
        .where(eq(destinationSettlementOutbox.id, item.outbox_id));
      await transaction
        .update(settlementObligations)
        .set({ status: "processing", updatedAt: now })
        .where(eq(settlementObligations.id, item.obligation_id));
      await transaction
        .update(bridgeSettlements)
        .set({ status: "destination_settlement_processing", updatedAt: now })
        .where(eq(bridgeSettlements.id, bridge.id));
      await transaction
        .update(paymentIntents)
        .set({ status: "destination_settlement_processing", updatedAt: now })
        .where(eq(paymentIntents.id, bridge.paymentIntentId));
      const [existingAttempt] = await transaction
        .select()
        .from(settlementAttempts)
        .where(eq(settlementAttempts.idempotencyKey, bridge.settlementIdempotencyKey))
        .limit(1);
      let attemptRow = existingAttempt;
      if (existingAttempt) {
        const [updated] = await transaction
          .update(settlementAttempts)
          .set({
            completedAt: null,
            failureCode: null,
            outcome: "processing",
            startedAt: now,
          })
          .where(eq(settlementAttempts.id, existingAttempt.id))
          .returning();
        attemptRow = updated;
      } else {
        const [inserted] = await transaction
          .insert(settlementAttempts)
          .values({
            attemptNumber: 1,
            completedAt: null,
            failureCode: null,
            id: randomUUID(),
            idempotencyKey: bridge.settlementIdempotencyKey,
            opaqueReference: null,
            outcome: "processing",
            purgeAt: bridge.purgeAt,
            settlementObligationId: item.obligation_id,
            startedAt: now,
          })
          .returning();
        attemptRow = inserted;
      }
      if (!attemptRow) {
        throw new Error("Destination settlement attempt was not persisted.");
      }
      return {
        attempt: mapAttempt(attemptRow),
        bridgeId: bridge.id,
        leaseToken,
      };
    });
    if (!claimed) {
      return null;
    }
    const settlement = await this.required(claimed.bridgeId);
    return {
      attempt: claimed.attempt,
      destinationLookupToken: settlement.destinationLookupToken,
      leaseToken: claimed.leaseToken,
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
    await this.database.transaction(async (transaction) => {
      const [bridge] = await transaction
        .select()
        .from(bridgeSettlements)
        .where(eq(bridgeSettlements.id, work.settlement.id))
        .for("update")
        .limit(1);
      if (!bridge) {
        throw new Error("Bridge settlement was not found.");
      }
      if (bridge.status === "settled" && result.outcome === "success") {
        return;
      }
      if (bridge.status !== "destination_settlement_processing") {
        throw new Error("Destination finalization is illegal in the current bridge state.");
      }
      const [obligation] = await transaction
        .select()
        .from(settlementObligations)
        .where(eq(settlementObligations.bridgeSettlementId, bridge.id))
        .for("update")
        .limit(1);
      const [outbox] = obligation
        ? await transaction
            .select()
            .from(destinationSettlementOutbox)
            .where(eq(destinationSettlementOutbox.settlementObligationId, obligation.id))
            .for("update")
            .limit(1)
        : [];
      if (!obligation || !outbox || outbox.leaseToken !== work.leaseToken) {
        throw new Error("Destination outbox lease is unavailable.");
      }
      if (result.outcome === "success") {
        assertTransition(bridge.status, "settled");
        const journalId = randomUUID();
        const insertedJournal = await transaction
          .insert(treasuryJournalTransactions)
          .values({
            asset: bridge.destinationAsset,
            exchangeGroupId: bridge.exchangeGroupId,
            id: journalId,
            idempotencyKey: `${bridge.settlementIdempotencyKey}:journal`,
            kind: "destination_settlement",
            occurredAt: now,
            opaqueReference: result.opaqueReference,
          })
          .onConflictDoNothing({
            target: treasuryJournalTransactions.idempotencyKey,
          })
          .returning({ id: treasuryJournalTransactions.id });
        if (insertedJournal.length > 0) {
          await transaction.insert(treasuryJournalEntries).values([
            {
              accountCode: "destination_settlement_clearing",
              amount: bridge.destinationAmount,
              id: randomUUID(),
              side: "debit",
              transactionId: journalId,
            },
            {
              accountCode: "treasury_asset",
              amount: bridge.destinationAmount,
              id: randomUUID(),
              side: "credit",
              transactionId: journalId,
            },
          ]);
        }
        const reviewRequired = result.reconciliation.outcome !== "matched";
        await transaction.insert(reconciliationResults).values({
          bridgeSettlementId: bridge.id,
          checkedAt: result.reconciliation.checkedAt,
          id: randomUUID(),
          outcome: result.reconciliation.outcome,
          purgeAt: bridge.purgeAt,
          reviewRequired,
          safeCode: result.reconciliation.safeCode,
        });
        await transaction
          .update(bridgeSettlementLegs)
          .set({
            opaqueReference: result.opaqueReference,
            status: "settled",
            updatedAt: now,
          })
          .where(
            and(
              eq(bridgeSettlementLegs.bridgeSettlementId, bridge.id),
              eq(bridgeSettlementLegs.kind, "destination"),
            ),
          );
        await transaction
          .update(liquidityReservations)
          .set({ status: "committed", updatedAt: now })
          .where(
            and(
              eq(liquidityReservations.bridgeSettlementId, bridge.id),
              eq(liquidityReservations.status, "active"),
            ),
          );
        await transaction
          .update(settlementObligations)
          .set({ status: "settled", updatedAt: now })
          .where(eq(settlementObligations.id, obligation.id));
        await transaction
          .update(settlementAttempts)
          .set({
            completedAt: now,
            opaqueReference: result.opaqueReference,
            outcome: "succeeded",
          })
          .where(eq(settlementAttempts.id, work.attempt.id));
        await transaction
          .update(bridgeSettlements)
          .set({
            reconciliationReviewRequired: reviewRequired,
            status: "settled",
            updatedAt: now,
          })
          .where(eq(bridgeSettlements.id, bridge.id));
        await transaction
          .update(paymentIntents)
          .set({ status: "settled", updatedAt: now })
          .where(eq(paymentIntents.id, bridge.paymentIntentId));
      } else {
        const uncertain = result.outcome === "timeout" || result.outcome === "unknown";
        const nextStatus = uncertain ? "manual_review" : "destination_settlement_failed";
        assertTransition(bridge.status, nextStatus);
        await transaction
          .update(settlementAttempts)
          .set({
            completedAt: now,
            failureCode: result.safeCode,
            outcome: result.outcome === "failure" ? "failed" : result.outcome,
          })
          .where(eq(settlementAttempts.id, work.attempt.id));
        await transaction
          .update(settlementObligations)
          .set({
            failureCode: result.safeCode,
            status: uncertain ? "manual_review" : "failed",
            updatedAt: now,
          })
          .where(eq(settlementObligations.id, obligation.id));
        if (!uncertain) {
          await transaction
            .update(liquidityReservations)
            .set({ releasedAt: now, status: "released", updatedAt: now })
            .where(
              and(
                eq(liquidityReservations.bridgeSettlementId, bridge.id),
                eq(liquidityReservations.status, "active"),
              ),
            );
        }
        await transaction
          .update(bridgeSettlements)
          .set({ failureCode: result.safeCode, status: nextStatus, updatedAt: now })
          .where(eq(bridgeSettlements.id, bridge.id));
        await transaction
          .update(paymentIntents)
          .set({ failureCode: result.safeCode, status: nextStatus, updatedAt: now })
          .where(eq(paymentIntents.id, bridge.paymentIntentId));
      }
      await transaction
        .update(destinationSettlementOutbox)
        .set({
          leaseExpiresAt: null,
          leaseToken: null,
          processedAt: now,
          updatedAt: now,
        })
        .where(eq(destinationSettlementOutbox.id, outbox.id));
    });
    return this.required(work.settlement.id);
  }

  async recordDestinationUnavailable(
    work: DestinationSettlementWork,
    now: Date,
  ): Promise<BridgeSettlement> {
    await this.database.transaction(async (transaction) => {
      const [bridge] = await transaction
        .select()
        .from(bridgeSettlements)
        .where(eq(bridgeSettlements.id, work.settlement.id))
        .for("update")
        .limit(1);
      if (bridge?.status !== "destination_settlement_processing") {
        throw new Error("Destination loss is illegal in the current bridge state.");
      }
      assertTransition(bridge.status, "refund_required");
      const [obligation] = await transaction
        .select()
        .from(settlementObligations)
        .where(eq(settlementObligations.bridgeSettlementId, bridge.id))
        .for("update")
        .limit(1);
      const [outbox] = obligation
        ? await transaction
            .select()
            .from(destinationSettlementOutbox)
            .where(eq(destinationSettlementOutbox.settlementObligationId, obligation.id))
            .for("update")
            .limit(1)
        : [];
      if (!obligation || !outbox || outbox.leaseToken !== work.leaseToken) {
        throw new Error("Destination outbox lease is unavailable.");
      }
      await transaction
        .update(liquidityReservations)
        .set({ releasedAt: now, status: "released", updatedAt: now })
        .where(
          and(
            eq(liquidityReservations.bridgeSettlementId, bridge.id),
            eq(liquidityReservations.status, "active"),
          ),
        );
      await transaction
        .insert(refundObligations)
        .values({
          amount: bridge.sourceAmount,
          asset: bridge.sourceAsset,
          bridgeSettlementId: bridge.id,
          createdAt: now,
          failureCode: "DESTINATION_UNAVAILABLE",
          id: randomUUID(),
          idempotencyKey: `refund:${bridge.collectionIdempotencyKey}`,
          purgeAt: bridge.purgeAt,
          status: "required",
          updatedAt: now,
        })
        .onConflictDoNothing({ target: refundObligations.bridgeSettlementId });
      await transaction
        .update(settlementObligations)
        .set({
          failureCode: "DESTINATION_UNAVAILABLE",
          status: "manual_review",
          updatedAt: now,
        })
        .where(eq(settlementObligations.id, obligation.id));
      await transaction
        .update(settlementAttempts)
        .set({
          completedAt: now,
          failureCode: "DESTINATION_UNAVAILABLE",
          outcome: "failed",
        })
        .where(eq(settlementAttempts.id, work.attempt.id));
      await transaction
        .update(bridgeSettlements)
        .set({
          failureCode: "DESTINATION_UNAVAILABLE",
          status: "refund_required",
          updatedAt: now,
        })
        .where(eq(bridgeSettlements.id, bridge.id));
      await transaction
        .update(paymentIntents)
        .set({
          failureCode: "DESTINATION_UNAVAILABLE",
          status: "refund_required",
          updatedAt: now,
        })
        .where(eq(paymentIntents.id, bridge.paymentIntentId));
      await transaction
        .update(destinationSettlementOutbox)
        .set({
          leaseExpiresAt: null,
          leaseToken: null,
          processedAt: now,
          updatedAt: now,
        })
        .where(eq(destinationSettlementOutbox.id, outbox.id));
    });
    return this.required(work.settlement.id);
  }

  async requeueConclusiveDestinationFailure(
    settlementId: string,
    now: Date,
  ): Promise<BridgeSettlement> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`ntumba:retry:${settlementId}`}))`,
      );
      const [bridge] = await transaction
        .select()
        .from(bridgeSettlements)
        .where(eq(bridgeSettlements.id, settlementId))
        .for("update")
        .limit(1);
      if (bridge?.status !== "destination_settlement_failed") {
        throw new Error("Only a conclusively failed destination settlement can be retried.");
      }
      assertTransition(bridge.status, "destination_settlement_queued");
      const available =
        bridge.destinationAsset === "BTC"
          ? this.config.FAKE_BITCOIN_TREASURY_BALANCE_SATS
          : this.config.FAKE_LIPILA_BALANCE_ZMW_MINOR;
      const [reserved] = await transaction
        .select({ value: sum(liquidityReservations.amount) })
        .from(liquidityReservations)
        .where(
          and(
            eq(liquidityReservations.asset, bridge.destinationAsset),
            eq(liquidityReservations.status, "active"),
          ),
        );
      if (available - BigInt(reserved?.value ?? "0") < bridge.destinationAmount) {
        return;
      }
      await transaction
        .update(liquidityReservations)
        .set({ releasedAt: null, status: "active", updatedAt: now })
        .where(eq(liquidityReservations.bridgeSettlementId, bridge.id));
      const [obligation] = await transaction
        .update(settlementObligations)
        .set({ failureCode: null, status: "queued", updatedAt: now })
        .where(eq(settlementObligations.bridgeSettlementId, bridge.id))
        .returning();
      if (!obligation) {
        throw new Error("Destination retry has no obligation.");
      }
      await transaction
        .update(destinationSettlementOutbox)
        .set({
          availableAt: now,
          leaseExpiresAt: null,
          leaseToken: null,
          processedAt: null,
          updatedAt: now,
        })
        .where(eq(destinationSettlementOutbox.settlementObligationId, obligation.id));
      await transaction
        .update(bridgeSettlements)
        .set({
          failureCode: null,
          status: "destination_settlement_queued",
          updatedAt: now,
        })
        .where(eq(bridgeSettlements.id, bridge.id));
      await transaction
        .update(paymentIntents)
        .set({
          failureCode: null,
          status: "destination_settlement_queued",
          updatedAt: now,
        })
        .where(eq(paymentIntents.id, bridge.paymentIntentId));
    });
    return this.required(settlementId);
  }

  async findByCollectionKey(key: string) {
    return this.findOne(eq(bridgeSettlements.collectionIdempotencyKey, key));
  }

  async findByPaymentIntentId(id: string) {
    return this.findOne(eq(bridgeSettlements.paymentIntentId, id));
  }

  async findBySettlementKey(key: string) {
    return this.findOne(eq(bridgeSettlements.settlementIdempotencyKey, key));
  }

  async findBySourceReference(reference: string) {
    const [leg] = await this.database
      .select({ bridgeSettlementId: bridgeSettlementLegs.bridgeSettlementId })
      .from(bridgeSettlementLegs)
      .where(
        and(
          eq(bridgeSettlementLegs.kind, "source"),
          eq(bridgeSettlementLegs.opaqueReference, reference),
        ),
      )
      .limit(1);
    return leg ? this.read(leg.bridgeSettlementId) : undefined;
  }

  async read(id: string) {
    const [row] = await this.database
      .select()
      .from(bridgeSettlements)
      .where(eq(bridgeSettlements.id, id))
      .limit(1);
    if (!row) {
      return undefined;
    }
    const [legs, reservations, attemptCounts] = await Promise.all([
      this.database
        .select()
        .from(bridgeSettlementLegs)
        .where(eq(bridgeSettlementLegs.bridgeSettlementId, id)),
      this.database
        .select()
        .from(liquidityReservations)
        .where(eq(liquidityReservations.bridgeSettlementId, id))
        .limit(1),
      this.database
        .select({ value: count() })
        .from(settlementAttempts)
        .innerJoin(
          settlementObligations,
          eq(settlementAttempts.settlementObligationId, settlementObligations.id),
        )
        .where(eq(settlementObligations.bridgeSettlementId, id)),
    ]);
    return mapSettlement(
      row,
      legs.find((item) => item.kind === "source")?.opaqueReference ?? null,
      legs.find((item) => item.kind === "destination")?.opaqueReference ?? null,
      reservations[0]?.id ?? null,
      attemptCounts[0]?.value ?? 0,
    );
  }

  async readReservation(id: string) {
    const [row] = await this.database
      .select()
      .from(liquidityReservations)
      .where(eq(liquidityReservations.bridgeSettlementId, id))
      .limit(1);
    return row
      ? {
          amount: row.amount,
          asset: row.asset,
          bridgeSettlementId: row.bridgeSettlementId,
          expiresAt: row.expiresAt,
          id: row.id,
          status: row.status,
        }
      : undefined;
  }

  async readObligation(id: string) {
    const [row] = await this.database
      .select()
      .from(settlementObligations)
      .where(eq(settlementObligations.bridgeSettlementId, id))
      .limit(1);
    return row
      ? {
          amount: row.amount,
          asset: row.asset,
          bridgeSettlementId: row.bridgeSettlementId,
          failureCode: row.failureCode,
          id: row.id,
          status: row.status,
        }
      : undefined;
  }

  async readAttempt(key: string) {
    const [row] = await this.database
      .select()
      .from(settlementAttempts)
      .where(eq(settlementAttempts.idempotencyKey, key))
      .limit(1);
    return row ? mapAttempt(row) : undefined;
  }

  async readJournal(): Promise<readonly TreasuryJournalTransaction[]> {
    const transactions = await this.database
      .select()
      .from(treasuryJournalTransactions)
      .orderBy(asc(treasuryJournalTransactions.createdAt));
    return Promise.all(
      transactions.map(async (transaction) => {
        const entries = await this.database
          .select()
          .from(treasuryJournalEntries)
          .where(eq(treasuryJournalEntries.transactionId, transaction.id));
        return {
          asset: transaction.asset,
          entries: entries.map((entry) => ({
            account: entry.accountCode,
            amount: entry.amount,
            side: entry.side,
          })),
          exchangeGroupId: transaction.exchangeGroupId,
          id: transaction.id,
          idempotencyKey: transaction.idempotencyKey,
          kind: transaction.kind,
          occurredAt: transaction.occurredAt,
          opaqueReference: transaction.opaqueReference,
        };
      }),
    );
  }

  async readReconciliation(id: string) {
    const rows = await this.database
      .select()
      .from(reconciliationResults)
      .where(eq(reconciliationResults.bridgeSettlementId, id));
    return rows.map((row) => ({
      checkedAt: row.checkedAt,
      outcome: row.outcome,
      safeCode: row.safeCode,
    }));
  }

  async refundObligationCount(id: string) {
    const [row] = await this.database
      .select({ value: count() })
      .from(refundObligations)
      .where(eq(refundObligations.bridgeSettlementId, id));
    return row?.value ?? 0;
  }

  async pendingDestinationWork() {
    const [row] = await this.database
      .select({ value: count() })
      .from(destinationSettlementOutbox)
      .where(isNull(destinationSettlementOutbox.processedAt));
    return row?.value ?? 0;
  }

  async readStatus(): Promise<SettlementRepositoryStatus> {
    const [rows, reservations, reconciled] = await Promise.all([
      this.database.select().from(bridgeSettlements),
      this.database
        .select()
        .from(liquidityReservations)
        .where(eq(liquidityReservations.status, "active")),
      this.database
        .select({ checkedAt: reconciliationResults.checkedAt })
        .from(reconciliationResults)
        .where(eq(reconciliationResults.outcome, "matched"))
        .orderBy(desc(reconciliationResults.checkedAt))
        .limit(1),
    ]);
    const liability = (asset: TreasuryAsset) =>
      rows
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
      lastSuccessfulReconciliationAt: reconciled[0]?.checkedAt ?? null,
      manualReview: rows.filter((item) => item.status === "manual_review").length,
      reconciliationReviewRequired: rows.filter((item) => item.reconciliationReviewRequired).length,
      refundRequired: rows.filter((item) => item.status === "refund_required").length,
      reservedBtcSats: reservations
        .filter((item) => item.asset === "BTC")
        .reduce((total, item) => total + item.amount, 0n),
      reservedZmwMinor: reservations
        .filter((item) => item.asset === "ZMW")
        .reduce((total, item) => total + item.amount, 0n),
      unsettledBtcLiabilitySats: liability("BTC"),
      unsettledZmwLiabilityMinor: liability("ZMW"),
      waitingDestinationSettlement: rows.filter((item) =>
        [
          "source_payment_settled",
          "destination_settlement_queued",
          "destination_settlement_processing",
          "destination_settlement_failed",
        ].includes(item.status),
      ).length,
      waitingSourcePayment: rows.filter((item) =>
        ["awaiting_source_payment", "source_payment_confirming"].includes(item.status),
      ).length,
    };
  }

  private async findOne(condition: ReturnType<typeof eq>) {
    const [row] = await this.database
      .select({ id: bridgeSettlements.id })
      .from(bridgeSettlements)
      .where(condition)
      .limit(1);
    return row ? this.read(row.id) : undefined;
  }

  private async required(id: string): Promise<BridgeSettlement> {
    const settlement = await this.read(id);
    if (!settlement) {
      throw new Error("Bridge settlement was not found.");
    }
    return settlement;
  }
}
