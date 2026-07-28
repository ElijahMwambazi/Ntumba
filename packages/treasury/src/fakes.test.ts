import { describe, expect, it } from "vitest";
import { FakeLipilaMobileMoneyTreasury, FakeVoltageLndTreasury } from "./fakes.js";

describe("fake Voltage/LND treasury correctness", () => {
  it("fails invoice creation while unavailable", async () => {
    const rail = new FakeVoltageLndTreasury({
      available: false,
      availableBalanceSats: 0n,
      inboundCapacitySats: 100n,
      outboundCapacitySats: 0n,
    });
    expect(
      await rail.createInvoice({
        amountSats: 10n,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        idempotencyKey: "invoice",
      }),
    ).toEqual({ outcome: "failure", value: null });
  });

  it("credits a settled invoice once and moves channel capacity", async () => {
    const rail = new FakeVoltageLndTreasury({
      available: true,
      availableBalanceSats: 20n,
      inboundCapacitySats: 100n,
      outboundCapacitySats: 20n,
    });
    const invoice = await rail.createInvoice({
      amountSats: 10n,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      idempotencyKey: "invoice",
    });
    const reference = invoice.value?.lookupReference ?? "";
    rail.setInvoiceState(reference, "settled");
    rail.setInvoiceState(reference, "settled");
    expect(await rail.readStatus()).toEqual({
      available: true,
      availableBalanceSats: 30n,
      inboundCapacitySats: 90n,
      outboundCapacitySats: 30n,
    });
  });

  it("refuses receipt beyond inbound capacity and moves capacity on payment", async () => {
    const rail = new FakeVoltageLndTreasury({
      available: true,
      availableBalanceSats: 50n,
      inboundCapacitySats: 5n,
      outboundCapacitySats: 50n,
    });
    const invoice = await rail.createInvoice({
      amountSats: 10n,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      idempotencyKey: "too-large",
    });
    rail.setInvoiceState(invoice.value?.lookupReference ?? "", "settled");
    expect(await rail.getInvoiceState(invoice.value?.lookupReference ?? "")).toBe("failed");
    await rail.payInvoice({
      amountSats: 20n,
      idempotencyKey: "payment",
      paymentRequest: "opaque-invoice",
    });
    expect(await rail.readStatus()).toEqual({
      available: true,
      availableBalanceSats: 30n,
      inboundCapacitySats: 25n,
      outboundCapacitySats: 30n,
    });
  });
});

describe("fake Lipila treasury correctness", () => {
  it("uses its stored collection amount and credits settlement once", async () => {
    const rail = new FakeLipilaMobileMoneyTreasury({
      available: true,
      availableBalanceZmwMinor: 20n,
    });
    const collection = await rail.collect({
      amountZmwMinor: 10n,
      idempotencyKey: "collection",
    });
    const reference = collection.value?.lookupReference ?? "";
    rail.setCollectionState(reference, "settled");
    rail.setCollectionState(reference, "settled");
    expect((await rail.readStatus()).availableBalanceZmwMinor).toBe(30n);
  });

  it("returns the original reference for duplicate success", async () => {
    const rail = new FakeLipilaMobileMoneyTreasury({
      available: true,
      availableBalanceZmwMinor: 100n,
    });
    const input = {
      amountZmwMinor: 10n,
      destination: { network: "mtn" as const, phone: "0971234567", type: "mobile_money" as const },
      idempotencyKey: "disbursement",
    };
    const first = await rail.disburse(input);
    const duplicate = await rail.disburse(input);
    expect(duplicate).toEqual(first);
    expect((await rail.readStatus()).availableBalanceZmwMinor).toBe(90n);
  });

  it("preserves timeout and unknown outcomes for the same external action", async () => {
    const rail = new FakeLipilaMobileMoneyTreasury();
    rail.queueOutcome("disburse", "unknown");
    const input = {
      amountZmwMinor: 10n,
      destination: { network: "mtn" as const, phone: "0971234567", type: "mobile_money" as const },
      idempotencyKey: "uncertain",
    };
    expect((await rail.disburse(input)).outcome).toBe("unknown");
    expect((await rail.disburse(input)).outcome).toBe("unknown");
  });
});
