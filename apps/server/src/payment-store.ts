import type { CreateQuoteResponse, PaymentDirection, PaymentStatus } from "@ntumba/contracts";

export interface StoredQuote {
  amountZmwMinor: bigint;
  feeZmwMinor: bigint;
  merchantAmountSats: bigint | null;
  merchantAmountZmwMinor: bigint | null;
  payerAmountSats: bigint | null;
  payerAmountZmwMinor: bigint | null;
  purgeAt: Date;
  rateZmwMinorPerBitcoin: bigint;
  response: CreateQuoteResponse;
}

export interface StoredPaymentIntent {
  createdAt: Date;
  destinationToken: string | null;
  direction: PaymentDirection;
  expiresAt: Date;
  failureCode: string | null;
  id: string;
  idempotencyKey: string;
  provider: string | null;
  providerReference: string | null;
  purgeAt: Date;
  quoteId: string;
  status: PaymentStatus;
  updatedAt: Date;
}

export interface PaymentStore {
  findIntentByIdempotencyKey(idempotencyKey: string): Promise<StoredPaymentIntent | undefined>;
  getIntent(id: string): Promise<StoredPaymentIntent | undefined>;
  getQuote(id: string): Promise<StoredQuote | undefined>;
  purgeDue(now: Date): Promise<{ intents: number; quotes: number }>;
  saveIntent(intent: StoredPaymentIntent): Promise<StoredPaymentIntent>;
  saveQuote(quote: StoredQuote): Promise<void>;
}

export class InMemoryPaymentStore implements PaymentStore {
  readonly #intents = new Map<string, StoredPaymentIntent>();
  readonly #intentIdsByIdempotencyKey = new Map<string, string>();
  readonly #quotes = new Map<string, StoredQuote>();

  async saveQuote(quote: StoredQuote): Promise<void> {
    this.#quotes.set(quote.response.quoteId, quote);
  }

  async getQuote(id: string): Promise<StoredQuote | undefined> {
    return this.#quotes.get(id);
  }

  async saveIntent(intent: StoredPaymentIntent): Promise<StoredPaymentIntent> {
    const existing = await this.findIntentByIdempotencyKey(intent.idempotencyKey);
    if (existing) {
      return existing;
    }
    this.#intents.set(intent.id, intent);
    this.#intentIdsByIdempotencyKey.set(intent.idempotencyKey, intent.id);
    return intent;
  }

  async getIntent(id: string): Promise<StoredPaymentIntent | undefined> {
    return this.#intents.get(id);
  }

  async findIntentByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<StoredPaymentIntent | undefined> {
    const intentId = this.#intentIdsByIdempotencyKey.get(idempotencyKey);
    return intentId ? this.#intents.get(intentId) : undefined;
  }

  async purgeDue(now: Date): Promise<{ intents: number; quotes: number }> {
    let intents = 0;
    let quotes = 0;

    for (const [id, intent] of this.#intents) {
      if (intent.purgeAt.getTime() <= now.getTime()) {
        this.#intents.delete(id);
        this.#intentIdsByIdempotencyKey.delete(intent.idempotencyKey);
        intents += 1;
      }
    }

    const referencedQuoteIds = new Set([...this.#intents.values()].map((intent) => intent.quoteId));
    for (const [id, quote] of this.#quotes) {
      if (quote.purgeAt.getTime() <= now.getTime() && !referencedQuoteIds.has(id)) {
        this.#quotes.delete(id);
        quotes += 1;
      }
    }

    return { intents, quotes };
  }
}
