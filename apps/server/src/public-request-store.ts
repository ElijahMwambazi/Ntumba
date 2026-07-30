import { randomUUID } from "node:crypto";
import type { PublicPaymentRequest } from "@ntumba/contracts";
import {
  type NtumbaDatabase,
  publicPaymentRequestOptions,
  publicPaymentRequests,
} from "@ntumba/database";
import { formatZmwFromMinor, parseZmwToMinor } from "@ntumba/domain";
import { asc, eq, lte } from "drizzle-orm";
import type { PaymentStore } from "./payment-store.js";

export interface StoredPublicRequest {
  destinationLookupToken: string;
  idempotencyKey: string;
  purgeAt: Date;
  request: PublicPaymentRequest;
}

export interface PublicRequestStore {
  findByIdempotencyKey(idempotencyKey: string): Promise<StoredPublicRequest | undefined>;
  get(publicId: string): Promise<StoredPublicRequest | undefined>;
  purgeDue(now: Date): Promise<number>;
  save(record: StoredPublicRequest): Promise<{ created: boolean; record: StoredPublicRequest }>;
}

export class InMemoryPublicRequestStore implements PublicRequestStore {
  readonly #idByIdempotencyKey = new Map<string, string>();
  readonly #requests = new Map<string, StoredPublicRequest>();

  async findByIdempotencyKey(idempotencyKey: string): Promise<StoredPublicRequest | undefined> {
    const publicId = this.#idByIdempotencyKey.get(idempotencyKey);
    return publicId ? this.#requests.get(publicId) : undefined;
  }

  async get(publicId: string): Promise<StoredPublicRequest | undefined> {
    return this.#requests.get(publicId);
  }

  async save(
    record: StoredPublicRequest,
  ): Promise<{ created: boolean; record: StoredPublicRequest }> {
    const existing = await this.findByIdempotencyKey(record.idempotencyKey);
    if (existing) {
      return { created: false, record: existing };
    }
    this.#idByIdempotencyKey.set(record.idempotencyKey, record.request.publicId);
    this.#requests.set(record.request.publicId, record);
    return { created: true, record };
  }

  async purgeDue(now: Date): Promise<number> {
    let purged = 0;
    for (const [publicId, stored] of this.#requests) {
      if (stored.purgeAt.getTime() <= now.getTime()) {
        this.#requests.delete(publicId);
        this.#idByIdempotencyKey.delete(stored.idempotencyKey);
        purged += 1;
      }
    }
    return purged;
  }
}

export class PostgresPublicRequestStore implements PublicRequestStore {
  constructor(
    readonly database: NtumbaDatabase,
    readonly paymentStore: PaymentStore,
  ) {}

  async findByIdempotencyKey(idempotencyKey: string): Promise<StoredPublicRequest | undefined> {
    const [row] = await this.database
      .select({ id: publicPaymentRequests.id })
      .from(publicPaymentRequests)
      .where(eq(publicPaymentRequests.idempotencyKey, idempotencyKey))
      .limit(1);
    return row ? this.get(row.id) : undefined;
  }

  async get(publicId: string): Promise<StoredPublicRequest | undefined> {
    const [row] = await this.database
      .select()
      .from(publicPaymentRequests)
      .where(eq(publicPaymentRequests.id, publicId))
      .limit(1);
    if (!row) {
      return undefined;
    }
    const optionRows = await this.database
      .select()
      .from(publicPaymentRequestOptions)
      .where(eq(publicPaymentRequestOptions.publicRequestId, publicId))
      .orderBy(asc(publicPaymentRequestOptions.payerMethod));
    const options = await Promise.all(
      optionRows.map(async (option) => {
        const quote = await this.paymentStore.getQuote(option.quoteId);
        if (!quote || quote.response.direction !== option.direction) {
          throw new Error("A public request has no matching durable quote.");
        }
        return { payerMethod: option.payerMethod, quote: quote.response };
      }),
    );
    if (options.length === 0) {
      throw new Error("A public request has no payment options.");
    }
    return {
      destinationLookupToken: row.destinationLookupToken,
      idempotencyKey: row.idempotencyKey,
      purgeAt: row.purgeAt,
      request: {
        amountZmw: formatZmwFromMinor(row.amountZmwMinor),
        createdAt: row.createdAt.toISOString(),
        developmentOnly: true,
        expiresAt: row.expiresAt.toISOString(),
        options,
        publicId: row.id,
        receiveAsset: row.receiveAsset,
      },
    };
  }

  async save(
    record: StoredPublicRequest,
  ): Promise<{ created: boolean; record: StoredPublicRequest }> {
    const created = await this.database.transaction(async (transaction) => {
      const inserted = await transaction
        .insert(publicPaymentRequests)
        .values({
          amountZmwMinor: parseZmwToMinor(record.request.amountZmw),
          createdAt: new Date(record.request.createdAt),
          destinationLookupToken: record.destinationLookupToken,
          expiresAt: new Date(record.request.expiresAt),
          id: record.request.publicId,
          idempotencyKey: record.idempotencyKey,
          purgeAt: record.purgeAt,
          receiveAsset: record.request.receiveAsset,
        })
        .onConflictDoNothing({ target: publicPaymentRequests.idempotencyKey })
        .returning({ id: publicPaymentRequests.id });
      if (inserted.length === 0) {
        return false;
      }
      await transaction.insert(publicPaymentRequestOptions).values(
        record.request.options.map((option) => ({
          direction: option.quote.direction,
          id: randomUUID(),
          payerMethod: option.payerMethod,
          publicRequestId: record.request.publicId,
          quoteId: option.quote.quoteId,
        })),
      );
      return true;
    });
    if (created) {
      return { created: true, record };
    }
    const existing = await this.findByIdempotencyKey(record.idempotencyKey);
    if (!existing) {
      throw new Error("The durable public request could not be recovered.");
    }
    return { created: false, record: existing };
  }

  async purgeDue(now: Date): Promise<number> {
    const deleted = await this.database
      .delete(publicPaymentRequests)
      .where(lte(publicPaymentRequests.purgeAt, now))
      .returning({ id: publicPaymentRequests.id });
    return deleted.length;
  }
}
