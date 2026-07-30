import { randomUUID } from "node:crypto";
import type {
  CreateQuoteResponse,
  PayerMethod,
  PaymentDirection,
  PublicPaymentRequest,
} from "@ntumba/contracts";
import {
  type NtumbaDatabase,
  publicPaymentRequestClaims,
  publicPaymentRequestOptions,
  publicPaymentRequestQuoteBindings,
  publicPaymentRequests,
  quotes,
} from "@ntumba/database";
import { formatZmwFromMinor, parseZmwToMinor } from "@ntumba/domain";
import { and, asc, eq, lte } from "drizzle-orm";
import type { PaymentStore } from "./payment-store.js";

export type PublicRequestStatus = "open" | "claimed" | "expired";

export interface StoredPublicRequest {
  destinationLookupToken: string;
  idempotencyKey: string;
  purgeAt: Date;
  request: PublicPaymentRequest;
  status: PublicRequestStatus;
}

export interface PublicRequestQuoteBinding {
  createdAt: Date;
  direction: PaymentDirection;
  idempotencyKey: string;
  payerMethod: PayerMethod;
  publicRequestId: string;
  quote: CreateQuoteResponse;
}

export interface PublicRequestClaim {
  claimedAt: Date;
  direction: PaymentDirection;
  payerMethod: PayerMethod;
  paymentIntentId: string;
  publicRequestId: string;
  quoteId: string;
  selectionIdempotencyKey: string;
}

export type BindPublicQuoteResult =
  | { outcome: "created" | "replay"; quote: CreateQuoteResponse }
  | { outcome: "conflict" | "unavailable" };

export type ClaimPublicRequestResult =
  | { claim: PublicRequestClaim; outcome: "claimed" | "replay" }
  | {
      outcome:
        | "conflict"
        | "expired"
        | "invalid_quote"
        | "missing"
        | "quote_expired"
        | "unsupported";
    };

export interface PublicRequestStore {
  bindQuote(binding: PublicRequestQuoteBinding): Promise<BindPublicQuoteResult>;
  claim(input: {
    direction: PaymentDirection;
    now: Date;
    payerMethod: PayerMethod;
    paymentIntentId: string;
    publicRequestId: string;
    quoteId: string;
    selectionIdempotencyKey: string;
  }): Promise<ClaimPublicRequestResult>;
  expire(publicRequestId: string, now: Date): Promise<void>;
  findByIdempotencyKey(idempotencyKey: string): Promise<StoredPublicRequest | undefined>;
  getClaim(publicRequestId: string): Promise<PublicRequestClaim | undefined>;
  get(publicId: string): Promise<StoredPublicRequest | undefined>;
  purgeDue(now: Date): Promise<number>;
  save(record: StoredPublicRequest): Promise<{ created: boolean; record: StoredPublicRequest }>;
}

export class InMemoryPublicRequestStore implements PublicRequestStore {
  readonly #bindingsByQuoteId = new Map<string, PublicRequestQuoteBinding>();
  readonly #bindingsByRequestKey = new Map<string, PublicRequestQuoteBinding>();
  readonly #claims = new Map<string, PublicRequestClaim>();
  readonly #idByIdempotencyKey = new Map<string, string>();
  readonly #requests = new Map<string, StoredPublicRequest>();

  async findByIdempotencyKey(idempotencyKey: string): Promise<StoredPublicRequest | undefined> {
    const publicId = this.#idByIdempotencyKey.get(idempotencyKey);
    return publicId ? this.#requests.get(publicId) : undefined;
  }

  async get(publicId: string): Promise<StoredPublicRequest | undefined> {
    return this.#requests.get(publicId);
  }

  async getClaim(publicRequestId: string): Promise<PublicRequestClaim | undefined> {
    return this.#claims.get(publicRequestId);
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

  async expire(publicRequestId: string, now: Date): Promise<void> {
    const request = this.#requests.get(publicRequestId);
    if (
      request?.status === "open" &&
      new Date(request.request.expiresAt).getTime() <= now.getTime()
    ) {
      this.#requests.set(publicRequestId, { ...request, status: "expired" });
    }
  }

  async bindQuote(binding: PublicRequestQuoteBinding): Promise<BindPublicQuoteResult> {
    const request = this.#requests.get(binding.publicRequestId);
    if (!request) {
      return { outcome: "unavailable" };
    }
    if (request.status !== "open" || new Date(request.request.expiresAt) <= binding.createdAt) {
      return { outcome: "unavailable" };
    }
    const key = `${binding.publicRequestId}:${binding.idempotencyKey}`;
    const existing = this.#bindingsByRequestKey.get(key);
    if (existing) {
      return existing.direction === binding.direction &&
        existing.payerMethod === binding.payerMethod
        ? { outcome: "replay", quote: existing.quote }
        : { outcome: "conflict" };
    }
    this.#bindingsByRequestKey.set(key, binding);
    this.#bindingsByQuoteId.set(binding.quote.quoteId, binding);
    return { outcome: "created", quote: binding.quote };
  }

  async claim(input: {
    direction: PaymentDirection;
    now: Date;
    payerMethod: PayerMethod;
    paymentIntentId: string;
    publicRequestId: string;
    quoteId: string;
    selectionIdempotencyKey: string;
  }): Promise<ClaimPublicRequestResult> {
    const request = this.#requests.get(input.publicRequestId);
    if (!request) {
      return { outcome: "missing" };
    }
    const existing = this.#claims.get(input.publicRequestId);
    if (existing) {
      return existing.selectionIdempotencyKey === input.selectionIdempotencyKey &&
        existing.quoteId === input.quoteId &&
        existing.payerMethod === input.payerMethod &&
        existing.direction === input.direction
        ? { claim: existing, outcome: "replay" }
        : { outcome: "conflict" };
    }
    if (request.status !== "open" || new Date(request.request.expiresAt) <= input.now) {
      this.#requests.set(input.publicRequestId, { ...request, status: "expired" });
      return { outcome: "expired" };
    }
    if (
      !request.request.options.some(
        (option) =>
          option.payerMethod === input.payerMethod && option.direction === input.direction,
      )
    ) {
      return { outcome: "unsupported" };
    }
    const binding = this.#bindingsByQuoteId.get(input.quoteId);
    if (
      !binding ||
      binding.publicRequestId !== input.publicRequestId ||
      binding.payerMethod !== input.payerMethod ||
      binding.direction !== input.direction
    ) {
      return { outcome: "invalid_quote" };
    }
    if (new Date(binding.quote.expiresAt) <= input.now) {
      return { outcome: "quote_expired" };
    }
    const claim: PublicRequestClaim = {
      claimedAt: input.now,
      direction: input.direction,
      payerMethod: input.payerMethod,
      paymentIntentId: input.paymentIntentId,
      publicRequestId: input.publicRequestId,
      quoteId: input.quoteId,
      selectionIdempotencyKey: input.selectionIdempotencyKey,
    };
    this.#claims.set(input.publicRequestId, claim);
    this.#requests.set(input.publicRequestId, { ...request, status: "claimed" });
    return { claim, outcome: "claimed" };
  }

  async purgeDue(now: Date): Promise<number> {
    let purged = 0;
    for (const [publicId, stored] of this.#requests) {
      if (stored.purgeAt <= now) {
        this.#requests.delete(publicId);
        this.#idByIdempotencyKey.delete(stored.idempotencyKey);
        this.#claims.delete(publicId);
        for (const [quoteId, binding] of this.#bindingsByQuoteId) {
          if (binding.publicRequestId === publicId) {
            this.#bindingsByQuoteId.delete(quoteId);
            this.#bindingsByRequestKey.delete(
              `${binding.publicRequestId}:${binding.idempotencyKey}`,
            );
          }
        }
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
    const options = await this.database
      .select({
        direction: publicPaymentRequestOptions.direction,
        payerMethod: publicPaymentRequestOptions.payerMethod,
      })
      .from(publicPaymentRequestOptions)
      .where(eq(publicPaymentRequestOptions.publicRequestId, publicId))
      .orderBy(asc(publicPaymentRequestOptions.payerMethod));
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
      status: row.status,
    };
  }

  async getClaim(publicRequestId: string): Promise<PublicRequestClaim | undefined> {
    const [row] = await this.database
      .select()
      .from(publicPaymentRequestClaims)
      .where(eq(publicPaymentRequestClaims.publicRequestId, publicRequestId))
      .limit(1);
    return row
      ? {
          claimedAt: row.claimedAt,
          direction: row.direction,
          payerMethod: row.payerMethod,
          paymentIntentId: row.paymentIntentId,
          publicRequestId: row.publicRequestId,
          quoteId: row.quoteId,
          selectionIdempotencyKey: row.selectionIdempotencyKey,
        }
      : undefined;
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
          status: record.status,
        })
        .onConflictDoNothing({ target: publicPaymentRequests.idempotencyKey })
        .returning({ id: publicPaymentRequests.id });
      if (inserted.length === 0) {
        return false;
      }
      await transaction.insert(publicPaymentRequestOptions).values(
        record.request.options.map((option) => ({
          direction: option.direction,
          id: randomUUID(),
          payerMethod: option.payerMethod,
          publicRequestId: record.request.publicId,
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

  async expire(publicRequestId: string, now: Date): Promise<void> {
    await this.database
      .update(publicPaymentRequests)
      .set({ status: "expired" })
      .where(
        and(
          eq(publicPaymentRequests.id, publicRequestId),
          eq(publicPaymentRequests.status, "open"),
          lte(publicPaymentRequests.expiresAt, now),
        ),
      );
  }

  async bindQuote(binding: PublicRequestQuoteBinding): Promise<BindPublicQuoteResult> {
    const inserted = await this.database.transaction(async (transaction) => {
      const [request] = await transaction
        .select({
          expiresAt: publicPaymentRequests.expiresAt,
          status: publicPaymentRequests.status,
        })
        .from(publicPaymentRequests)
        .where(eq(publicPaymentRequests.id, binding.publicRequestId))
        .for("update")
        .limit(1);
      if (!request) {
        return null;
      }
      if (request.status !== "open" || request.expiresAt <= binding.createdAt) {
        return null;
      }
      return transaction
        .insert(publicPaymentRequestQuoteBindings)
        .values({
          createdAt: binding.createdAt,
          direction: binding.direction,
          id: randomUUID(),
          idempotencyKey: binding.idempotencyKey,
          payerMethod: binding.payerMethod,
          publicRequestId: binding.publicRequestId,
          quoteId: binding.quote.quoteId,
        })
        .onConflictDoNothing({
          target: [
            publicPaymentRequestQuoteBindings.publicRequestId,
            publicPaymentRequestQuoteBindings.idempotencyKey,
          ],
        })
        .returning({ quoteId: publicPaymentRequestQuoteBindings.quoteId });
    });
    if (inserted === null) {
      return { outcome: "unavailable" };
    }
    if (inserted[0]) {
      return { outcome: "created", quote: binding.quote };
    }
    const [existing] = await this.database
      .select()
      .from(publicPaymentRequestQuoteBindings)
      .where(
        and(
          eq(publicPaymentRequestQuoteBindings.publicRequestId, binding.publicRequestId),
          eq(publicPaymentRequestQuoteBindings.idempotencyKey, binding.idempotencyKey),
        ),
      )
      .limit(1);
    if (
      !existing ||
      existing.direction !== binding.direction ||
      existing.payerMethod !== binding.payerMethod
    ) {
      return { outcome: "conflict" };
    }
    const quote = await this.paymentStore.getQuote(existing.quoteId);
    if (!quote) {
      throw new Error("A bound public-request quote was not retained.");
    }
    return { outcome: "replay", quote: quote.response };
  }

  async claim(input: {
    direction: PaymentDirection;
    now: Date;
    payerMethod: PayerMethod;
    paymentIntentId: string;
    publicRequestId: string;
    quoteId: string;
    selectionIdempotencyKey: string;
  }): Promise<ClaimPublicRequestResult> {
    return this.database.transaction(async (transaction) => {
      const [request] = await transaction
        .select()
        .from(publicPaymentRequests)
        .where(eq(publicPaymentRequests.id, input.publicRequestId))
        .for("update")
        .limit(1);
      if (!request) {
        return { outcome: "missing" };
      }
      const [existing] = await transaction
        .select()
        .from(publicPaymentRequestClaims)
        .where(eq(publicPaymentRequestClaims.publicRequestId, input.publicRequestId))
        .limit(1);
      if (existing) {
        const claim: PublicRequestClaim = {
          claimedAt: existing.claimedAt,
          direction: existing.direction,
          payerMethod: existing.payerMethod,
          paymentIntentId: existing.paymentIntentId,
          publicRequestId: existing.publicRequestId,
          quoteId: existing.quoteId,
          selectionIdempotencyKey: existing.selectionIdempotencyKey,
        };
        return existing.selectionIdempotencyKey === input.selectionIdempotencyKey &&
          existing.quoteId === input.quoteId &&
          existing.payerMethod === input.payerMethod &&
          existing.direction === input.direction
          ? { claim, outcome: "replay" }
          : { outcome: "conflict" };
      }
      if (request.status !== "open" || request.expiresAt <= input.now) {
        if (request.status === "open") {
          await transaction
            .update(publicPaymentRequests)
            .set({ status: "expired" })
            .where(eq(publicPaymentRequests.id, input.publicRequestId));
        }
        return { outcome: "expired" };
      }
      const [option] = await transaction
        .select({ id: publicPaymentRequestOptions.id })
        .from(publicPaymentRequestOptions)
        .where(
          and(
            eq(publicPaymentRequestOptions.publicRequestId, input.publicRequestId),
            eq(publicPaymentRequestOptions.payerMethod, input.payerMethod),
            eq(publicPaymentRequestOptions.direction, input.direction),
          ),
        )
        .limit(1);
      if (!option) {
        return { outcome: "unsupported" };
      }
      const [binding] = await transaction
        .select()
        .from(publicPaymentRequestQuoteBindings)
        .where(
          and(
            eq(publicPaymentRequestQuoteBindings.publicRequestId, input.publicRequestId),
            eq(publicPaymentRequestQuoteBindings.quoteId, input.quoteId),
            eq(publicPaymentRequestQuoteBindings.payerMethod, input.payerMethod),
            eq(publicPaymentRequestQuoteBindings.direction, input.direction),
          ),
        )
        .limit(1);
      if (!binding) {
        return { outcome: "invalid_quote" };
      }
      const [quote] = await transaction
        .select({ expiresAt: quotes.expiresAt })
        .from(quotes)
        .where(
          and(
            eq(quotes.id, input.quoteId),
            eq(quotes.direction, input.direction),
            eq(quotes.amountZmwMinor, request.amountZmwMinor),
          ),
        )
        .limit(1);
      if (!quote) {
        return { outcome: "invalid_quote" };
      }
      if (quote.expiresAt <= input.now) {
        return { outcome: "quote_expired" };
      }
      const claim: PublicRequestClaim = {
        claimedAt: input.now,
        direction: input.direction,
        payerMethod: input.payerMethod,
        paymentIntentId: input.paymentIntentId,
        publicRequestId: input.publicRequestId,
        quoteId: input.quoteId,
        selectionIdempotencyKey: input.selectionIdempotencyKey,
      };
      await transaction.insert(publicPaymentRequestClaims).values(claim);
      await transaction
        .update(publicPaymentRequests)
        .set({ status: "claimed" })
        .where(eq(publicPaymentRequests.id, input.publicRequestId));
      return { claim, outcome: "claimed" };
    });
  }

  async purgeDue(now: Date): Promise<number> {
    const deleted = await this.database
      .delete(publicPaymentRequests)
      .where(lte(publicPaymentRequests.purgeAt, now))
      .returning({ id: publicPaymentRequests.id });
    return deleted.length;
  }
}
