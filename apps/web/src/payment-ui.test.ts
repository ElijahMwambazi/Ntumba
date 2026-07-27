import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  isExpired,
  maskDestination,
  payerMethodsFor,
  plainStatus,
} from "./payment-ui.js";

describe("payment UI rules", () => {
  it("derives customer payment methods from merchant settlement", () => {
    expect(payerMethodsFor("ZMW")).toEqual(["BTC"]);
    expect(payerMethodsFor("BTC")).toEqual(["BTC", "ZMW"]);
  });

  it("masks locally displayed destinations", () => {
    expect(maskDestination({ network: "mtn", phone: "0971234567", type: "mobile_money" })).toBe(
      "MTN ••• ••• 4567",
    );
    expect(maskDestination({ address: "merchant@wallet.example", type: "lightning_address" })).toBe(
      "me•••@wallet.example",
    );
  });

  it("handles quote expiry and countdowns", () => {
    const now = new Date("2026-07-27T10:00:00.000Z").getTime();
    expect(formatCountdown("2026-07-27T10:01:05.000Z", now)).toBe("1:05");
    expect(isExpired("2026-07-27T10:00:00.000Z", now)).toBe(true);
  });

  it("never describes an unverified direct payment as complete", () => {
    expect(plainStatus.direct_payment_pending.label).toBe("Waiting for payment");
    expect(plainStatus.direct_payment_pending.detail).toContain("cannot confirm");
  });
});
