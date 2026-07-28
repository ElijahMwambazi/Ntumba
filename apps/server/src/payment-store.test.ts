import type { CreateQuoteResponse } from "@ntumba/contracts";
import { describe, expect, it } from "vitest";
import {
  InMemoryPaymentStore,
  type StoredPaymentIntent,
  type StoredProviderEvent,
  type StoredProviderIntentOutbox,
} from "./payment-store.js";

const quote: CreateQuoteResponse = {
  amountZmw: "100.00",
  direction: "btc_to_zmw",
  exchangeRate: "1 BTC = K1800000.00",
  expiresAt: "2026-07-27T10:01:00.000Z",
  feeZmw: "5.00",
  merchantReceives: { amount: "100.00", asset: "ZMW", display: "K100.00" },
  payerSends: { amount: "5834", asset: "BTC", display: "5,834 sats" },
  quoteId: "3f1672e0-7a68-49a5-a48b-9258bcba3ef0",
};

describe("payment store retention", () => {
  it("purges due operational records without retaining a destination", async () => {
    const store = new InMemoryPaymentStore();
    await store.saveQuote({
      amountZmwMinor: 10_000n,
      feeZmwMinor: 500n,
      merchantAmountSats: null,
      merchantAmountZmwMinor: 10_000n,
      payerAmountSats: 5_834n,
      payerAmountZmwMinor: null,
      purgeAt: new Date("2026-07-27T11:01:00.000Z"),
      rateZmwMinorPerBitcoin: 180_000_000n,
      response: quote,
    });
    await store.saveIntent({
      createdAt: new Date("2026-07-27T10:00:00.000Z"),
      destinationToken: "opaque-destination",
      direction: "btc_to_zmw",
      expiresAt: new Date("2026-07-27T10:01:00.000Z"),
      failureCode: null,
      id: "14c9fd48-b2b4-436a-989c-f540122c8dad",
      idempotencyKey: "0123456789abcdef",
      provider: "fake",
      providerReference: "opaque",
      purgeAt: new Date("2026-07-27T11:01:00.000Z"),
      quoteId: quote.quoteId,
      status: "provider_collecting",
      updatedAt: new Date("2026-07-27T10:00:00.000Z"),
    });

    expect(
      JSON.stringify(await store.getIntent("14c9fd48-b2b4-436a-989c-f540122c8dad")),
    ).not.toContain("phone");
    expect(await store.purgeDue(new Date("2026-07-27T11:01:00.000Z"))).toEqual({
      events: 0,
      intents: 1,
      outbox: 0,
      quotes: 1,
    });
  });

  it("appends provider events without overwriting duplicates or conflicting replays", async () => {
    const store = new InMemoryPaymentStore();
    const event: StoredProviderEvent = {
      id: "26a4370a-5839-462b-b158-e30071b40bf7",
      normalizedStatus: "settling",
      occurredAt: new Date("2026-07-27T10:00:10.000Z"),
      payloadHash: "a".repeat(64),
      paymentIntentId: "14c9fd48-b2b4-436a-989c-f540122c8dad",
      processedAt: null,
      provider: "fake",
      providerEventId: "fake-event-1",
      purgeAt: new Date("2026-07-27T11:01:00.000Z"),
      receivedAt: new Date("2026-07-27T10:00:11.000Z"),
    };

    await expect(store.appendProviderEvent(event)).resolves.toMatchObject({
      outcome: "inserted",
    });
    await expect(
      store.appendProviderEvent({ ...event, id: "c6423631-f48f-4be6-a7c8-86d040985b35" }),
    ).resolves.toMatchObject({ outcome: "duplicate" });
    await expect(
      store.appendProviderEvent({
        ...event,
        id: "71ed3cc5-a0de-48a5-8878-2a7a730930ba",
        payloadHash: "b".repeat(64),
      }),
    ).resolves.toMatchObject({ outcome: "conflict" });
    expect(await store.getProviderEvent("fake", "fake-event-1")).toEqual(event);
    expect(await store.purgeDue(event.purgeAt)).toEqual({
      events: 1,
      intents: 0,
      outbox: 0,
      quotes: 0,
    });
  });

  it("stages and completes provider intent creation without storing a destination", async () => {
    const store = new InMemoryPaymentStore();
    const attemptedAt = new Date("2026-07-27T10:00:00.000Z");
    const intent: StoredPaymentIntent = {
      createdAt: attemptedAt,
      destinationToken: null,
      direction: "btc_to_zmw",
      expiresAt: new Date("2026-07-27T10:01:00.000Z"),
      failureCode: null,
      id: "14c9fd48-b2b4-436a-989c-f540122c8dad",
      idempotencyKey: "outbox-intent-012345",
      provider: "fake",
      providerReference: null,
      purgeAt: new Date("2026-07-27T11:01:00.000Z"),
      quoteId: quote.quoteId,
      status: "created",
      updatedAt: attemptedAt,
    };
    const outbox: StoredProviderIntentOutbox = {
      attemptCount: 1,
      createdAt: attemptedAt,
      id: "5166cf71-8eda-4fe1-97ae-711275c86307",
      lastAttemptAt: attemptedAt,
      lastFailureCode: null,
      paymentIntentId: intent.id,
      processedAt: null,
      provider: "fake",
      purgeAt: intent.purgeAt,
      updatedAt: attemptedAt,
    };

    await expect(store.stageProviderIntent(intent, outbox)).resolves.toMatchObject({
      providerReference: null,
      status: "created",
    });
    await store.recordProviderIntentFailure(
      intent.id,
      "PROVIDER_REQUEST_FAILED",
      new Date("2026-07-27T10:00:01.000Z"),
    );
    expect(await store.getProviderIntentOutbox(intent.id)).toMatchObject({
      attemptCount: 1,
      lastFailureCode: "PROVIDER_REQUEST_FAILED",
      processedAt: null,
    });

    const retriedAt = new Date("2026-07-27T10:00:02.000Z");
    await store.stageProviderIntent(intent, {
      ...outbox,
      id: "53d3a967-2104-4240-b971-fc83940df726",
      lastAttemptAt: retriedAt,
      updatedAt: retriedAt,
    });
    const completedAt = new Date("2026-07-27T10:00:03.000Z");
    await expect(
      store.completeProviderIntent(intent.id, {
        destinationToken: "opaque-provider-token",
        expiresAt: new Date("2026-07-27T10:01:03.000Z"),
        providerReference: "opaque-provider-reference",
        updatedAt: completedAt,
      }),
    ).resolves.toMatchObject({
      providerReference: "opaque-provider-reference",
      status: "provider_collecting",
    });
    const completedOutbox = await store.getProviderIntentOutbox(intent.id);
    expect(completedOutbox).toMatchObject({
      attemptCount: 2,
      lastFailureCode: null,
      processedAt: completedAt,
    });
    expect(JSON.stringify(completedOutbox)).not.toContain("destination");
    expect(JSON.stringify(completedOutbox)).not.toContain("phone");
    expect(await store.purgeDue(intent.purgeAt)).toEqual({
      events: 0,
      intents: 1,
      outbox: 1,
      quotes: 0,
    });
  });
});
