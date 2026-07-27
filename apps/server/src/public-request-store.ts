import type { PublicPaymentRequest } from "@ntumba/contracts";

interface StoredPublicRequest {
  idempotencyKey: string;
  purgeAt: Date;
  request: PublicPaymentRequest;
}

export interface PublicRequestStore {
  findByIdempotencyKey(idempotencyKey: string): Promise<PublicPaymentRequest | undefined>;
  get(publicId: string): Promise<PublicPaymentRequest | undefined>;
  purgeDue(now: Date): Promise<number>;
  save(
    idempotencyKey: string,
    request: PublicPaymentRequest,
    purgeAt: Date,
  ): Promise<PublicPaymentRequest>;
}

export class InMemoryPublicRequestStore implements PublicRequestStore {
  readonly #idByIdempotencyKey = new Map<string, string>();
  readonly #requests = new Map<string, StoredPublicRequest>();

  async findByIdempotencyKey(idempotencyKey: string): Promise<PublicPaymentRequest | undefined> {
    const publicId = this.#idByIdempotencyKey.get(idempotencyKey);
    return publicId ? this.#requests.get(publicId)?.request : undefined;
  }

  async get(publicId: string): Promise<PublicPaymentRequest | undefined> {
    return this.#requests.get(publicId)?.request;
  }

  async save(
    idempotencyKey: string,
    request: PublicPaymentRequest,
    purgeAt: Date,
  ): Promise<PublicPaymentRequest> {
    const existing = await this.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }
    this.#idByIdempotencyKey.set(idempotencyKey, request.publicId);
    this.#requests.set(request.publicId, { idempotencyKey, purgeAt, request });
    return request;
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
