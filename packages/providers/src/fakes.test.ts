import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FakeDirectLightningProvider, FakeSettlementProvider } from "./fakes.js";

function signCallback(secret: string, timestamp: string, rawBody: Uint8Array): string {
  return `sha256=${createHmac("sha256", secret)
    .update(timestamp)
    .update(".")
    .update(rawBody)
    .digest("hex")}`;
}

describe("provider-direct fake", () => {
  it("returns the same opaque provider intent for an idempotency key", async () => {
    const provider = new FakeSettlementProvider();
    const input = {
      destination: {
        network: "mtn" as const,
        phone: "0971234567",
        type: "mobile_money" as const,
      },
      direction: "btc_to_zmw" as const,
      idempotencyKey: "0123456789abcdef",
      providerQuoteReference: "fake-quote-1",
    };

    const first = await provider.createPaymentIntent(input);
    const second = await provider.createPaymentIntent(input);

    expect(first.providerReference).toBe(second.providerReference);
    expect(first.status).toBe("collecting");
    expect(first.checkoutUrl).toContain("provider.invalid");
  });

  it("does not return the transient merchant destination", async () => {
    const provider = new FakeSettlementProvider();
    const intent = await provider.createPaymentIntent({
      destination: {
        network: "mtn",
        phone: "0971234567",
        type: "mobile_money",
      },
      direction: "btc_to_zmw",
      idempotencyKey: "0123456789abcdef",
      providerQuoteReference: "fake-quote-1",
    });

    expect(JSON.stringify(intent)).not.toContain("0971234567");
  });

  it("verifies and normalizes a current HMAC-signed callback", async () => {
    const now = new Date("2026-07-27T20:00:00.000Z");
    const secret = "x".repeat(32);
    const provider = new FakeSettlementProvider({ callbackSecret: secret, now: () => now });
    const rawBody = Buffer.from(
      JSON.stringify({
        direction: "btc_to_zmw",
        eventId: "fake-event-1",
        occurredAt: now.toISOString(),
        providerReference: "fake-intent-1",
        settlement: { amount: "10000", asset: "ZMW" },
        source: { amount: "5834", asset: "BTC" },
        status: "settling",
      }),
    );
    const timestamp = String(Math.floor(now.getTime() / 1_000));

    await expect(
      provider.verifyCallback({
        headers: {
          "x-fake-signature": signCallback(secret, timestamp, rawBody),
          "x-fake-timestamp": timestamp,
        },
        rawBody,
      }),
    ).resolves.toEqual({
      direction: "btc_to_zmw",
      eventId: "fake-event-1",
      occurredAt: now,
      payloadHash: createHash("sha256").update(rawBody).digest("hex"),
      providerReference: "fake-intent-1",
      settlementAmount: 10_000n,
      settlementAsset: "ZMW",
      sourceAmount: 5_834n,
      sourceAsset: "BTC",
      status: "settling",
    });
  });

  it("rejects tampered and stale signed callbacks", async () => {
    const now = new Date("2026-07-27T20:00:00.000Z");
    const secret = "x".repeat(32);
    const provider = new FakeSettlementProvider({ callbackSecret: secret, now: () => now });
    const rawBody = Buffer.from('{"eventId":"fake-event-1"}');
    const timestamp = String(Math.floor(now.getTime() / 1_000));
    const signature = signCallback(secret, timestamp, rawBody);

    await expect(
      provider.verifyCallback({
        headers: { "x-fake-signature": signature, "x-fake-timestamp": timestamp },
        rawBody: Buffer.from('{"eventId":"fake-event-2"}'),
      }),
    ).rejects.toThrow("Provider callback verification failed");

    const staleTimestamp = String(Math.floor(now.getTime() / 1_000) - 301);
    await expect(
      provider.verifyCallback({
        headers: {
          "x-fake-signature": signCallback(secret, staleTimestamp, rawBody),
          "x-fake-timestamp": staleTimestamp,
        },
        rawBody,
      }),
    ).rejects.toThrow("Provider callback verification failed");
  });

  it("passes through a merchant-owned invoice without replacing it", async () => {
    const provider = new FakeDirectLightningProvider();
    const merchantInvoice = "lntb10n1merchantownedinvoice000000";
    const invoice = await provider.prepareMerchantInvoice({
      amountSats: 10n,
      destination: { invoice: merchantInvoice, type: "lightning_invoice" },
      paymentReference: "direct-1",
    });

    expect(invoice.paymentRequest).toBe(merchantInvoice);
    expect(invoice.merchantOwned).toBe(true);
  });
});
