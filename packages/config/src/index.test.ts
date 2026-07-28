import { describe, expect, it } from "vitest";
import { loadConfig } from "./index.js";

describe("bridge configuration safety", () => {
  it("disables the bridge by default and exposes fake-only rail modes", () => {
    expect(loadConfig({ NODE_ENV: "development" })).toMatchObject({
      BITCOIN_LIQUIDITY_RAIL_MODE: "fake",
      BRIDGE_ENGINE_MODE: "disabled",
      MOBILE_MONEY_LIQUIDITY_RAIL_MODE: "fake",
      RATE_PROVIDER_MODE: "fake",
    });
  });

  it.each([
    ["BRIDGE_ENGINE_MODE", "voltage"],
    ["BRIDGE_ENGINE_MODE", "live"],
    ["BITCOIN_LIQUIDITY_RAIL_MODE", "mainnet"],
    ["MOBILE_MONEY_LIQUIDITY_RAIL_MODE", "lipila"],
    ["RATE_PROVIDER_MODE", "live"],
  ])("rejects unsupported %s=%s", (name, value) => {
    expect(() => loadConfig({ NODE_ENV: "development", [name]: value })).toThrow(
      "Invalid environment configuration",
    );
  });

  it("rejects the obsolete single settlement-provider gate", () => {
    expect(() => loadConfig({ NODE_ENV: "development", SETTLEMENT_PROVIDER_MODE: "fake" })).toThrow(
      "SETTLEMENT_PROVIDER_MODE is obsolete",
    );
  });

  it("prevents the fake bridge engine from running in production", () => {
    expect(() => loadConfig({ BRIDGE_ENGINE_MODE: "fake", NODE_ENV: "production" })).toThrow(
      "fake bridge engine cannot be enabled in production",
    );
  });

  it("keeps destination retention beyond source expiry and callback grace", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        SETTLEMENT_CALLBACK_GRACE_SECONDS: "60",
        SETTLEMENT_DESTINATION_TTL_SECONDS: "239",
        SOURCE_PAYMENT_TTL_SECONDS: "180",
      }),
    ).toThrow("must cover source expiry plus callback processing grace");
    expect(
      loadConfig({
        NODE_ENV: "development",
        SETTLEMENT_CALLBACK_GRACE_SECONDS: "60",
        SETTLEMENT_DESTINATION_TTL_SECONDS: "240",
        SOURCE_PAYMENT_TTL_SECONDS: "180",
      }).SETTLEMENT_DESTINATION_TTL_SECONDS,
    ).toBe(240);
  });
});
