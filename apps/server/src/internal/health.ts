import type { NtumbaConfig } from "@ntumba/config";
import type { OperationalSnapshotReader } from "@ntumba/observability";
import type { FastifyInstance } from "fastify";

export async function registerInternalHealth(
  app: FastifyInstance,
  config: NtumbaConfig,
  reader: OperationalSnapshotReader,
): Promise<void> {
  app.get("/health", async (_request, reply) => {
    try {
      await reader.readOperationalSnapshot(new Date());
      return {
        buildCommit: config.NTUMBA_BUILD_COMMIT,
        bitcoinLiquidityRail: config.BITCOIN_LIQUIDITY_RAIL_MODE,
        bridgeEngine: config.BRIDGE_ENGINE_MODE,
        database: "available",
        jobs: config.JOBS_ENABLED ? "enabled" : "disabled",
        mobileMoneyLiquidityRail: config.MOBILE_MONEY_LIQUIDITY_RAIL_MODE,
        publicRequestStore: "development_non_durable",
        rateMode: config.RATE_PROVIDER_MODE,
        service: "ntumba-operator",
        status: "development_only",
      };
    } catch {
      return reply.status(503).send({
        database: "unavailable",
        service: "ntumba-operator",
        status: "unhealthy",
      });
    }
  });
}
