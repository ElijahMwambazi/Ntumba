import { sql } from "drizzle-orm";
import type { NtumbaDatabase } from "./client.js";

export interface PurgeResult {
  bridgeSettlementLegs: number;
  bridgeSettlements: number;
  destinationSettlementOutbox: number;
  liquidityReservations: number;
  paymentIntents: number;
  providerIntentOutbox: number;
  providerEvents: number;
  publicPaymentRequests: number;
  quotes: number;
  reconciliationResults: number;
  refundObligations: number;
  settlementAttempts: number;
  settlementAttemptEvents: number;
  settlementObligations: number;
}

export async function purgeExpiredOperationalData(
  database: NtumbaDatabase,
  now: Date,
  providerFinalityGraceSeconds = 86_400,
): Promise<PurgeResult> {
  return database.transaction(async (transaction) => {
    const publicPaymentRequests = await transaction.execute(sql`
      DELETE FROM public_payment_requests
      WHERE purge_at <= ${now}
      RETURNING id
    `);
    await transaction.execute(sql`
      CREATE TEMPORARY TABLE ntumba_purge_bridge_ids
      ON COMMIT DROP
      AS
      SELECT settlement.id
      FROM bridge_settlements AS settlement
      WHERE settlement.purge_at <= ${now}
        AND settlement.source_payment_expires_at
          + make_interval(secs => ${providerFinalityGraceSeconds}) <= ${now}
        AND settlement.status IN ('settled', 'expired', 'source_payment_failed', 'refunded')
        AND settlement.reconciliation_review_required = false
        AND NOT EXISTS (
          SELECT 1 FROM liquidity_reservations AS reservation
          WHERE reservation.bridge_settlement_id = settlement.id
            AND reservation.status = 'active'
        )
        AND NOT EXISTS (
          SELECT 1 FROM settlement_obligations AS obligation
          WHERE obligation.bridge_settlement_id = settlement.id
            AND obligation.status NOT IN ('settled', 'failed')
        )
        AND NOT EXISTS (
          SELECT 1 FROM refund_obligations AS refund
          WHERE refund.bridge_settlement_id = settlement.id
            AND refund.status <> 'refunded'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM provider_events AS event
          WHERE event.payment_intent_id = settlement.payment_intent_id
            AND (event.processed_at IS NULL OR event.dead_lettered_at IS NOT NULL)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM provider_intent_outbox AS source_outbox
          WHERE source_outbox.payment_intent_id = settlement.payment_intent_id
            AND source_outbox.processed_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM destination_settlement_outbox AS outbox
          JOIN settlement_obligations AS obligation
            ON obligation.id = outbox.settlement_obligation_id
          WHERE obligation.bridge_settlement_id = settlement.id
            AND (
              outbox.processed_at IS NULL
              OR outbox.lease_token IS NOT NULL
              OR outbox.lease_expires_at IS NOT NULL
            )
        )
    `);
    await transaction.execute(sql`SET LOCAL ntumba.allow_attempt_event_purge = 'on'`);
    const settlementAttemptEvents = await transaction.execute(sql`
      DELETE FROM settlement_attempt_events AS event
      USING settlement_attempts AS attempt, settlement_obligations AS obligation
      WHERE event.settlement_attempt_id = attempt.id
        AND attempt.settlement_obligation_id = obligation.id
        AND obligation.bridge_settlement_id IN (SELECT id FROM ntumba_purge_bridge_ids)
      RETURNING event.id
    `);
    const settlementAttempts = await transaction.execute(sql`
      DELETE FROM settlement_attempts AS attempt
      USING settlement_obligations AS obligation
      WHERE attempt.settlement_obligation_id = obligation.id
        AND obligation.bridge_settlement_id IN (SELECT id FROM ntumba_purge_bridge_ids)
      RETURNING attempt.id
    `);
    const destinationSettlementOutbox = await transaction.execute(sql`
      DELETE FROM destination_settlement_outbox AS outbox
      USING settlement_obligations AS obligation
      WHERE outbox.settlement_obligation_id = obligation.id
        AND obligation.bridge_settlement_id IN (SELECT id FROM ntumba_purge_bridge_ids)
      RETURNING outbox.id
    `);
    const reconciliationResults = await transaction.execute(sql`
      DELETE FROM reconciliation_results
      WHERE bridge_settlement_id IN (SELECT id FROM ntumba_purge_bridge_ids)
      RETURNING id
    `);
    const refundObligations = await transaction.execute(sql`
      DELETE FROM refund_obligations
      WHERE bridge_settlement_id IN (SELECT id FROM ntumba_purge_bridge_ids)
      RETURNING id
    `);
    const settlementObligations = await transaction.execute(sql`
      DELETE FROM settlement_obligations
      WHERE bridge_settlement_id IN (SELECT id FROM ntumba_purge_bridge_ids)
      RETURNING id
    `);
    const liquidityReservations = await transaction.execute(sql`
      DELETE FROM liquidity_reservations
      WHERE bridge_settlement_id IN (SELECT id FROM ntumba_purge_bridge_ids)
      RETURNING id
    `);
    const bridgeSettlementLegs = await transaction.execute(sql`
      DELETE FROM bridge_settlement_legs
      WHERE bridge_settlement_id IN (SELECT id FROM ntumba_purge_bridge_ids)
      RETURNING id
    `);
    const providerIntentOutbox = await transaction.execute(sql`
      DELETE FROM provider_intent_outbox AS outbox
      WHERE outbox.purge_at <= ${now}
        AND outbox.processed_at IS NOT NULL
        AND (
          NOT EXISTS (
            SELECT 1 FROM bridge_settlements AS settlement
            WHERE settlement.payment_intent_id = outbox.payment_intent_id
          )
          OR outbox.payment_intent_id IN (
            SELECT settlement.payment_intent_id
            FROM bridge_settlements AS settlement
            WHERE settlement.id IN (SELECT id FROM ntumba_purge_bridge_ids)
          )
        )
      RETURNING outbox.id
    `);
    const providerEvents = await transaction.execute(sql`
      DELETE FROM provider_events AS event
      WHERE event.purge_at <= ${now}
        AND event.processed_at IS NOT NULL
        AND event.dead_lettered_at IS NULL
        AND (
          NOT EXISTS (
            SELECT 1 FROM bridge_settlements AS settlement
            WHERE settlement.payment_intent_id = event.payment_intent_id
          )
          OR event.payment_intent_id IN (
            SELECT settlement.payment_intent_id
            FROM bridge_settlements AS settlement
            WHERE settlement.id IN (SELECT id FROM ntumba_purge_bridge_ids)
          )
        )
      RETURNING event.id
    `);
    const bridgeSettlements = await transaction.execute(sql`
      DELETE FROM bridge_settlements AS settlement
      WHERE settlement.id IN (SELECT id FROM ntumba_purge_bridge_ids)
      RETURNING id
    `);
    const paymentIntents = await transaction.execute(sql`
      DELETE FROM payment_intents AS intent
      WHERE intent.purge_at <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM bridge_settlements AS settlement
          WHERE settlement.payment_intent_id = intent.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM provider_events AS event WHERE event.payment_intent_id = intent.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM provider_intent_outbox AS outbox
          WHERE outbox.payment_intent_id = intent.id
        )
      RETURNING id
    `);
    const quotes = await transaction.execute(sql`
      DELETE FROM quotes AS quote
      WHERE quote.purge_at <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM payment_intents AS intent WHERE intent.quote_id = quote.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public_payment_request_quote_bindings AS request_quote
          WHERE request_quote.quote_id = quote.id
        )
      RETURNING id
    `);

    return {
      bridgeSettlementLegs: bridgeSettlementLegs.rowCount ?? 0,
      bridgeSettlements: bridgeSettlements.rowCount ?? 0,
      destinationSettlementOutbox: destinationSettlementOutbox.rowCount ?? 0,
      liquidityReservations: liquidityReservations.rowCount ?? 0,
      paymentIntents: paymentIntents.rowCount ?? 0,
      providerIntentOutbox: providerIntentOutbox.rowCount ?? 0,
      providerEvents: providerEvents.rowCount ?? 0,
      publicPaymentRequests: publicPaymentRequests.rowCount ?? 0,
      quotes: quotes.rowCount ?? 0,
      reconciliationResults: reconciliationResults.rowCount ?? 0,
      refundObligations: refundObligations.rowCount ?? 0,
      settlementAttempts: settlementAttempts.rowCount ?? 0,
      settlementAttemptEvents: settlementAttemptEvents.rowCount ?? 0,
      settlementObligations: settlementObligations.rowCount ?? 0,
    };
  });
}
