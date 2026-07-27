import { describe, expect, it } from "vitest";
import { calculateQuote } from "./quote.js";

const baseInput = {
  amountZmwMinor: 10_000n,
  flatFeeZmwMinor: 500n,
  rateZmwMinorPerBitcoin: 180_000_000n,
  variableFeeBps: 0n,
};

describe("quote calculation", () => {
  it("adds the fee to a Lightning payer and preserves merchant ZMW", () => {
    const quote = calculateQuote({ ...baseInput, direction: "btc_to_zmw" });

    expect(quote.merchantReceivesZmwMinor).toBe(10_000n);
    expect(quote.payerSendsSats).toBe(5_834n);
    expect(quote.feeZmwMinor).toBe(500n);
  });

  it("adds the fee to a mobile-money payer and preserves merchant value", () => {
    const quote = calculateQuote({ ...baseInput, direction: "zmw_to_btc" });

    expect(quote.payerSendsZmwMinor).toBe(10_500n);
    expect(quote.merchantReceivesSats).toBe(5_555n);
  });

  it("quotes direct Bitcoin settlement without routing funds through Ntumba", () => {
    const quote = calculateQuote({ ...baseInput, direction: "btc_to_btc" });

    expect(quote.feeZmwMinor).toBe(0n);
    expect(quote.payerSendsSats).toBe(5_556n);
    expect(quote.merchantReceivesSats).toBe(5_556n);
    expect(quote.payerSendsZmwMinor).toBeNull();
    expect(quote.merchantReceivesZmwMinor).toBeNull();
  });
});
