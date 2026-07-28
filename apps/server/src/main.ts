import "dotenv/config";
import { loadConfig } from "@ntumba/config";
import { createDatabase } from "@ntumba/database";
import { NtumbaMetrics } from "@ntumba/observability";
import { FakeDirectLightningProvider, FakeSettlementProvider } from "@ntumba/providers";
import { buildApp } from "./app.js";
import { buildInternalApp } from "./internal/app.js";
import { startJobs } from "./jobs.js";
import { PostgresPaymentStore } from "./postgres-payment-store.js";

const config = loadConfig();
const { database, pool } = createDatabase(config.DATABASE_URL);
const store = new PostgresPaymentStore(database, config);
const metrics = new NtumbaMetrics({
  buildCommit: config.NTUMBA_BUILD_COMMIT,
  jobsEnabled: config.JOBS_ENABLED,
  providerMode: config.SETTLEMENT_PROVIDER_MODE,
  publicRequestStore: "development_non_durable",
  rateMode: config.RATE_PROVIDER_MODE,
  startedAt: new Date(),
});
const app = await buildApp(
  config,
  {
    directLightningProvider: new FakeDirectLightningProvider(),
    metrics,
    settlementProvider: new FakeSettlementProvider({
      callbackSecret: config.FAKE_PROVIDER_CALLBACK_SECRET,
    }),
    store,
  },
  undefined,
  metrics,
);

const internalApp = config.OPS_ENABLED ? await buildInternalApp(config, metrics, store) : null;

app.addHook("onClose", async () => {
  await pool.end();
});

if (config.JOBS_ENABLED) {
  const jobs = await startJobs(config.DATABASE_URL, app.log, metrics);
  app.addHook("onClose", async () => {
    await jobs.stop();
  });
}

if (internalApp) {
  app.addHook("onClose", async () => {
    await internalApp.close();
  });
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  if (internalApp) {
    await internalApp.listen({ host: config.OPS_HOST, port: config.OPS_PORT });
  }
} catch (error) {
  app.log.error({ errorType: error instanceof Error ? error.name : "UnknownError" });
  await app.close();
  process.exitCode = 1;
}
