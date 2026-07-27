import { createDatabase, purgeExpiredOperationalData } from "@ntumba/database";
import type { FastifyBaseLogger } from "fastify";
import { PgBoss } from "pg-boss";

export interface RunningJobs {
  stop(): Promise<void>;
}

export async function startJobs(
  connectionString: string,
  logger: FastifyBaseLogger,
): Promise<RunningJobs> {
  const boss = new PgBoss(connectionString);
  const { database, pool } = createDatabase(connectionString);

  boss.on("error", (error) => {
    logger.error({ errorType: error.name }, "background job queue error");
  });

  await boss.start();
  await boss.createQueue("purge-operational-data");
  await boss.schedule("purge-operational-data", "17 * * * *", {}, { tz: "Africa/Lusaka" });
  await boss.work("purge-operational-data", async () => {
    const purged = await purgeExpiredOperationalData(database, new Date());
    logger.info({ purged }, "expired operational payment data purged");
  });

  return {
    async stop() {
      await boss.stop();
      await pool.end();
    },
  };
}
