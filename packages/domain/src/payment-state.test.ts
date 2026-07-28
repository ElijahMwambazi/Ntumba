import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "./payment-state.js";

describe("payment transitions", () => {
  it("models source collection and destination settlement as separate legs", () => {
    expect(canTransition("created", "quote_locked")).toBe(true);
    expect(canTransition("quote_locked", "awaiting_source_payment")).toBe(true);
    expect(canTransition("awaiting_source_payment", "source_payment_settled")).toBe(true);
    expect(canTransition("source_payment_settled", "destination_settlement_queued")).toBe(true);
    expect(
      canTransition("destination_settlement_queued", "destination_settlement_processing"),
    ).toBe(true);
    expect(canTransition("destination_settlement_processing", "settled")).toBe(true);
  });

  it("prevents destination settlement before conclusive source settlement", () => {
    expect(() => assertTransition("awaiting_source_payment", "settled")).toThrow(
      "Illegal payment transition",
    );
    expect(() => assertTransition("quote_locked", "destination_settlement_processing")).toThrow(
      "Illegal payment transition",
    );
  });

  it("models direct merchant Lightning settlement separately", () => {
    expect(canTransition("created", "direct_payment_pending")).toBe(true);
    expect(canTransition("direct_payment_pending", "direct_payment_settled")).toBe(true);
    expect(canTransition("direct_payment_settled", "destination_settlement_processing")).toBe(
      false,
    );
  });

  it("preserves refund and manual-review paths", () => {
    expect(canTransition("destination_settlement_failed", "refund_required")).toBe(true);
    expect(canTransition("refund_required", "refund_pending")).toBe(true);
    expect(canTransition("refund_pending", "refunded")).toBe(true);
    expect(canTransition("destination_settlement_processing", "manual_review")).toBe(true);
  });
});
