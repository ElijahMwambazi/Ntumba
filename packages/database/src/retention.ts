import { sql } from "drizzle-orm";
import type { NtumbaDatabase } from "./client.js";

export interface PurgeResult {
  paymentIntents: number;
  providerEvents: number;
  quotes: number;
}

export async function purgeExpiredOperationalData(
  database: NtumbaDatabase,
  now: Date,
): Promise<PurgeResult> {
  return database.transaction(async (transaction) => {
    const providerEvents = await transaction.execute(sql`
      DELETE FROM provider_events
      WHERE purge_at <= ${now}
      RETURNING id
    `);
    const paymentIntents = await transaction.execute(sql`
      DELETE FROM payment_intents AS intent
      WHERE intent.purge_at <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM provider_events AS event WHERE event.payment_intent_id = intent.id
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
      paymentIntents: paymentIntents.rowCount ?? 0,
      providerEvents: providerEvents.rowCount ?? 0,
      quotes: quotes.rowCount ?? 0,
    };
  });
}
