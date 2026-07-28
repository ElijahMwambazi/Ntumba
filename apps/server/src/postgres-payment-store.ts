import type { NtumbaConfig } from "@ntumba/config";
import type { CreateQuoteResponse } from "@ntumba/contracts";
import {
  type NtumbaDatabase,
  paymentIntents,
  providerEvents,
  providerIntentOutbox,
  purgeExpiredOperationalData,
  quotes,
} from "@ntumba/database";
import { formatZmwFromMinor } from "@ntumba/domain";
import { type OperationalSnapshot, safeOutboxFailureCategory } from "@ntumba/observability";
import { and, asc, between, count, desc, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type {
  AppendProviderEventResult,
  PaymentStore,
  ProviderIntentCompletion,
  StoredPaymentIntent,
  StoredProviderEvent,
  StoredProviderIntentOutbox,
  StoredQuote,
} from "./payment-store.js";

export class PostgresPaymentStore implements PaymentStore {
  constructor(
    readonly database: NtumbaDatabase,
    readonly config: NtumbaConfig,
  ) {}

  async saveQuote(quote: StoredQuote): Promise<void> {
    await this.database.insert(quotes).values({
      amountZmwMinor: quote.amountZmwMinor,
      direction: quote.response.direction,
      expiresAt: new Date(quote.response.expiresAt),
      feeZmwMinor: quote.feeZmwMinor,
      id: quote.response.quoteId,
      merchantAmountSats: quote.merchantAmountSats,
      payerAmountSats: quote.payerAmountSats,
      payerAmountZmwMinor: quote.payerAmountZmwMinor,
      purgeAt: quote.purgeAt,
      rateZmwMinorPerBitcoin: quote.rateZmwMinorPerBitcoin,
    });
  }

  async getQuote(id: string): Promise<StoredQuote | undefined> {
    const row = await this.database.query.quotes.findFirst({
      where: eq(quotes.id, id),
    });
    if (!row) {
      return undefined;
    }

    const amountZmw = formatZmwFromMinor(row.amountZmwMinor);
    const feeZmw = formatZmwFromMinor(row.feeZmwMinor);
    const exchangeRate = `1 BTC = K${formatZmwFromMinor(row.rateZmwMinorPerBitcoin)}`;
    let response: CreateQuoteResponse;

    if (row.direction === "btc_to_zmw") {
      if (row.payerAmountSats === null) {
        throw new Error("Stored quote has incomplete source amounts.");
      }
      response = {
        amountZmw,
        direction: row.direction,
        exchangeRate,
        expiresAt: row.expiresAt.toISOString(),
        feeZmw,
        merchantReceives: { amount: amountZmw, asset: "ZMW", display: `K${amountZmw}` },
        payerSends: {
          amount: row.payerAmountSats.toString(),
          asset: "BTC",
          display: `${row.payerAmountSats.toLocaleString()} sats`,
        },
        quoteId: row.id,
      };
    } else if (row.direction === "btc_to_btc") {
      if (row.payerAmountSats === null || row.merchantAmountSats === null) {
        throw new Error("Stored direct quote has incomplete satoshi amounts.");
      }
      response = {
        amountZmw,
        direction: row.direction,
        exchangeRate,
        expiresAt: row.expiresAt.toISOString(),
        feeZmw,
        merchantReceives: {
          amount: row.merchantAmountSats.toString(),
          asset: "BTC",
          display: `${row.merchantAmountSats.toLocaleString()} sats`,
        },
        payerSends: {
          amount: row.payerAmountSats.toString(),
          asset: "BTC",
          display: `${row.payerAmountSats.toLocaleString()} sats`,
        },
        quoteId: row.id,
      };
    } else {
      if (row.payerAmountZmwMinor === null || row.merchantAmountSats === null) {
        throw new Error("Stored quote has incomplete settlement amounts.");
      }
      const payerZmw = formatZmwFromMinor(row.payerAmountZmwMinor);
      response = {
        amountZmw,
        direction: row.direction,
        exchangeRate,
        expiresAt: row.expiresAt.toISOString(),
        feeZmw,
        merchantReceives: {
          amount: row.merchantAmountSats.toString(),
          asset: "BTC",
          display: `${row.merchantAmountSats.toLocaleString()} sats`,
        },
        payerSends: { amount: payerZmw, asset: "ZMW", display: `K${payerZmw}` },
        quoteId: row.id,
      };
    }

    return {
      amountZmwMinor: row.amountZmwMinor,
      feeZmwMinor: row.feeZmwMinor,
      merchantAmountSats: row.merchantAmountSats,
      merchantAmountZmwMinor: row.direction === "btc_to_zmw" ? row.amountZmwMinor : null,
      payerAmountSats: row.payerAmountSats,
      payerAmountZmwMinor: row.payerAmountZmwMinor,
      purgeAt: row.purgeAt,
      rateZmwMinorPerBitcoin: row.rateZmwMinorPerBitcoin,
      response,
    };
  }

  async saveIntent(intent: StoredPaymentIntent): Promise<StoredPaymentIntent> {
    const quote = await this.getQuote(intent.quoteId);
    if (!quote) {
      throw new Error("Cannot save an intent without its quote.");
    }

    await this.database
      .insert(paymentIntents)
      .values(this.intentValues(intent, quote))
      .onConflictDoNothing({ target: paymentIntents.idempotencyKey });

    const saved = await this.findIntentByIdempotencyKey(intent.idempotencyKey);
    if (!saved) {
      throw new Error("Payment intent was not persisted.");
    }
    return saved;
  }

  async stageProviderIntent(
    intent: StoredPaymentIntent,
    outbox: StoredProviderIntentOutbox,
  ): Promise<StoredPaymentIntent> {
    const quote = await this.getQuote(intent.quoteId);
    if (!quote) {
      throw new Error("Cannot stage an intent without its quote.");
    }

    return this.database.transaction(async (transaction) => {
      await transaction
        .insert(paymentIntents)
        .values(this.intentValues(intent, quote))
        .onConflictDoNothing({ target: paymentIntents.idempotencyKey });

      const [savedRow] = await transaction
        .select()
        .from(paymentIntents)
        .where(eq(paymentIntents.idempotencyKey, intent.idempotencyKey))
        .limit(1);
      if (!savedRow) {
        throw new Error("Staged payment intent was not persisted.");
      }
      if (savedRow.status !== "created") {
        return this.mapIntent(savedRow);
      }

      const insertedOutbox = await transaction
        .insert(providerIntentOutbox)
        .values({ ...outbox, paymentIntentId: savedRow.id })
        .onConflictDoNothing({ target: providerIntentOutbox.paymentIntentId })
        .returning({ id: providerIntentOutbox.id });
      if (insertedOutbox.length === 0) {
        await transaction
          .update(providerIntentOutbox)
          .set({
            attemptCount: sql`${providerIntentOutbox.attemptCount} + 1`,
            lastAttemptAt: outbox.lastAttemptAt,
            lastFailureCode: null,
            updatedAt: outbox.updatedAt,
          })
          .where(eq(providerIntentOutbox.paymentIntentId, savedRow.id));
      }

      return this.mapIntent(savedRow);
    });
  }

  async completeProviderIntent(
    paymentIntentId: string,
    completion: ProviderIntentCompletion,
  ): Promise<StoredPaymentIntent> {
    return this.database.transaction(async (transaction) => {
      const [completedRow] = await transaction
        .update(paymentIntents)
        .set({
          destinationToken: completion.destinationToken,
          expiresAt: completion.expiresAt,
          providerReference: completion.providerReference,
          status: "provider_collecting",
          updatedAt: completion.updatedAt,
        })
        .where(and(eq(paymentIntents.id, paymentIntentId), eq(paymentIntents.status, "created")))
        .returning();

      if (!completedRow) {
        const [existingRow] = await transaction
          .select()
          .from(paymentIntents)
          .where(eq(paymentIntents.id, paymentIntentId))
          .limit(1);
        if (!existingRow) {
          throw new Error("Provider intent completion has no staged intent.");
        }
        return this.mapIntent(existingRow);
      }

      const completedOutbox = await transaction
        .update(providerIntentOutbox)
        .set({
          lastFailureCode: null,
          processedAt: completion.updatedAt,
          updatedAt: completion.updatedAt,
        })
        .where(eq(providerIntentOutbox.paymentIntentId, paymentIntentId))
        .returning({ id: providerIntentOutbox.id });
      if (completedOutbox.length === 0) {
        throw new Error("Provider intent completion has no outbox row.");
      }

      return this.mapIntent(completedRow);
    });
  }

  async recordProviderIntentFailure(
    paymentIntentId: string,
    failureCode: string,
    failedAt: Date,
  ): Promise<void> {
    await this.database
      .update(providerIntentOutbox)
      .set({ lastFailureCode: failureCode, updatedAt: failedAt })
      .where(
        and(
          eq(providerIntentOutbox.paymentIntentId, paymentIntentId),
          isNull(providerIntentOutbox.processedAt),
        ),
      );
  }

  async getProviderIntentOutbox(
    paymentIntentId: string,
  ): Promise<StoredProviderIntentOutbox | undefined> {
    const row = await this.database.query.providerIntentOutbox.findFirst({
      where: eq(providerIntentOutbox.paymentIntentId, paymentIntentId),
    });
    return row ? this.mapProviderIntentOutbox(row) : undefined;
  }

  async getIntent(id: string): Promise<StoredPaymentIntent | undefined> {
    const row = await this.database.query.paymentIntents.findFirst({
      where: eq(paymentIntents.id, id),
    });
    return row ? this.mapIntent(row) : undefined;
  }

  async findIntentByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<StoredPaymentIntent | undefined> {
    const row = await this.database.query.paymentIntents.findFirst({
      where: eq(paymentIntents.idempotencyKey, idempotencyKey),
    });
    return row ? this.mapIntent(row) : undefined;
  }

  async findIntentByProviderReference(
    provider: string,
    providerReference: string,
  ): Promise<StoredPaymentIntent | undefined> {
    const row = await this.database.query.paymentIntents.findFirst({
      where: and(
        eq(paymentIntents.provider, provider),
        eq(paymentIntents.providerReference, providerReference),
      ),
    });
    return row ? this.mapIntent(row) : undefined;
  }

  async appendProviderEvent(event: StoredProviderEvent): Promise<AppendProviderEventResult> {
    const inserted = await this.database
      .insert(providerEvents)
      .values(event)
      .onConflictDoNothing({
        target: [providerEvents.provider, providerEvents.providerEventId],
      })
      .returning();
    if (inserted[0]) {
      return { event: this.mapProviderEvent(inserted[0]), outcome: "inserted" };
    }

    const existing = await this.getProviderEvent(event.provider, event.providerEventId);
    if (!existing) {
      throw new Error("Provider event conflict could not be resolved.");
    }
    return {
      event: existing,
      outcome:
        existing.paymentIntentId === event.paymentIntentId &&
        existing.payloadHash === event.payloadHash
          ? "duplicate"
          : "conflict",
    };
  }

  async getProviderEvent(
    provider: string,
    providerEventId: string,
  ): Promise<StoredProviderEvent | undefined> {
    const row = await this.database.query.providerEvents.findFirst({
      where: and(
        eq(providerEvents.provider, provider),
        eq(providerEvents.providerEventId, providerEventId),
      ),
    });
    return row ? this.mapProviderEvent(row) : undefined;
  }

  async readOperationalSnapshot(now: Date): Promise<OperationalSnapshot> {
    const countRows = async (
      table:
        | typeof quotes
        | typeof paymentIntents
        | typeof providerEvents
        | typeof providerIntentOutbox,
    ) => {
      const [row] = await this.database.select({ value: count() }).from(table);
      return row?.value ?? 0;
    };
    const [
      intentCounts,
      retainedQuotes,
      retainedIntents,
      retainedEvents,
      retainedOutbox,
      dueQuotes,
      dueIntents,
      dueEvents,
      dueOutbox,
      pendingEventCount,
      oldestPendingEvent,
      lastAcceptedCallback,
      pendingOutboxCount,
      oldestPendingOutbox,
      oneAttempt,
      twoToThreeAttempts,
      fourPlusAttempts,
      lastOutboxFailure,
    ] = await Promise.all([
      this.database
        .select({
          count: count(),
          direction: paymentIntents.direction,
          status: paymentIntents.status,
        })
        .from(paymentIntents)
        .groupBy(paymentIntents.direction, paymentIntents.status),
      countRows(quotes),
      countRows(paymentIntents),
      countRows(providerEvents),
      countRows(providerIntentOutbox),
      this.database.select({ value: count() }).from(quotes).where(lte(quotes.purgeAt, now)),
      this.database
        .select({ value: count() })
        .from(paymentIntents)
        .where(lte(paymentIntents.purgeAt, now)),
      this.database
        .select({ value: count() })
        .from(providerEvents)
        .where(lte(providerEvents.purgeAt, now)),
      this.database
        .select({ value: count() })
        .from(providerIntentOutbox)
        .where(lte(providerIntentOutbox.purgeAt, now)),
      this.database
        .select({ value: count() })
        .from(providerEvents)
        .where(isNull(providerEvents.processedAt)),
      this.database
        .select({ receivedAt: providerEvents.receivedAt })
        .from(providerEvents)
        .where(isNull(providerEvents.processedAt))
        .orderBy(asc(providerEvents.receivedAt))
        .limit(1),
      this.database
        .select({ receivedAt: providerEvents.receivedAt })
        .from(providerEvents)
        .orderBy(desc(providerEvents.receivedAt))
        .limit(1),
      this.database
        .select({ value: count() })
        .from(providerIntentOutbox)
        .where(isNull(providerIntentOutbox.processedAt)),
      this.database
        .select({ lastAttemptAt: providerIntentOutbox.lastAttemptAt })
        .from(providerIntentOutbox)
        .where(isNull(providerIntentOutbox.processedAt))
        .orderBy(asc(providerIntentOutbox.lastAttemptAt))
        .limit(1),
      this.database
        .select({ value: count() })
        .from(providerIntentOutbox)
        .where(
          and(isNull(providerIntentOutbox.processedAt), eq(providerIntentOutbox.attemptCount, 1)),
        ),
      this.database
        .select({ value: count() })
        .from(providerIntentOutbox)
        .where(
          and(
            isNull(providerIntentOutbox.processedAt),
            between(providerIntentOutbox.attemptCount, 2, 3),
          ),
        ),
      this.database
        .select({ value: count() })
        .from(providerIntentOutbox)
        .where(
          and(isNull(providerIntentOutbox.processedAt), gte(providerIntentOutbox.attemptCount, 4)),
        ),
      this.database
        .select({ lastFailureCode: providerIntentOutbox.lastFailureCode })
        .from(providerIntentOutbox)
        .where(
          and(
            isNull(providerIntentOutbox.processedAt),
            isNotNull(providerIntentOutbox.lastFailureCode),
          ),
        )
        .orderBy(desc(providerIntentOutbox.updatedAt))
        .limit(1),
    ]);

    return {
      intents: intentCounts,
      lastAcceptedCallbackAt: lastAcceptedCallback[0]?.receivedAt ?? null,
      oldestPendingOutboxAt: oldestPendingOutbox[0]?.lastAttemptAt ?? null,
      oldestUnprocessedEventAt: oldestPendingEvent[0]?.receivedAt ?? null,
      outboxAttemptBuckets: {
        "1": oneAttempt[0]?.value ?? 0,
        "2_3": twoToThreeAttempts[0]?.value ?? 0,
        "4_plus": fourPlusAttempts[0]?.value ?? 0,
      },
      outboxLastFailureCategory: safeOutboxFailureCategory(
        lastOutboxFailure[0]?.lastFailureCode ?? null,
      ),
      pendingOutbox: pendingOutboxCount[0]?.value ?? 0,
      purgeEligible: {
        events: dueEvents[0]?.value ?? 0,
        intents: dueIntents[0]?.value ?? 0,
        outbox: dueOutbox[0]?.value ?? 0,
        quotes: dueQuotes[0]?.value ?? 0,
      },
      retained: {
        events: retainedEvents,
        intents: retainedIntents,
        outbox: retainedOutbox,
        quotes: retainedQuotes,
      },
      unprocessedProviderEvents: pendingEventCount[0]?.value ?? 0,
    };
  }

  async purgeDue(
    now: Date,
  ): Promise<{ events: number; intents: number; outbox: number; quotes: number }> {
    const result = await purgeExpiredOperationalData(this.database, now);
    return {
      events: result.providerEvents,
      intents: result.paymentIntents,
      outbox: result.providerIntentOutbox,
      quotes: result.quotes,
    };
  }

  private mapProviderEvent(row: typeof providerEvents.$inferSelect): StoredProviderEvent {
    return {
      id: row.id,
      normalizedStatus: row.normalizedStatus,
      occurredAt: row.occurredAt,
      payloadHash: row.payloadHash,
      paymentIntentId: row.paymentIntentId,
      processedAt: row.processedAt,
      provider: row.provider,
      providerEventId: row.providerEventId,
      purgeAt: row.purgeAt,
      receivedAt: row.receivedAt,
    };
  }

  private mapProviderIntentOutbox(
    row: typeof providerIntentOutbox.$inferSelect,
  ): StoredProviderIntentOutbox {
    return {
      attemptCount: row.attemptCount,
      createdAt: row.createdAt,
      id: row.id,
      lastAttemptAt: row.lastAttemptAt,
      lastFailureCode: row.lastFailureCode,
      paymentIntentId: row.paymentIntentId,
      processedAt: row.processedAt,
      provider: row.provider,
      purgeAt: row.purgeAt,
      updatedAt: row.updatedAt,
    };
  }

  private intentValues(intent: StoredPaymentIntent, quote: StoredQuote) {
    return {
      createdAt: intent.createdAt,
      destinationToken: intent.destinationToken,
      direction: intent.direction,
      expiresAt: intent.expiresAt,
      failureCode: intent.failureCode,
      id: intent.id,
      idempotencyKey: intent.idempotencyKey,
      provider: intent.provider,
      providerReference: intent.providerReference,
      purgeAt: intent.purgeAt,
      quoteId: intent.quoteId,
      settlementAmountSats: quote.merchantAmountSats,
      settlementAmountZmwMinor: quote.merchantAmountZmwMinor,
      settlementAsset: intent.direction === "btc_to_zmw" ? ("ZMW" as const) : ("BTC" as const),
      sourceAmountSats: quote.payerAmountSats,
      sourceAmountZmwMinor: quote.payerAmountZmwMinor,
      sourceAsset: intent.direction === "zmw_to_btc" ? ("ZMW" as const) : ("BTC" as const),
      status: intent.status,
      updatedAt: intent.updatedAt,
    };
  }

  private mapIntent(row: typeof paymentIntents.$inferSelect): StoredPaymentIntent {
    return {
      createdAt: row.createdAt,
      destinationToken: row.destinationToken,
      direction: row.direction,
      expiresAt: row.expiresAt,
      failureCode: row.failureCode,
      id: row.id,
      idempotencyKey: row.idempotencyKey,
      provider: row.provider,
      providerReference: row.providerReference,
      purgeAt: row.purgeAt,
      quoteId: row.quoteId,
      status: row.status,
      updatedAt: row.updatedAt,
    };
  }
}
