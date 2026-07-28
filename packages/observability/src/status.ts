export type AvailabilityState = "available" | "fake_only" | "not_configured" | "unhealthy";

export interface ReadOnlyLightningStatus {
  externalChannelCapacitySats: bigint | null;
  inboundCapacitySats: bigint | null;
  node: "available" | "not_configured" | "unhealthy";
  outboundCapacitySats: bigint | null;
  paymentVerification: "available" | "not_configured" | "unhealthy";
}

export interface ReadOnlyLightningStatusAdapter {
  readStatus(): Promise<ReadOnlyLightningStatus>;
}

export interface ProviderCapacityStatus {
  collection: "available" | "development_only" | "unhealthy";
  lastRealSettlementAt: Date | null;
  providerReportedSettlementCapacitySats: bigint | null;
  providerTransactionMaximumZmwMinor: bigint | null;
  providerTransactionMinimumZmwMinor: bigint | null;
  settlement: "available" | "development_only" | "unhealthy";
}

export interface ReadOnlyProviderCapacityAdapter {
  readStatus(): Promise<ProviderCapacityStatus>;
}

export function unavailableLightningStatus(): ReadOnlyLightningStatus {
  return {
    externalChannelCapacitySats: null,
    inboundCapacitySats: null,
    node: "not_configured",
    outboundCapacitySats: null,
    paymentVerification: "not_configured",
  };
}

export function fakeProviderCapacityStatus(): ProviderCapacityStatus {
  return {
    collection: "development_only",
    lastRealSettlementAt: null,
    providerReportedSettlementCapacitySats: null,
    providerTransactionMaximumZmwMinor: null,
    providerTransactionMinimumZmwMinor: null,
    settlement: "development_only",
  };
}
