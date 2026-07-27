import type { Asset, PayerMethod, PaymentStatus, SettlementDestination } from "@ntumba/contracts";

export function payerMethodsFor(receiveAsset: Asset): PayerMethod[] {
  return receiveAsset === "ZMW" ? ["BTC"] : ["BTC", "ZMW"];
}

export function maskDestination(destination: SettlementDestination): string {
  if (destination.type === "mobile_money") {
    const digits = destination.phone.replace(/\D/gu, "");
    return `${destination.network.toUpperCase()} ••• ••• ${digits.slice(-4)}`;
  }
  if (destination.type === "lightning_invoice") {
    return `Invoice •••${destination.invoice.slice(-6)}`;
  }
  const [name = "", domain = ""] = destination.address.split("@");
  return `${name.slice(0, 2)}•••@${domain}`;
}

export function isExpired(expiresAt: string, now = Date.now()): boolean {
  return new Date(expiresAt).getTime() <= now;
}

export function formatCountdown(expiresAt: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export const plainStatus: Record<
  PaymentStatus,
  { detail: string; label: string; tone: "danger" | "neutral" | "success" | "warning" }
> = {
  created: {
    detail: "The request is ready to share.",
    label: "Request created",
    tone: "neutral",
  },
  direct_payment_pending: {
    detail: "Ntumba cannot confirm this direct wallet payment yet.",
    label: "Waiting for payment",
    tone: "warning",
  },
  direct_payment_settled: {
    detail: "Independent payment evidence confirmed the merchant received Bitcoin.",
    label: "Payment received",
    tone: "success",
  },
  expired: {
    detail: "Ask the merchant to create a new request.",
    label: "Request expired",
    tone: "warning",
  },
  failed: {
    detail: "The payment could not be completed.",
    label: "Payment failed",
    tone: "danger",
  },
  manual_review: {
    detail: "Do not pay again until the payment can be checked.",
    label: "Could not confirm payment",
    tone: "warning",
  },
  provider_collecting: {
    detail: "Complete payment with the external provider.",
    label: "Waiting for payment",
    tone: "neutral",
  },
  provider_settling: {
    detail: "The provider is sending funds directly to the merchant.",
    label: "Paying merchant",
    tone: "neutral",
  },
  refund_pending: {
    detail: "The provider is processing the refund.",
    label: "Refund pending",
    tone: "warning",
  },
  refunded: {
    detail: "The provider reports the payment was refunded.",
    label: "Refunded",
    tone: "neutral",
  },
  settled: {
    detail: "The provider reports that the merchant was paid.",
    label: "Merchant paid",
    tone: "success",
  },
};
