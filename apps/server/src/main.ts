import "dotenv/config";
import { loadConfig } from "@ntumba/config";
import { createDatabase } from "@ntumba/database";
import { NtumbaMetrics } from "@ntumba/observability";
import { FakeBridgeEventVerifier, FakeDirectLightningProvider } from "@ntumba/providers";
import { buildApp } from "./app.js";
import { buildInternalApp } from "./internal/app.js";
import { startJobs } from "./jobs.js";
import { createOperationalSnapshotReader } from "./observability.js";
import { PostgresPaymentStore } from "./postgres-payment-store.js";
import { PostgresSettlementSagaRepository } from "./postgres-settlement-saga-repository.js";
import { PostgresPublicRequestStore } from "./public-request-store.js";
import { createFakeTreasuryRuntime } from "./treasury.js";

const config = loadConfig();
const { database, pool } = createDatabase(config.DATABASE_URL);
const store = new PostgresPaymentStore(database, config);
const sagaRepository = new PostgresSettlementSagaRepository(database, config);
await sagaRepository.initializeInventory();
const treasury = createFakeTreasuryRuntime(config, sagaRepository);
const publicRequestStore = new PostgresPublicRequestStore(database, store);
const metrics = new NtumbaMetrics({
  bitcoinRailMode: config.BITCOIN_LIQUIDITY_RAIL_MODE,
  buildCommit: config.NTUMBA_BUILD_COMMIT,
  bridgeMode: config.BRIDGE_ENGINE_MODE,
  jobsEnabled: config.JOBS_ENABLED,
  mobileMoneyRailMode: config.MOBILE_MONEY_LIQUIDITY_RAIL_MODE,
  publicRequestStore: "postgres_durable_envelope",
  rateMode: config.RATE_PROVIDER_MODE,
  startedAt: new Date(),
});
const app = await buildApp(
  config,
  {
    directLightningProvider: new FakeDirectLightningProvider(),
    bridgeEngine: treasury.bridgeEngine,
    bridgeEventVerifier: new FakeBridgeEventVerifier({
      callbackSecret: config.FAKE_PROVIDER_CALLBACK_SECRET,
    }),
    metrics,
    publicRequestDestinationVault: treasury.vault,
    store,
  },
  publicRequestStore,
  metrics,
);

const operationalReader = createOperationalSnapshotReader(store, treasury.bridgeEngine);
const internalApp = config.OPS_ENABLED
  ? await buildInternalApp(config, metrics, operationalReader)
  : null;

app.addHook("onClose", async () => {
  await pool.end();
});

if (config.JOBS_ENABLED) {
  const jobs = await startJobs(
    config.DATABASE_URL,
    app.log,
    treasury.bridgeEngine,
    config.PROVIDER_FINALITY_GRACE_SECONDS,
    metrics,
  );
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
