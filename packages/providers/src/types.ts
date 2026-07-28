export type ProviderPaymentStatus =
  | "collecting"
  | "settling"
  | "settled"
  | "expired"
  | "failed"
  | "refund_pending"
  | "refunded"
  | "unknown";

export type BridgeDirection = "btc_to_zmw" | "zmw_to_btc";
export type ProviderAsset = "BTC" | "ZMW";

export type ProviderDestination =
  | {
      network: "airtel" | "mtn" | "zamtel";
      phone: string;
      type: "mobile_money";
    }
  | { address: string; type: "lightning_address" }
  | { invoice: string; type: "lightning_invoice" };

export interface ProviderQuote {
  expiresAt: Date;
  feeZmwMinor: bigint;
  merchantReceivesSats: bigint | null;
  merchantReceivesZmwMinor: bigint | null;
  payerSendsSats: bigint | null;
  payerSendsZmwMinor: bigint | null;
  providerQuoteReference: string;
}

export interface ProviderPaymentIntent {
  checkoutUrl: string;
  destinationToken: string | null;
  expiresAt: Date;
  payerInstructions: string;
  providerReference: string;
  status: ProviderPaymentStatus;
}

export interface VerifiedProviderCallback {
  direction: BridgeDirection;
  eventId: string;
  occurredAt: Date;
  payloadHash: string;
  providerReference: string;
  settlementAmount: bigint;
  settlementAsset: ProviderAsset;
  sourceAmount: bigint;
  sourceAsset: ProviderAsset;
  status: ProviderPaymentStatus;
}

export interface SettlementProvider {
  createPaymentIntent(input: {
    destination: ProviderDestination;
    direction: BridgeDirection;
    idempotencyKey: string;
    providerQuoteReference: string;
  }): Promise<ProviderPaymentIntent>;
  getPaymentStatus(providerReference: string): Promise<ProviderPaymentStatus>;
  requestQuote(input: {
    amountZmwMinor: bigint;
    direction: BridgeDirection;
    idempotencyKey: string;
  }): Promise<ProviderQuote>;
  verifyCallback(input: {
    headers: Readonly<Record<string, string | string[] | undefined>>;
    rawBody: Uint8Array;
  }): Promise<VerifiedProviderCallback>;
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
