import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "./payment-state.js";

describe("payment transitions", () => {
  it("allows provider collection to move to provider settlement", () => {
    expect(canTransition("created", "provider_collecting")).toBe(true);
    expect(canTransition("provider_collecting", "provider_settling")).toBe(true);
    expect(canTransition("provider_settling", "settled")).toBe(true);
  });

  it("prevents provider settlement before source collection", () => {
    expect(() => assertTransition("provider_collecting", "settled")).toThrow(
      "Illegal payment transition",
    );
  });

  it("models direct merchant Lightning settlement separately", () => {
    expect(canTransition("created", "direct_payment_pending")).toBe(true);
    expect(canTransition("direct_payment_pending", "direct_payment_settled")).toBe(true);
    expect(canTransition("direct_payment_settled", "provider_settling")).toBe(false);
  });

  it("preserves refund and manual-review paths", () => {
    expect(canTransition("provider_collecting", "refund_pending")).toBe(true);
    expect(canTransition("refund_pending", "refunded")).toBe(true);
    expect(canTransition("provider_settling", "manual_review")).toBe(true);
  });
});
