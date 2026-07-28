import { sql } from "drizzle-orm";
import type { NtumbaDatabase } from "./client.js";

export interface PurgeResult {
  bridgeSettlementLegs: number;
  bridgeSettlements: number;
  liquidityReservations: number;
  paymentIntents: number;
  providerIntentOutbox: number;
  providerEvents: number;
  quotes: number;
  reconciliationResults: number;
  refundObligations: number;
  settlementAttempts: number;
  settlementObligations: number;
}

export async function purgeExpiredOperationalData(
  database: NtumbaDatabase,
  now: Date,
): Promise<PurgeResult> {
  return database.transaction(async (transaction) => {
    const settlementAttempts = await transaction.execute(sql`
      DELETE FROM settlement_attempts WHERE purge_at <= ${now} RETURNING id
    `);
    const reconciliationResults = await transaction.execute(sql`
      DELETE FROM reconciliation_results WHERE purge_at <= ${now} RETURNING id
    `);
    const refundObligations = await transaction.execute(sql`
      DELETE FROM refund_obligations WHERE purge_at <= ${now} RETURNING id
    `);
    const settlementObligations = await transaction.execute(sql`
      DELETE FROM settlement_obligations
      WHERE purge_at <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM settlement_attempts AS attempt
          WHERE attempt.settlement_obligation_id = settlement_obligations.id
        )
      RETURNING id
    `);
    const liquidityReservations = await transaction.execute(sql`
      DELETE FROM liquidity_reservations WHERE purge_at <= ${now} RETURNING id
    `);
    const bridgeSettlementLegs = await transaction.execute(sql`
      DELETE FROM bridge_settlement_legs WHERE purge_at <= ${now} RETURNING id
    `);
    const bridgeSettlements = await transaction.execute(sql`
      DELETE FROM bridge_settlements AS settlement
      WHERE settlement.purge_at <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM bridge_settlement_legs AS leg
          WHERE leg.bridge_settlement_id = settlement.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM liquidity_reservations AS reservation
          WHERE reservation.bridge_settlement_id = settlement.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM settlement_obligations AS obligation
          WHERE obligation.bridge_settlement_id = settlement.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM reconciliation_results AS result
          WHERE result.bridge_settlement_id = settlement.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM refund_obligations AS refund
          WHERE refund.bridge_settlement_id = settlement.id
        )
      RETURNING id
    `);
    const providerIntentOutbox = await transaction.execute(sql`
      DELETE FROM provider_intent_outbox
      WHERE purge_at <= ${now}
      RETURNING id
    `);
    const providerEvents = await transaction.execute(sql`
      DELETE FROM provider_events
      WHERE purge_at <= ${now}
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
      RETURNING id
    `);

    return {
      bridgeSettlementLegs: bridgeSettlementLegs.rowCount ?? 0,
      bridgeSettlements: bridgeSettlements.rowCount ?? 0,
      liquidityReservations: liquidityReservations.rowCount ?? 0,
      paymentIntents: paymentIntents.rowCount ?? 0,
      providerIntentOutbox: providerIntentOutbox.rowCount ?? 0,
      providerEvents: providerEvents.rowCount ?? 0,
      quotes: quotes.rowCount ?? 0,
      reconciliationResults: reconciliationResults.rowCount ?? 0,
      refundObligations: refundObligations.rowCount ?? 0,
      settlementAttempts: settlementAttempts.rowCount ?? 0,
      settlementObligations: settlementObligations.rowCount ?? 0,
    };
  });
}
