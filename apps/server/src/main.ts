import "dotenv/config";
import { loadConfig } from "@ntumba/config";
import { createDatabase } from "@ntumba/database";
import { FakeDirectLightningProvider, FakeSettlementProvider } from "@ntumba/providers";
import { buildApp } from "./app.js";
import { startJobs } from "./jobs.js";
import { PostgresPaymentStore } from "./postgres-payment-store.js";

const config = loadConfig();
const { database, pool } = createDatabase(config.DATABASE_URL);
const app = await buildApp(config, {
  directLightningProvider: new FakeDirectLightningProvider(),
  settlementProvider: new FakeSettlementProvider(),
  store: new PostgresPaymentStore(database, config),
});

app.addHook("onClose", async () => {
  await pool.end();
});

if (config.JOBS_ENABLED) {
  const jobs = await startJobs(config.DATABASE_URL, app.log);
  app.addHook("onClose", async () => {
    await jobs.stop();
  });
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error({ errorType: error instanceof Error ? error.name : "UnknownError" });
  process.exitCode = 1;
}
