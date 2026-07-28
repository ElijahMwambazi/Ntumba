import { loadConfig } from "@ntumba/config";
import { NtumbaMetrics } from "@ntumba/observability";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryPaymentStore } from "../payment-store.js";
import { buildInternalApp } from "./app.js";

const token = "t".repeat(40);
const apps: Awaited<ReturnType<typeof buildInternalApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function collector() {
  return new NtumbaMetrics({
    buildCommit: "2990f1b",
    jobsEnabled: false,
    providerMode: "fake",
    publicRequestStore: "development_non_durable",
    rateMode: "fake",
    startedAt: new Date("2026-07-28T10:00:00.000Z"),
  });
}

describe("private operational listener", () => {
  it("is disabled by default and refuses enabled production without a strong token", async () => {
    const disabled = loadConfig({ NODE_ENV: "production" });
    await expect(
      buildInternalApp(disabled, collector(), new InMemoryPaymentStore()),
    ).rejects.toThrow(/disabled/);
    expect(() => loadConfig({ NODE_ENV: "production", OPS_ENABLED: "true" })).toThrow(
      /OPS_METRICS_TOKEN/,
    );
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        OPS_ENABLED: "true",
        OPS_METRICS_TOKEN: "too-short",
      }),
    ).toThrow(/OPS_METRICS_TOKEN/);
    expect(() =>
      loadConfig({
        HOST: "0.0.0.0",
        NODE_ENV: "production",
        OPS_ENABLED: "true",
        OPS_HOST: "127.0.0.1",
        OPS_METRICS_TOKEN: token,
        OPS_PORT: "3000",
        PORT: "3000",
      }),
    ).toThrow(/public listener port/);
  });

  it("requires the exact bearer token for health and metrics", async () => {
    const config = loadConfig({
      NODE_ENV: "production",
      NTUMBA_BUILD_COMMIT: "2990f1b",
      OPS_ENABLED: "true",
      OPS_METRICS_TOKEN: token,
    });
    const app = await buildInternalApp(config, collector(), new InMemoryPaymentStore());
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          headers: { authorization: "Bearer wrong-token" },
          method: "GET",
          url: "/health",
        })
      ).statusCode,
    ).toBe(401);

    const metrics = await app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "GET",
      url: "/metrics",
    });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers["content-type"]).toContain("text/plain");
    expect(metrics.body).toContain("ntumba_server_process_up 1");
    expect(metrics.body).not.toContain(token);

    const health = await app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "GET",
      url: "/health",
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      database: "available",
      lightningNode: "not_configured",
      providerMode: "fake",
      publicRequestStore: "development_non_durable",
      status: "development_only",
    });
  });

  it("reports database failure without leaking its error", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      OPS_ENABLED: "true",
      OPS_METRICS_TOKEN: token,
    });
    const reader = {
      async readOperationalSnapshot() {
        throw new Error("postgresql://secret-user:secret-password@database/ntumba");
      },
    };
    const app = await buildInternalApp(config, collector(), reader);
    apps.push(app);
    const authorization = { authorization: `Bearer ${token}` };

    const health = await app.inject({ headers: authorization, method: "GET", url: "/health" });
    expect(health.statusCode).toBe(503);
    expect(health.body).not.toContain("secret-password");
    const metrics = await app.inject({ headers: authorization, method: "GET", url: "/metrics" });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain("ntumba_database_available 0");
    expect(metrics.body).not.toContain("secret-password");
  });
});
