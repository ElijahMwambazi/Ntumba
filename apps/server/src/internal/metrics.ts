import {
  emptyOperationalSnapshot,
  type NtumbaMetrics,
  type OperationalSnapshotReader,
} from "@ntumba/observability";
import type { FastifyInstance } from "fastify";

export async function registerInternalMetrics(
  app: FastifyInstance,
  metrics: NtumbaMetrics,
  reader: OperationalSnapshotReader,
): Promise<void> {
  app.get("/metrics", async (_request, reply) => {
    try {
      const snapshot = await reader.readOperationalSnapshot(new Date());
      return reply
        .type("text/plain; version=0.0.4; charset=utf-8")
        .send(metrics.render(snapshot, true));
    } catch {
      return reply
        .type("text/plain; version=0.0.4; charset=utf-8")
        .send(metrics.render(emptyOperationalSnapshot(), false));
    }
  });
}
