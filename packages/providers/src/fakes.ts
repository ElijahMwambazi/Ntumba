import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  BridgeDirection,
  BridgeEventStatus,
  BridgeEventVerifier,
  DirectLightningProvider,
  MerchantLightningInvoice,
  ProviderAsset,
  VerifiedBridgeCallback,
} from "./types.js";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

const callbackStatuses = new Set<BridgeEventStatus>([
  "source_pending",
  "source_confirming",
  "source_settled",
  "destination_queued",
  "destination_processing",
  "destination_settled",
  "failed",
  "refund_pending",
  "refunded",
  "unknown",
]);

export class ProviderCallbackVerificationError extends Error {
  readonly reason: "malformed" | "signature" | "timestamp";

  constructor(reason: "malformed" | "signature" | "timestamp" = "malformed") {
    super("Provider callback verification failed.");
    this.name = "ProviderCallbackVerificationError";
    this.reason = reason;
  }
}

function callbackHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined {
  const value = headers[name];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function callbackString(value: unknown, maximumLength = 200): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    throw new ProviderCallbackVerificationError("malformed");
  }
  return value;
}

function callbackAmount(value: unknown): bigint {
  const amount = callbackString(value, 30);
  if (!/^[1-9]\d*$/.test(amount)) {
    throw new ProviderCallbackVerificationError("malformed");
  }
  return BigInt(amount);
}

function callbackAsset(value: unknown): ProviderAsset {
  if (value !== "BTC" && value !== "ZMW") {
    throw new ProviderCallbackVerificationError("malformed");
  }
  return value;
}

function callbackDirection(value: unknown): BridgeDirection {
  if (value !== "btc_to_zmw" && value !== "zmw_to_btc") {
    throw new ProviderCallbackVerificationError("malformed");
  }
  return value;
}

export class FakeBridgeEventVerifier implements BridgeEventVerifier {
  readonly #callbackSecret: string | undefined;
  readonly #callbackToleranceMilliseconds: number;
  readonly #now: () => Date;

  constructor(
    options: {
      callbackSecret?: string | undefined;
      callbackToleranceSeconds?: number;
      now?: () => Date;
    } = {},
  ) {
    this.#callbackSecret = options.callbackSecret;
    this.#callbackToleranceMilliseconds = (options.callbackToleranceSeconds ?? 300) * 1_000;
    this.#now = options.now ?? (() => new Date());
  }

  async verifyCallback(input: {
    headers: Readonly<Record<string, string | string[] | undefined>>;
    rawBody: Uint8Array;
  }): Promise<VerifiedBridgeCallback> {
    const signature = callbackHeader(input.headers, "x-fake-signature");
    const timestamp = callbackHeader(input.headers, "x-fake-timestamp");
    if (
      !this.#callbackSecret ||
      !timestamp ||
      !/^\d{10}$/.test(timestamp) ||
      !signature ||
      !/^sha256=[a-f0-9]{64}$/.test(signature)
    ) {
      throw new ProviderCallbackVerificationError("signature");
    }

    const signedAt = Number(timestamp) * 1_000;
    if (
      !Number.isSafeInteger(signedAt) ||
      Math.abs(this.#now().getTime() - signedAt) > this.#callbackToleranceMilliseconds
    ) {
      throw new ProviderCallbackVerificationError("timestamp");
    }

    const expectedSignature = createHmac("sha256", this.#callbackSecret)
      .update(timestamp)
      .update(".")
      .update(input.rawBody)
      .digest();
    const suppliedSignature = Buffer.from(signature.slice("sha256=".length), "hex");
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      throw new ProviderCallbackVerificationError("signature");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(input.rawBody).toString("utf8"));
    } catch {
      throw new ProviderCallbackVerificationError("malformed");
    }
    if (!isRecord(payload) || !isRecord(payload.source) || !isRecord(payload.settlement)) {
      throw new ProviderCallbackVerificationError("malformed");
    }

    const occurredAt = new Date(callbackString(payload.occurredAt, 40));
    const status = callbackString(payload.status, 40);
    if (Number.isNaN(occurredAt.getTime()) || !callbackStatuses.has(status as BridgeEventStatus)) {
      throw new ProviderCallbackVerificationError("malformed");
    }

    return {
      direction: callbackDirection(payload.direction),
      eventId: callbackString(payload.eventId),
      occurredAt,
      payloadHash: createHash("sha256").update(input.rawBody).digest("hex"),
      providerReference: callbackString(payload.providerReference),
      settlementAmount: callbackAmount(payload.settlement.amount),
      settlementAsset: callbackAsset(payload.settlement.asset),
      sourceAmount: callbackAmount(payload.source.amount),
      sourceAsset: callbackAsset(payload.source.asset),
      status: status as BridgeEventStatus,
    };
  }
}

export class FakeDirectLightningProvider implements DirectLightningProvider {
  async getMerchantInvoiceStatus(_input: {
    paymentHash: string;
    paymentProof?: string;
  }): Promise<"pending" | "settled" | "expired" | "unknown"> {
    return "unknown";
  }

  async prepareMerchantInvoice(input: {
    amountSats: bigint;
    destination:
      | { address: string; type: "lightning_address" }
      | { invoice: string; type: "lightning_invoice" };
    paymentReference: string;
  }): Promise<MerchantLightningInvoice> {
    if (input.destination.type === "lightning_invoice") {
      return {
        expiresAt: new Date(Date.now() + 60_000),
        merchantOwned: true,
        paymentHash: digest(input.destination.invoice),
        paymentRequest: input.destination.invoice,
      };
    }

    const paymentHash = digest(`${input.destination.address}:${input.paymentReference}`);
    return {
      expiresAt: new Date(Date.now() + 60_000),
      merchantOwned: true,
      paymentHash,
      paymentRequest: `lntb${input.amountSats}n1merchant${paymentHash.slice(0, 24)}`,
    };
  }
}
