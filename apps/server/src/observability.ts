import type {
  NtumbaMetrics,
  OperationalSnapshotReader,
  PurgeCounts,
  PurgeSource,
} from "@ntumba/observability";
import type { BridgeEngine } from "@ntumba/treasury";
import type { PaymentStore } from "./payment-store.js";

export function createOperationalSnapshotReader(
  store: PaymentStore,
  bridgeEngine: BridgeEngine,
): OperationalSnapshotReader {
  return {
    async readOperationalSnapshot(now: Date) {
      const [snapshot, treasury] = await Promise.all([
        store.readOperationalSnapshot(now),
        bridgeEngine.readOperationalStatus(),
      ]);
      return {
        ...snapshot,
        treasury: {
          bitcoinBalanceSats: treasury.bitcoin.availableBalanceSats,
          inboundCapacitySats: treasury.bitcoin.inboundCapacitySats,
          lastSuccessfulReconciliationAt: treasury.lastSuccessfulReconciliationAt,
          lightningAvailable: treasury.bitcoin.available,
          manualReview: treasury.manualReview,
          reconciliationReviewRequired: treasury.reconciliationReviewRequired,
          mobileMoneyAvailable: treasury.mobileMoney.available,
          mobileMoneyBalanceZmwMinor: treasury.mobileMoney.availableBalanceZmwMinor,
          outboundCapacitySats: treasury.bitcoin.outboundCapacitySats,
          refundRequired: treasury.refundRequired,
          reservedBtcSats: treasury.reservedBtcSats,
          reservedZmwMinor: treasury.reservedZmwMinor,
          unsettledBtcLiabilitySats: treasury.unsettledBtcLiabilitySats,
          unsettledZmwLiabilityMinor: treasury.unsettledZmwLiabilityMinor,
          waitingDestinationSettlement: treasury.waitingDestinationSettlement,
          waitingSourcePayment: treasury.waitingSourcePayment,
        },
      };
    },
  };
}

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
