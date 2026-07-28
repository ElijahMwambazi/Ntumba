import { createHmac } from "node:crypto";
import type { NtumbaConfig } from "@ntumba/config";
import { NtumbaMetrics } from "@ntumba/observability";
import { FakeDirectLightningProvider, FakeSettlementProvider } from "@ntumba/providers";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryPaymentStore } from "./payment-store.js";

class FailOnceSettlementProvider extends FakeSettlementProvider {
  readonly attemptedIdempotencyKeys: string[] = [];

  override async createPaymentIntent(
    input: Parameters<FakeSettlementProvider["createPaymentIntent"]>[0],
  ) {
    this.attemptedIdempotencyKeys.push(input.idempotencyKey);
    if (this.attemptedIdempotencyKeys.length === 1) {
      throw new Error("Synthetic provider timeout");
    }
    return super.createPaymentIntent(input);
  }
}

const config: NtumbaConfig = {
  APP_BASE_URL: "http://localhost:5173",
  DATABASE_URL: "postgresql://ntumba:ntumba@localhost:5432/ntumba_test",
  FLAT_FEE_ZMW: "5.00",
  HOST: "127.0.0.1",
  INTENT_RETENTION_SECONDS: 86_400,
  JOBS_ENABLED: false,
  LOG_LEVEL: "silent",
  NODE_ENV: "test",
  NTUMBA_BUILD_COMMIT: "development",
  OPS_ENABLED: false,
  OPS_HOST: "127.0.0.1",
  OPS_PORT: 9091,
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

function signedCallback(secret: string, payload: Record<string, unknown>, now: Date) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(now.getTime() / 1_000));
  const signature = createHmac("sha256", secret)
    .update(timestamp)
    .update(".")
    .update(body)
    .digest("hex");
  return {
    headers: {
      "content-type": "application/json",
      "x-fake-signature": `sha256=${signature}`,
      "x-fake-timestamp": timestamp,
    },
    payload: body,
  };
}

describe("Ntumba API", () => {
  it("reports health", async () => {
    const app = await buildApp(config);
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ service: "ntumba", status: "ok" });
  });

  it("does not expose operator routes on the public application", async () => {
    const app = await buildApp(config);
    openApps.push(app);

    for (const url of ["/metrics", "/ops", "/admin"]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);
    }
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

  it("resumes a staged provider intent after a transient provider failure", async () => {
    const store = new InMemoryPaymentStore();
    const settlementProvider = new FailOnceSettlementProvider();
    const app = await buildApp(config, {
      directLightningProvider: new FakeDirectLightningProvider(),
      settlementProvider,
      store,
    });
    openApps.push(app);
    const quoted = await quote(app);
    const payload = {
      destination: { network: "mtn", phone: "0971234567", type: "mobile_money" },
      direction: "btc_to_zmw",
      idempotencyKey: "outbox-retry-012345",
      quoteId: quoted.json().quoteId,
    };

    const failed = await app.inject({ method: "POST", url: "/api/v1/payment-intents", payload });
    expect(failed.statusCode).toBe(500);
    const staged = await store.findIntentByIdempotencyKey(payload.idempotencyKey);
    expect(staged).toMatchObject({ providerReference: null, status: "created" });
    const pendingOutbox = await store.getProviderIntentOutbox(staged?.id ?? "");
    expect(pendingOutbox).toMatchObject({
      attemptCount: 1,
      lastFailureCode: "PROVIDER_REQUEST_FAILED",
      processedAt: null,
    });
    expect(JSON.stringify(pendingOutbox)).not.toContain("0971234567");

    const recovered = await app.inject({
      method: "POST",
      url: "/api/v1/payment-intents",
      payload,
    });
    expect(recovered.statusCode).toBe(201);
    expect(recovered.json()).toMatchObject({
      paymentIntentId: staged?.id,
      status: "provider_collecting",
    });
    expect(settlementProvider.attemptedIdempotencyKeys).toEqual([
      payload.idempotencyKey,
      payload.idempotencyKey,
    ]);
    expect(await store.getProviderIntentOutbox(staged?.id ?? "")).toMatchObject({
      attemptCount: 2,
      lastFailureCode: null,
      processedAt: expect.any(Date),
    });
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

  it("accepts a matching signed callback once and stores only its normalized event", async () => {
    const now = new Date();
    const secret = "x".repeat(32);
    const store = new InMemoryPaymentStore();
    const metrics = new NtumbaMetrics({
      buildCommit: "development",
      jobsEnabled: false,
      providerMode: "fake",
      publicRequestStore: "development_non_durable",
      rateMode: "fake",
      startedAt: now,
    });
    const app = await buildApp(
      config,
      {
        directLightningProvider: new FakeDirectLightningProvider(),
        settlementProvider: new FakeSettlementProvider({ callbackSecret: secret, now: () => now }),
        store,
      },
      undefined,
      metrics,
    );
    openApps.push(app);
    const quoted = await quote(app);
    const intent = await app.inject({
      method: "POST",
      url: "/api/v1/payment-intents",
      payload: {
        destination: { network: "mtn", phone: "0971234567", type: "mobile_money" },
        direction: "btc_to_zmw",
        idempotencyKey: "callback-intent-012345",
        quoteId: quoted.json().quoteId,
      },
    });
    const callbackPayload = {
      direction: "btc_to_zmw",
      eventId: "fake-event-1",
      occurredAt: now.toISOString(),
      providerReference: intent.json().checkout.providerReference,
      settlement: { amount: "10000", asset: "ZMW" },
      source: { amount: "5834", asset: "BTC" },
      status: "settling",
    };

    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/provider-callbacks/fake",
      ...signedCallback("y".repeat(32), callbackPayload, now),
    });
    expect(rejected.statusCode).toBe(401);
    expect(await store.getProviderEvent("fake", "fake-event-1")).toBeUndefined();

    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/provider-callbacks/fake",
      ...signedCallback(secret, callbackPayload, now),
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ status: "accepted" });
    const stored = await store.getProviderEvent("fake", "fake-event-1");
    expect(stored).toMatchObject({
      normalizedStatus: "settling",
      paymentIntentId: intent.json().paymentIntentId,
      processedAt: null,
      provider: "fake",
    });
    expect(JSON.stringify(stored)).not.toContain(callbackPayload.providerReference);
    expect(JSON.stringify(stored)).not.toContain("source");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/provider-callbacks/fake",
      ...signedCallback(secret, callbackPayload, now),
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({ status: "duplicate" });
    expect(await store.getProviderEvent("fake", "fake-event-1")).toEqual(stored);

    const conflictingReplay = await app.inject({
      method: "POST",
      url: "/api/v1/provider-callbacks/fake",
      ...signedCallback(secret, { ...callbackPayload, status: "failed" }, now),
    });
    expect(conflictingReplay.statusCode).toBe(409);
    expect(await store.getProviderEvent("fake", "fake-event-1")).toEqual(stored);
    const metricText = metrics.render(await store.readOperationalSnapshot(now), true, now);
    expect(metricText).toContain('outcome="accepted",reason="none"} 1');
    expect(metricText).toContain('outcome="duplicate",reason="none"} 1');
    expect(metricText).toContain('outcome="rejected",reason="signature"} 1');
    expect(metricText).toContain('outcome="rejected",reason="conflict"} 1');
    expect(metricText).not.toContain(callbackPayload.providerReference);
  });

  it("rejects a signed callback whose amount does not match the retained intent", async () => {
    const now = new Date();
    const secret = "x".repeat(32);
    const store = new InMemoryPaymentStore();
    const app = await buildApp(config, {
      directLightningProvider: new FakeDirectLightningProvider(),
      settlementProvider: new FakeSettlementProvider({ callbackSecret: secret, now: () => now }),
      store,
    });
    openApps.push(app);
    const quoted = await quote(app);
    const intent = await app.inject({
      method: "POST",
      url: "/api/v1/payment-intents",
      payload: {
        destination: { network: "mtn", phone: "0971234567", type: "mobile_money" },
        direction: "btc_to_zmw",
        idempotencyKey: "callback-mismatch-012345",
        quoteId: quoted.json().quoteId,
      },
    });
    const callbackPayload = {
      direction: "btc_to_zmw",
      eventId: "fake-event-mismatch",
      occurredAt: now.toISOString(),
      providerReference: intent.json().checkout.providerReference,
      settlement: { amount: "9999", asset: "ZMW" },
      source: { amount: "5834", asset: "BTC" },
      status: "settling",
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/provider-callbacks/fake",
      ...signedCallback(secret, callbackPayload, now),
    });

    expect(response.statusCode).toBe(409);
    expect(await store.getProviderEvent("fake", "fake-event-mismatch")).toBeUndefined();
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
