import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FakeBridgeEventVerifier, FakeDirectLightningProvider } from "./fakes.js";

function signCallback(secret: string, timestamp: string, rawBody: Uint8Array): string {
  return `sha256=${createHmac("sha256", secret)
    .update(timestamp)
    .update(".")
    .update(rawBody)
    .digest("hex")}`;
}

describe("fake bridge callback verifier", () => {
  it("verifies and normalizes a current HMAC-signed callback", async () => {
    const now = new Date("2026-07-27T20:00:00.000Z");
    const secret = "x".repeat(32);
    const provider = new FakeBridgeEventVerifier({ callbackSecret: secret, now: () => now });
    const rawBody = Buffer.from(
      JSON.stringify({
        direction: "btc_to_zmw",
        eventId: "fake-event-1",
        occurredAt: now.toISOString(),
        providerReference: "fake-intent-1",
        settlement: { amount: "10000", asset: "ZMW" },
        source: { amount: "5834", asset: "BTC" },
        status: "destination_processing",
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
      status: "destination_processing",
    });
  });

  it("rejects tampered and stale signed callbacks", async () => {
    const now = new Date("2026-07-27T20:00:00.000Z");
    const secret = "x".repeat(32);
    const provider = new FakeBridgeEventVerifier({ callbackSecret: secret, now: () => now });
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
});

describe("direct merchant Lightning fake", () => {
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
