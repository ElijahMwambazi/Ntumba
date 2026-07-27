import type { CreateQuoteResponse } from "@ntumba/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryPaymentStore } from "./payment-store.js";

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
      intents: 1,
      quotes: 1,
    });
  });
});
