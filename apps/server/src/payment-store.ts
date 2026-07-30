import type { CreateQuoteResponse, PaymentDirection, PaymentStatus } from "@ntumba/contracts";
import {
  type OperationalSnapshot,
  type OperationalSnapshotReader,
  safeOutboxFailureCategory,
} from "@ntumba/observability";
import type { BridgeEventStatus } from "@ntumba/providers";

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

export interface StoredProviderEvent {
  id: string;
  normalizedStatus: BridgeEventStatus;
  occurredAt: Date;
  payloadHash: string;
  paymentIntentId: string;
  processedAt: Date | null;
  provider: string;
  providerEventId: string;
  purgeAt: Date;
  receivedAt: Date;
}

export interface StoredProviderIntentOutbox {
  attemptCount: number;
  createdAt: Date;
  id: string;
  lastAttemptAt: Date;
  lastFailureCode: string | null;
  paymentIntentId: string;
  processedAt: Date | null;
  provider: string;
  purgeAt: Date;
  updatedAt: Date;
}

export interface ProviderIntentCompletion {
  destinationToken: string | null;
  expiresAt: Date;
  providerReference: string;
  updatedAt: Date;
}

export interface DirectIntentCompletion {
  expiresAt: Date;
  providerReference: string;
  updatedAt: Date;
}

export interface AppendProviderEventResult {
  event: StoredProviderEvent;
  outcome: "conflict" | "duplicate" | "inserted";
}

export interface PaymentStore extends OperationalSnapshotReader {
  appendProviderEvent(event: StoredProviderEvent): Promise<AppendProviderEventResult>;
  completeProviderIntent(
    paymentIntentId: string,
    completion: ProviderIntentCompletion,
  ): Promise<StoredPaymentIntent>;
  completeDirectIntent(
    paymentIntentId: string,
    completion: DirectIntentCompletion,
  ): Promise<StoredPaymentIntent>;
  findIntentByIdempotencyKey(idempotencyKey: string): Promise<StoredPaymentIntent | undefined>;
  findIntentByProviderReference(
    provider: string,
    providerReference: string,
  ): Promise<StoredPaymentIntent | undefined>;
  getIntent(id: string): Promise<StoredPaymentIntent | undefined>;
  getProviderEvent(
    provider: string,
    providerEventId: string,
  ): Promise<StoredProviderEvent | undefined>;
  getProviderIntentOutbox(paymentIntentId: string): Promise<StoredProviderIntentOutbox | undefined>;
  getQuote(id: string): Promise<StoredQuote | undefined>;
  purgeDue(now: Date): Promise<{ events: number; intents: number; outbox: number; quotes: number }>;
  recordProviderIntentFailure(
    paymentIntentId: string,
    failureCode: string,
    failedAt: Date,
  ): Promise<void>;
  saveIntent(intent: StoredPaymentIntent): Promise<StoredPaymentIntent>;
  saveQuote(quote: StoredQuote): Promise<void>;
  stageProviderIntent(
    intent: StoredPaymentIntent,
    outbox: StoredProviderIntentOutbox,
  ): Promise<StoredPaymentIntent>;
}

export class InMemoryPaymentStore implements PaymentStore {
  readonly #events = new Map<string, StoredProviderEvent>();
  readonly #intents = new Map<string, StoredPaymentIntent>();
  readonly #intentIdsByIdempotencyKey = new Map<string, string>();
  readonly #outbox = new Map<string, StoredProviderIntentOutbox>();
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

  async findIntentByProviderReference(
    provider: string,
    providerReference: string,
  ): Promise<StoredPaymentIntent | undefined> {
    return [...this.#intents.values()].find(
      (intent) => intent.provider === provider && intent.providerReference === providerReference,
    );
  }

  async appendProviderEvent(event: StoredProviderEvent): Promise<AppendProviderEventResult> {
    const key = `${event.provider}:${event.providerEventId}`;
    const existing = this.#events.get(key);
    if (existing) {
      return {
        event: existing,
        outcome:
          existing.paymentIntentId === event.paymentIntentId &&
          existing.payloadHash === event.payloadHash
            ? "duplicate"
            : "conflict",
      };
    }
    this.#events.set(key, event);
    return { event, outcome: "inserted" };
  }

  async getProviderEvent(
    provider: string,
    providerEventId: string,
  ): Promise<StoredProviderEvent | undefined> {
    return this.#events.get(`${provider}:${providerEventId}`);
  }

  async stageProviderIntent(
    intent: StoredPaymentIntent,
    outbox: StoredProviderIntentOutbox,
  ): Promise<StoredPaymentIntent> {
    const existing = await this.findIntentByIdempotencyKey(intent.idempotencyKey);
    if (existing) {
      if (existing.status === "created") {
        const existingOutbox = this.#outbox.get(existing.id);
        if (!existingOutbox) {
          this.#outbox.set(existing.id, { ...outbox, paymentIntentId: existing.id });
        } else {
          this.#outbox.set(existing.id, {
            ...existingOutbox,
            attemptCount: existingOutbox.attemptCount + 1,
            lastAttemptAt: outbox.lastAttemptAt,
            lastFailureCode: null,
            updatedAt: outbox.updatedAt,
          });
        }
      }
      return existing;
    }

    this.#intents.set(intent.id, intent);
    this.#intentIdsByIdempotencyKey.set(intent.idempotencyKey, intent.id);
    this.#outbox.set(intent.id, outbox);
    return intent;
  }

  async completeProviderIntent(
    paymentIntentId: string,
    completion: ProviderIntentCompletion,
  ): Promise<StoredPaymentIntent> {
    const intent = this.#intents.get(paymentIntentId);
    if (!intent) {
      throw new Error("Provider intent completion has no staged intent.");
    }
    if (intent.status !== "created") {
      return intent;
    }
    const outbox = this.#outbox.get(paymentIntentId);
    if (!outbox) {
      throw new Error("Provider intent completion has no outbox row.");
    }

    const completed: StoredPaymentIntent = {
      ...intent,
      destinationToken: completion.destinationToken,
      expiresAt: completion.expiresAt,
      providerReference: completion.providerReference,
      status: "awaiting_source_payment",
      updatedAt: completion.updatedAt,
    };
    this.#intents.set(paymentIntentId, completed);
    this.#outbox.set(paymentIntentId, {
      ...outbox,
      lastFailureCode: null,
      processedAt: completion.updatedAt,
      updatedAt: completion.updatedAt,
    });
    return completed;
  }

  async completeDirectIntent(
    paymentIntentId: string,
    completion: DirectIntentCompletion,
  ): Promise<StoredPaymentIntent> {
    const intent = this.#intents.get(paymentIntentId);
    if (!intent) {
      throw new Error("Direct payment completion has no staged intent.");
    }
    if (intent.status !== "quote_locked") {
      return intent;
    }
    const completed: StoredPaymentIntent = {
      ...intent,
      expiresAt: completion.expiresAt,
      providerReference: completion.providerReference,
      status: "direct_payment_pending",
      updatedAt: completion.updatedAt,
    };
    this.#intents.set(paymentIntentId, completed);
    return completed;
  }

  async recordProviderIntentFailure(
    paymentIntentId: string,
    failureCode: string,
    failedAt: Date,
  ): Promise<void> {
    const outbox = this.#outbox.get(paymentIntentId);
    if (!outbox || outbox.processedAt) {
      return;
    }
    this.#outbox.set(paymentIntentId, {
      ...outbox,
      lastFailureCode: failureCode,
      updatedAt: failedAt,
    });
  }

  async getProviderIntentOutbox(
    paymentIntentId: string,
  ): Promise<StoredProviderIntentOutbox | undefined> {
    return this.#outbox.get(paymentIntentId);
  }

  async findIntentByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<StoredPaymentIntent | undefined> {
    const intentId = this.#intentIdsByIdempotencyKey.get(idempotencyKey);
    return intentId ? this.#intents.get(intentId) : undefined;
  }

  async readOperationalSnapshot(now: Date): Promise<OperationalSnapshot> {
    const intentCounts = new Map<string, number>();
    for (const intent of this.#intents.values()) {
      const key = `${intent.direction}:${intent.status}`;
      intentCounts.set(key, (intentCounts.get(key) ?? 0) + 1);
    }
    const pendingEvents = [...this.#events.values()]
      .filter((event) => event.processedAt === null)
      .sort((left, right) => left.receivedAt.getTime() - right.receivedAt.getTime());
    const pendingOutbox = [...this.#outbox.values()]
      .filter((entry) => entry.processedAt === null)
      .sort((left, right) => left.lastAttemptAt.getTime() - right.lastAttemptAt.getTime());
    const lastFailure = [...pendingOutbox]
      .filter((entry) => entry.lastFailureCode !== null)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];

    return {
      intents: [...intentCounts].map(([key, count]) => {
        const [direction, status] = key.split(":") as [PaymentDirection, PaymentStatus];
        return { count, direction, status };
      }),
      lastAcceptedCallbackAt:
        [...this.#events.values()].sort(
          (left, right) => right.receivedAt.getTime() - left.receivedAt.getTime(),
        )[0]?.receivedAt ?? null,
      oldestPendingOutboxAt: pendingOutbox[0]?.lastAttemptAt ?? null,
      oldestUnprocessedEventAt: pendingEvents[0]?.receivedAt ?? null,
      outboxAttemptBuckets: {
        "1": pendingOutbox.filter((entry) => entry.attemptCount === 1).length,
        "2_3": pendingOutbox.filter((entry) => entry.attemptCount >= 2 && entry.attemptCount <= 3)
          .length,
        "4_plus": pendingOutbox.filter((entry) => entry.attemptCount >= 4).length,
      },
      outboxLastFailureCategory: safeOutboxFailureCategory(lastFailure?.lastFailureCode ?? null),
      pendingOutbox: pendingOutbox.length,
      purgeEligible: {
        events: [...this.#events.values()].filter((event) => event.purgeAt <= now).length,
        intents: [...this.#intents.values()].filter((intent) => intent.purgeAt <= now).length,
        outbox: [...this.#outbox.values()].filter((entry) => entry.purgeAt <= now).length,
        quotes: [...this.#quotes.values()].filter((quote) => quote.purgeAt <= now).length,
      },
      retained: {
        events: this.#events.size,
        intents: this.#intents.size,
        outbox: this.#outbox.size,
        quotes: this.#quotes.size,
      },
      treasury: {
        activeWorkerLeases: 0,
        bitcoinBalanceSats: 0n,
        bookBtcBalanceSats: 0n,
        bookZmwBalanceMinor: 0n,
        deadLetteredProviderEvents: 0,
        inboundCapacitySats: 0n,
        lastSuccessfulReconciliationAt: null,
        lateSourceSettlements: 0,
        lightningAvailable: false,
        manualReview: 0,
        reconciliationReviewRequired: 0,
        mobileMoneyAvailable: false,
        mobileMoneyBalanceZmwMinor: 0n,
        outboundCapacitySats: 0n,
        refundRequired: 0,
        retainedRefundLiabilityBtcSats: 0n,
        retainedRefundLiabilityZmwMinor: 0n,
        reservedBtcSats: 0n,
        reservedZmwMinor: 0n,
        unsettledBtcLiabilitySats: 0n,
        unsettledZmwLiabilityMinor: 0n,
        waitingDestinationSettlement: 0,
        waitingSourcePayment: 0,
        settlementAttemptFailed: 0,
        settlementAttemptSucceeded: 0,
        settlementAttemptTimeout: 0,
        settlementAttemptUnknown: 0,
      },
      unprocessedProviderEvents: pendingEvents.length,
    };
  }

  async purgeDue(
    now: Date,
  ): Promise<{ events: number; intents: number; outbox: number; quotes: number }> {
    let events = 0;
    let intents = 0;
    let outbox = 0;
    let quotes = 0;

    for (const [paymentIntentId, entry] of this.#outbox) {
      if (entry.purgeAt.getTime() <= now.getTime()) {
        this.#outbox.delete(paymentIntentId);
        outbox += 1;
      }
    }

    for (const [key, event] of this.#events) {
      if (event.purgeAt.getTime() <= now.getTime()) {
        this.#events.delete(key);
        events += 1;
      }
    }

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

    return { events, intents, outbox, quotes };
  }
}
