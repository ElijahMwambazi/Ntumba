import { createDatabase, purgeExpiredOperationalData } from "@ntumba/database";
import type { NtumbaMetrics } from "@ntumba/observability";
import type { BridgeEngine } from "@ntumba/treasury";
import type { FastifyBaseLogger } from "fastify";
import { PgBoss } from "pg-boss";

export interface RunningJobs {
  stop(): Promise<void>;
}

export async function startJobs(
  connectionString: string,
  logger: FastifyBaseLogger,
  bridgeEngine: BridgeEngine,
  providerFinalityGraceSeconds: number,
  metrics?: NtumbaMetrics,
): Promise<RunningJobs> {
  const boss = new PgBoss(connectionString);
  const { database, pool } = createDatabase(connectionString);

  boss.on("error", (error) => {
    logger.error({ errorType: error.name }, "background job queue error");
  });

  await boss.start();
  await boss.createQueue("purge-operational-data");
  await boss.createQueue("process-provider-events");
  await boss.createQueue("process-destination-settlements");
  await boss.createQueue("expire-source-payments");
  await boss.schedule("purge-operational-data", "17 * * * *", {}, { tz: "Africa/Lusaka" });
  await boss.schedule("process-provider-events", "* * * * *", {}, { tz: "Africa/Lusaka" });
  await boss.schedule(
    "process-destination-settlements",
    "* * * * *",
    {},
    {
      tz: "Africa/Lusaka",
    },
  );
  await boss.schedule("expire-source-payments", "* * * * *", {}, { tz: "Africa/Lusaka" });
  await boss.work("purge-operational-data", async () => {
    try {
      const purged = await purgeExpiredOperationalData(
        database,
        new Date(),
        providerFinalityGraceSeconds,
      );
      metrics?.recordPurgeSuccess("job", {
        events: purged.providerEvents,
        intents: purged.paymentIntents,
        outbox: purged.providerIntentOutbox,
        quotes: purged.quotes,
      });
      logger.info({ purged }, "expired operational payment data purged");
    } catch (error) {
      metrics?.recordPurgeFailure("job");
      throw error;
    }
  });
  await boss.work("process-provider-events", async () => {
    while (await bridgeEngine.processNextProviderEvent(new Date())) {
      // The repository claims one event transactionally on each pass.
    }
  });
  await boss.work("process-destination-settlements", async () => {
    while (await bridgeEngine.processNextDestination(new Date())) {
      // The repository lease and rail idempotency make restart recovery safe.
    }
  });
  await boss.work("expire-source-payments", async () => {
    while (await bridgeEngine.expireNextSourcePayment(new Date())) {
      // Source expiry releases only unmoved destination liquidity.
    }
  });

  return {
    async stop() {
      await boss.stop();
      await pool.end();
    },
  };
}
