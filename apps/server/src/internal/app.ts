import { timingSafeEqual } from "node:crypto";
import type { NtumbaConfig } from "@ntumba/config";
import type { NtumbaMetrics, OperationalSnapshotReader } from "@ntumba/observability";
import Fastify from "fastify";
import { registerInternalHealth } from "./health.js";
import { registerInternalMetrics } from "./metrics.js";

function tokenMatches(authorization: string | undefined, token: string): boolean {
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }
  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function buildInternalApp(
  config: NtumbaConfig,
  metrics: NtumbaMetrics,
  reader: OperationalSnapshotReader,
) {
  if (!config.OPS_ENABLED || !config.OPS_METRICS_TOKEN) {
    throw new Error("Operational endpoints are disabled or missing their bearer token.");
  }

  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ["req.headers.authorization"],
          },
    requestIdHeader: "x-request-id",
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!tokenMatches(request.headers.authorization, config.OPS_METRICS_TOKEN ?? "")) {
      return reply.status(401).send({ error: "UNAUTHORIZED" });
    }
  });

  await registerInternalHealth(app, config, reader);
  await registerInternalMetrics(app, metrics, reader);
  return app;
}
