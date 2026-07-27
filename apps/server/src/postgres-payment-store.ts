import type { NtumbaConfig } from "@ntumba/config";
import type { CreateQuoteResponse } from "@ntumba/contracts";
import {
  type NtumbaDatabase,
  paymentIntents,
  purgeExpiredOperationalData,
  quotes,
} from "@ntumba/database";
import { formatZmwFromMinor } from "@ntumba/domain";
import { eq } from "drizzle-orm";
import type { PaymentStore, StoredPaymentIntent, StoredQuote } from "./payment-store.js";

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

    const sourceAsset = intent.direction === "zmw_to_btc" ? "ZMW" : "BTC";
    const settlementAsset = intent.direction === "btc_to_zmw" ? "ZMW" : "BTC";
    await this.database
      .insert(paymentIntents)
      .values({
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
        settlementAsset,
        sourceAmountSats: quote.payerAmountSats,
        sourceAmountZmwMinor: quote.payerAmountZmwMinor,
        sourceAsset,
        status: intent.status,
        updatedAt: intent.updatedAt,
      })
      .onConflictDoNothing({ target: paymentIntents.idempotencyKey });

    const saved = await this.findIntentByIdempotencyKey(intent.idempotencyKey);
    if (!saved) {
      throw new Error("Payment intent was not persisted.");
    }
    return saved;
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

  async purgeDue(now: Date): Promise<{ intents: number; quotes: number }> {
    const result = await purgeExpiredOperationalData(this.database, now);
    return { intents: result.paymentIntents, quotes: result.quotes };
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
