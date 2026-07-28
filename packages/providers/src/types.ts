export type BridgeDirection = "btc_to_zmw" | "zmw_to_btc";
export type ProviderAsset = "BTC" | "ZMW";
export type BridgeEventStatus =
  | "source_pending"
  | "source_confirming"
  | "source_settled"
  | "destination_queued"
  | "destination_processing"
  | "destination_settled"
  | "failed"
  | "refund_pending"
  | "refunded"
  | "unknown";

export interface VerifiedBridgeCallback {
  direction: BridgeDirection;
  eventId: string;
  occurredAt: Date;
  payloadHash: string;
  providerReference: string;
  settlementAmount: bigint;
  settlementAsset: ProviderAsset;
  sourceAmount: bigint;
  sourceAsset: ProviderAsset;
  status: BridgeEventStatus;
}

export interface BridgeEventVerifier {
  verifyCallback(input: {
    headers: Readonly<Record<string, string | string[] | undefined>>;
    rawBody: Uint8Array;
  }): Promise<VerifiedBridgeCallback>;
}

export interface MerchantLightningInvoice {
  expiresAt: Date;
  merchantOwned: true;
  paymentHash: string;
  paymentRequest: string;
}

export interface DirectLightningProvider {
  getMerchantInvoiceStatus(input: {
    paymentHash: string;
    paymentProof?: string;
  }): Promise<"pending" | "settled" | "expired" | "unknown">;
  prepareMerchantInvoice(input: {
    amountSats: bigint;
    destination:
      | { address: string; type: "lightning_address" }
      | { invoice: string; type: "lightning_invoice" };
    paymentReference: string;
  }): Promise<MerchantLightningInvoice>;
}
