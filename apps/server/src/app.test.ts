import type { NtumbaConfig } from "@ntumba/config";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const config: NtumbaConfig = {
  APP_BASE_URL: "http://localhost:5173",
  DATABASE_URL: "postgresql://ntumba:ntumba@localhost:5432/ntumba_test",
  FLAT_FEE_ZMW: "5.00",
  HOST: "127.0.0.1",
  INTENT_RETENTION_SECONDS: 86_400,
  JOBS_ENABLED: false,
  LOG_LEVEL: "silent",
  NODE_ENV: "test",
  PORT: 3000,
  QUOTE_RETENTION_SECONDS: 3_600,
  QUOTE_TTL_SECONDS: 60,
  RATE_PROVIDER_MODE: "fake",
  SERVE_WEB: false,
  SETTLEMENT_PROVIDER_MODE: "fake",
  STATIC_BTC_ZMW_RATE: "1800000.00",
  VARIABLE_FEE_BPS: 0,
};

const openApps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

async function quote(app: Awaited<ReturnType<typeof buildApp>>, direction = "btc_to_zmw") {
  return app.inject({
    method: "POST",
    url: "/api/v1/quotes",
    payload: { amountZmw: "100.00", direction },
  });
}

describe("Ntumba API", () => {
  it("reports health", async () => {
    const app = await buildApp(config);
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ service: "ntumba", status: "ok" });
  });

  it("creates a quote without merchant destination data", async () => {
    const app = await buildApp(config);
    openApps.push(app);

    const response = await quote(app);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      amountZmw: "100.00",
      feeZmw: "5.00",
      merchantReceives: { amount: "100.00", asset: "ZMW" },
    });
    expect(response.body).not.toContain("recipient");
    expect(response.body).not.toContain("phone");
  });

  it("rejects malformed money without requiring payment details", async () => {
    const app = await buildApp(config);
    openApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/quotes",
      payload: { amountZmw: "-10", direction: "btc_to_zmw" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("creates a provider-direct intent without echoing a merchant phone", async () => {
    const app = await buildApp(config);
    openApps.push(app);
    const quoted = await quote(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/payment-intents",
      payload: {
        destination: {
          network: "mtn",
          phone: "0971234567",
          type: "mobile_money",
        },
        direction: "btc_to_zmw",
        idempotencyKey: "0123456789abcdef",
        quoteId: quoted.json().quoteId,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      checkout: { type: "provider" },
      status: "provider_collecting",
    });
    expect(response.body).not.toContain("0971234567");
  });

  it("preserves a merchant-owned direct invoice exactly", async () => {
    const app = await buildApp(config);
    openApps.push(app);
    const quoted = await quote(app, "btc_to_btc");
    const merchantInvoice = "lntb10n1merchantownedinvoice000000";

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/payment-intents",
      payload: {
        destination: { invoice: merchantInvoice, type: "lightning_invoice" },
        direction: "btc_to_btc",
        idempotencyKey: "fedcba9876543210",
        quoteId: quoted.json().quoteId,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      checkout: {
        merchantOwned: true,
        paymentRequest: merchantInvoice,
        verification: "unverified",
      },
      status: "direct_payment_pending",
    });
  });

  it("publishes an opaque development request without a merchant destination", async () => {
    const app = await buildApp(config);
    openApps.push(app);
    const quoted = await quote(app);
    const intent = await app.inject({
      method: "POST",
      url: "/api/v1/payment-intents",
      payload: {
        destination: {
          network: "mtn",
          phone: "0971234567",
          type: "mobile_money",
        },
        direction: "btc_to_zmw",
        idempotencyKey: "public-intent-012345",
        quoteId: quoted.json().quoteId,
      },
    });

    const published = await app.inject({
      method: "POST",
      url: "/api/v1/public-requests",
      payload: {
        amountZmw: "100.00",
        idempotencyKey: "public-request-012345",
        merchantLabel: "Market stall",
        options: [{ intent: intent.json(), payerMethod: "BTC" }],
        receiveAsset: "ZMW",
        reference: "Table 4",
      },
    });

    expect(published.statusCode).toBe(201);
    expect(published.json()).toMatchObject({
      developmentOnly: true,
      merchantLabel: "Market stall",
      receiveAsset: "ZMW",
      reference: "Table 4",
    });
    expect(published.body).not.toContain("0971234567");

    const loaded = await app.inject({
      method: "GET",
      url: `/api/v1/public-requests/${published.json().publicId}`,
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().publicId).toBe(published.json().publicId);
  });
});
