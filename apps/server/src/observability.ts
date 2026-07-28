import type { NtumbaMetrics, PurgeCounts, PurgeSource } from "@ntumba/observability";
import type { PaymentStore } from "./payment-store.js";

export async function purgeWithMetrics(
  store: PaymentStore,
  metrics: NtumbaMetrics | undefined,
  source: PurgeSource,
  now: Date,
): Promise<PurgeCounts> {
  try {
    const counts = await store.purgeDue(now);
    metrics?.recordPurgeSuccess(source, counts, new Date());
    return counts;
  } catch (error) {
    metrics?.recordPurgeFailure(source);
    throw error;
  }
}
