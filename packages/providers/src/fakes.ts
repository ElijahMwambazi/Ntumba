import { createHash } from "node:crypto";
import type {
  DirectLightningProvider,
  MerchantLightningInvoice,
  ProviderPaymentIntent,
  ProviderPaymentStatus,
  ProviderQuote,
  SettlementProvider,
  VerifiedProviderCallback,
} from "./types.js";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

export class FakeSettlementProvider implements SettlementProvider {
  async requestQuote(input: {
    amountZmwMinor: bigint;
    direction: "btc_to_zmw" | "zmw_to_btc";
    idempotencyKey: string;
  }): Promise<ProviderQuote> {
    const providerQuoteReference = `fake-quote-${digest(input.idempotencyKey).slice(0, 24)}`;
    return {
      expiresAt: new Date(Date.now() + 60_000),
      feeZmwMinor: 500n,
      merchantReceivesSats: input.direction === "zmw_to_btc" ? 5_555n : null,
      merchantReceivesZmwMinor: input.direction === "btc_to_zmw" ? input.amountZmwMinor : null,
      payerSendsSats: input.direction === "btc_to_zmw" ? 5_834n : null,
      payerSendsZmwMinor: input.direction === "zmw_to_btc" ? input.amountZmwMinor + 500n : null,
      providerQuoteReference,
    };
  }

  async createPaymentIntent(input: {
    destination:
      | {
          network: "airtel" | "mtn" | "zamtel";
          phone: string;
          type: "mobile_money";
        }
      | { address: string; type: "lightning_address" }
      | { invoice: string; type: "lightning_invoice" };
    direction: "btc_to_zmw" | "zmw_to_btc";
    idempotencyKey: string;
    providerQuoteReference: string;
  }): Promise<ProviderPaymentIntent> {
    // Destination is intentionally used only during this call and never retained by the fake.
    void input.destination;
    const suffix = digest(`${input.providerQuoteReference}:${input.idempotencyKey}`).slice(0, 24);
    return {
      checkoutUrl: `https://provider.invalid/checkout/${suffix}`,
      destinationToken: `fake-destination-${suffix}`,
      expiresAt: new Date(Date.now() + 60_000),
      payerInstructions:
        input.direction === "btc_to_zmw"
          ? "Open the provider checkout and pay its Lightning invoice."
          : "Open the provider checkout and approve its mobile-money collection prompt.",
      providerReference: `fake-intent-${suffix}`,
      status: "collecting",
    };
  }

  async getPaymentStatus(_providerReference: string): Promise<ProviderPaymentStatus> {
    return "collecting";
  }

  async verifyCallback(input: {
    headers: Readonly<Record<string, string | string[] | undefined>>;
    rawBody: Uint8Array;
  }): Promise<VerifiedProviderCallback> {
    const signature = input.headers["x-fake-signature"];
    if (signature !== "valid-development-signature") {
      throw new Error("Provider callback signature is invalid.");
    }

    const payloadHash = digest(Buffer.from(input.rawBody).toString("utf8"));
    return {
      eventId: `fake-event-${payloadHash.slice(0, 24)}`,
      occurredAt: new Date(),
      payloadHash,
      providerReference: `fake-intent-${payloadHash.slice(0, 24)}`,
      status: "collecting",
    };
  }
}

export class FakeDirectLightningProvider implements DirectLightningProvider {
  async getMerchantInvoiceStatus(_input: {
    paymentHash: string;
    paymentProof?: string;
  }): Promise<"pending" | "settled" | "expired" | "unknown"> {
    return "unknown";
  }

  async prepareMerchantInvoice(input: {
    amountSats: bigint;
    destination:
      | { address: string; type: "lightning_address" }
      | { invoice: string; type: "lightning_invoice" };
    paymentReference: string;
  }): Promise<MerchantLightningInvoice> {
    if (input.destination.type === "lightning_invoice") {
      return {
        expiresAt: new Date(Date.now() + 60_000),
        merchantOwned: true,
        paymentHash: digest(input.destination.invoice),
        paymentRequest: input.destination.invoice,
      };
    }

    const paymentHash = digest(`${input.destination.address}:${input.paymentReference}`);
    return {
      expiresAt: new Date(Date.now() + 60_000),
      merchantOwned: true,
      paymentHash,
      paymentRequest: `lntb${input.amountSats}n1merchant${paymentHash.slice(0, 24)}`,
    };
  }
}
