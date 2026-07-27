import { describe, expect, it } from "vitest";
import { FakeDirectLightningProvider, FakeSettlementProvider } from "./fakes.js";

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
