import { createHmac } from "node:crypto";
import type { NtumbaConfig } from "@ntumba/config";
import { NtumbaMetrics } from "@ntumba/observability";
import { FakeBridgeEventVerifier, FakeDirectLightningProvider } from "@ntumba/providers";
import type { BridgeEngine } from "@ntumba/treasury";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryPaymentStore } from "./payment-store.js";
import { createFakeTreasuryRuntime } from "./treasury.js";

class FailOnceBridgeEngine implements BridgeEngine {
  readonly attemptedIdempotencyKeys: string[] = [];
  readonly #delegate: BridgeEngine;

  constructor(delegate: BridgeEngine) {
    this.#delegate = delegate;
  }

  async create(input: Parameters<BridgeEngine["create"]>[0]) {
    this.attemptedIdempotencyKeys.push(input.collectionIdempotencyKey);
    if (this.attemptedIdempotencyKeys.length === 1) {
      throw new Error("Synthetic provider timeout");
    }
    return this.#delegate.create(input);
  }

  appendProviderEvent: BridgeEngine["appendProviderEvent"] = (...args) =>
    this.#delegate.appendProviderEvent(...args);
  expireNextSourcePayment: BridgeEngine["expireNextSourcePayment"] = (...args) =>
    this.#delegate.expireNextSourcePayment(...args);
  markSourceOutcome: BridgeEngine["markSourceOutcome"] = (...args) =>
    this.#delegate.markSourceOutcome(...args);
  processDestination: BridgeEngine["processDestination"] = (...args) =>
    this.#delegate.processDestination(...args);
  processNextDestination: BridgeEngine["processNextDestination"] = (...args) =>
    this.#delegate.processNextDestination(...args);
  processNextProviderEvent: BridgeEngine["processNextProviderEvent"] = (...args) =>
    this.#delegate.processNextProviderEvent(...args);
  read: BridgeEngine["read"] = (...args) => this.#delegate.read(...args);
  readOperationalStatus: BridgeEngine["readOperationalStatus"] = () =>
    this.#delegate.readOperationalStatus();
  retryDestination: BridgeEngine["retryDestination"] = (...args) =>
    this.#delegate.retryDestination(...args);
}

const config: NtumbaConfig = {
  APP_BASE_URL: "http://localhost:5173",
  BITCOIN_LIQUIDITY_RAIL_MODE: "fake",
  BRIDGE_ENGINE_MODE: "fake",
  DATABASE_URL: "postgresql://ntumba:ntumba@localhost:5432/ntumba_test",
  FAKE_BITCOIN_TREASURY_BALANCE_SATS: 5_000_000n,
  FAKE_BITCOIN_TREASURY_INBOUND_CAPACITY_SATS: 10_000_000n,
  FAKE_BITCOIN_TREASURY_OUTBOUND_CAPACITY_SATS: 5_000_000n,
  FAKE_LIPILA_BALANCE_ZMW_MINOR: 5_000_000n,
  FLAT_FEE_ZMW: "5.00",
  HOST: "127.0.0.1",
  INTENT_RETENTION_SECONDS: 86_400,
  JOBS_ENABLED: false,
  LOG_LEVEL: "silent",
  MOBILE_MONEY_LIQUIDITY_RAIL_MODE: "fake",
  NODE_ENV: "test",
  NTUMBA_BUILD_COMMIT: "development",
  OPS_ENABLED: false,
  OPS_HOST: "127.0.0.1",
  OPS_PORT: 9091,
  PORT: 3000,
  PROVIDER_EVENT_MAX_PROCESSING_ATTEMPTS: 3,
  PROVIDER_EVENT_RETRY_BACKOFF_SECONDS: 5,
  PROVIDER_FINALITY_GRACE_SECONDS: 86_400,
  QUOTE_RETENTION_SECONDS: 3_600,
  QUOTE_TTL_SECONDS: 60,
  RATE_PROVIDER_MODE: "fake",
  SERVE_WEB: false,
  SETTLEMENT_CALLBACK_GRACE_SECONDS: 60,
  SETTLEMENT_DESTINATION_TTL_SECONDS: 300,
  SOURCE_PAYMENT_TTL_SECONDS: 180,
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

  it("creates a fake treasury bridge intent without echoing a merchant phone", async () => {
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
      status: "awaiting_source_payment",
    });
    expect(response.body).not.toContain("0971234567");
  });

  it("resumes a staged provider intent after a transient provider failure", async () => {
    const store = new InMemoryPaymentStore();
    const bridgeEngine = new FailOnceBridgeEngine(createFakeTreasuryRuntime(config).bridgeEngine);
    const app = await buildApp(config, {
      bridgeEngine,
      bridgeEventVerifier: new FakeBridgeEventVerifier(),
      directLightningProvider: new FakeDirectLightningProvider(),
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
    expect(await store.findIntentByIdempotencyKey(payload.idempotencyKey)).toBeUndefined();

    const recovered = await app.inject({
      method: "POST",
      url: "/api/v1/payment-intents",
      payload,
    });
    expect(recovered.statusCode).toBe(201);
    expect(recovered.json()).toMatchObject({
      paymentIntentId: expect.any(String),
      status: "awaiting_source_payment",
    });
    expect(bridgeEngine.attemptedIdempotencyKeys).toEqual([
      `collection:${payload.idempotencyKey}`,
      `collection:${payload.idempotencyKey}`,
    ]);
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
    const treasury = createFakeTreasuryRuntime(config);
    const metrics = new NtumbaMetrics({
      bitcoinRailMode: "fake",
      bridgeMode: "fake",
      buildCommit: "development",
      jobsEnabled: false,
      mobileMoneyRailMode: "fake",
      publicRequestStore: "development_non_durable",
      rateMode: "fake",
      startedAt: now,
    });
    const app = await buildApp(
      config,
      {
        bridgeEngine: treasury.bridgeEngine,
        bridgeEventVerifier: new FakeBridgeEventVerifier({
          callbackSecret: secret,
          now: () => now,
        }),
        directLightningProvider: new FakeDirectLightningProvider(),
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
      status: "source_settled",
    };

    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/provider-callbacks/fake",
      ...signedCallback("y".repeat(32), callbackPayload, now),
    });
    expect(rejected.statusCode).toBe(401);
    expect(await store.getProviderEvent("fake_treasury", "fake-event-1")).toBeUndefined();

    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/provider-callbacks/fake",
      ...signedCallback(secret, callbackPayload, now),
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ status: "accepted" });
    expect((await treasury.bridgeEngine.processNextProviderEvent(now))?.status).toBe(
      "destination_settlement_queued",
    );
    expect(await treasury.repository.readJournal()).toHaveLength(1);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/provider-callbacks/fake",
      ...signedCallback(secret, callbackPayload, now),
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({ status: "duplicate" });
    expect(await treasury.repository.readJournal()).toHaveLength(1);

    const conflictingReplay = await app.inject({
      method: "POST",
      url: "/api/v1/provider-callbacks/fake",
      ...signedCallback(secret, { ...callbackPayload, status: "failed" }, now),
    });
    expect(conflictingReplay.statusCode).toBe(409);
    expect(await treasury.repository.readJournal()).toHaveLength(1);
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
      bridgeEngine: createFakeTreasuryRuntime(config).bridgeEngine,
      bridgeEventVerifier: new FakeBridgeEventVerifier({
        callbackSecret: secret,
        now: () => now,
      }),
      directLightningProvider: new FakeDirectLightningProvider(),
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
      status: "destination_processing",
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/provider-callbacks/fake",
      ...signedCallback(secret, callbackPayload, now),
    });

    expect(response.statusCode).toBe(409);
    expect(await store.getProviderEvent("fake_treasury", "fake-event-mismatch")).toBeUndefined();
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
